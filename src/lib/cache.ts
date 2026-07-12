/**
 * Edge caching for public pages, built on the Cloudflare Cache API.
 *
 * The hard part of caching a database-backed site is *invalidation*: a Worker
 * cannot wildcard-purge the Cache API (that needs a zone-scoped API token and a
 * round trip to Cloudflare's control plane).
 *
 * So instead of purging, we make stale entries unreachable. A monotonically
 * increasing "content version" lives in KV and is baked into every cache key.
 * Any admin mutation bumps it, which changes every key at once; the orphaned
 * entries are never looked up again and fall out on their own TTL. Publishing a
 * post takes effect globally on the next request, with no purge API, no fan-out
 * and no per-URL bookkeeping.
 */

const VERSION_KEY = 'content:version';

/**
 * Per-isolate memo. An isolate lives for seconds to minutes, so this collapses
 * the KV read on hot paths while still picking up a bump quickly.
 */
let memo: { value: number; readAt: number } | null = null;
const MEMO_TTL_MS = 5_000;

export async function getContentVersion(kv: KVNamespace): Promise<number> {
  if (memo && Date.now() - memo.readAt < MEMO_TTL_MS) return memo.value;

  try {
    const raw = await kv.get(VERSION_KEY);
    const value = Number(raw ?? '1');
    const version = Number.isFinite(value) ? value : 1;
    memo = { value: version, readAt: Date.now() };
    return version;
  } catch {
    return 1;
  }
}

/**
 * Invalidates every cached public page. Call after any content mutation.
 * Cheap (one KV write) and safe to call redundantly.
 */
export async function bumpContentVersion(kv: KVNamespace): Promise<void> {
  try {
    const current = Number((await kv.get(VERSION_KEY)) ?? '1');
    const next = (Number.isFinite(current) ? current : 1) + 1;
    await kv.put(VERSION_KEY, String(next));
    memo = { value: next, readAt: Date.now() };
  } catch {
    // A failed bump means visitors see cached content for up to `s-maxage`.
    // That is a stale page, not a broken one — never fail the write because of it.
    memo = null;
  }
}

/** Builds the versioned cache key for a request. */
export function cacheKeyFor(request: Request, version: number): Request {
  const url = new URL(request.url);
  url.searchParams.set('__v', String(version));
  return new Request(url.toString(), { method: 'GET', headers: request.headers });
}

export interface CacheOptions {
  /** How long the edge may serve this response, in seconds. */
  sMaxAge?: number;
  /** How long a browser may reuse it, in seconds. */
  maxAge?: number;
  /** Serve stale content while revalidating in the background. */
  staleWhileRevalidate?: number;
}

/** Standard cache headers for a public, versioned page. */
export function cacheHeaders(options: CacheOptions = {}): Record<string, string> {
  const { sMaxAge = 3600, maxAge = 0, staleWhileRevalidate = 86_400 } = options;
  return {
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    Vary: 'Accept-Encoding',
  };
}

/**
 * Wraps a page render with edge caching.
 *
 * Only GET requests from anonymous visitors are cached — an admin viewing the
 * site must always see their unpublished drafts, and caching a personalised
 * response into a shared cache is how sites leak one user's page to another.
 */
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  kv: KVNamespace,
  isAuthenticated: boolean,
  render: () => Promise<Response>,
  options: CacheOptions = {},
): Promise<Response> {
  if (request.method !== 'GET' || isAuthenticated) {
    const response = await render();
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const version = await getContentVersion(kv);
  const key = cacheKeyFor(request, version);
  const cache = (caches as unknown as { default: Cache }).default;

  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  const response = await render();

  if (response.status === 200) {
    for (const [name, value] of Object.entries(cacheHeaders(options))) {
      response.headers.set(name, value);
    }
    response.headers.set('X-Cache', 'MISS');
    // Write to the cache without making the visitor wait for it.
    ctx.waitUntil(cache.put(key, response.clone()));
  }

  return response;
}
