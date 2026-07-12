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
  /** How long our own versioned cache entry may live, in seconds. */
  sMaxAge?: number;
}

/**
 * The `Cache-Control` written onto the copy we store in *our* cache.
 *
 * Cloudflare's Cache API derives an entry's TTL from the response's
 * `Cache-Control`, so the stored copy needs a real `s-maxage`.
 */
function storedCacheControl(sMaxAge: number): string {
  return `public, s-maxage=${sMaxAge}`;
}

/**
 * The `Cache-Control` we send to the visitor — and, crucially, to Cloudflare's
 * own CDN.
 *
 * This must NOT be independently cacheable, and getting that wrong is subtle.
 * We invalidate content by changing our cache *key* (the version baked into it
 * by `cacheKeyFor`). Cloudflare's CDN, however, caches by URL and knows nothing
 * about that version — so if we hand it `s-maxage=3600`, it will happily serve
 * a stale page for an hour after an edit, completely bypassing the
 * invalidation scheme above.
 *
 * `max-age=0, must-revalidate` means every request reaches the Worker, where
 * our versioned cache answers it from the same edge location at the same speed.
 * We keep the performance and we keep instant invalidation.
 */
const CLIENT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

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

  const { sMaxAge = 3600 } = options;

  const version = await getContentVersion(kv);
  const key = cacheKeyFor(request, version);
  const cache = (caches as unknown as { default: Cache }).default;

  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('Cache-Control', CLIENT_CACHE_CONTROL);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  const response = await render();

  if (response.status === 200) {
    // Two copies, two different cache policies:
    //
    //   • the one we store  → `s-maxage`, so it actually lives at the edge
    //   • the one we return → must-revalidate, so no cache *outside* our
    //                         control can hold a version it cannot invalidate
    //
    // `response.clone()` tees the body stream; one branch feeds the cache write
    // and the other is streamed to the visitor.
    const stored = new Response(response.clone().body, response);
    stored.headers.set('Cache-Control', storedCacheControl(sMaxAge));
    stored.headers.set('Vary', 'Accept-Encoding');

    // Write to the cache without making the visitor wait for it.
    ctx.waitUntil(cache.put(key, stored));
  }

  response.headers.set('Cache-Control', CLIENT_CACHE_CONTROL);
  response.headers.set('Vary', 'Accept-Encoding');
  response.headers.set('X-Cache', 'MISS');

  return response;
}
