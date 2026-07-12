/**
 * Global middleware.
 *
 * Three jobs, in order:
 *   1. Resolve the session cookie into `locals.user` (once per request, so no
 *      page or API route has to repeat the lookup).
 *   2. Gate `/admin/*` — an unauthenticated visit redirects to the login page,
 *      preserving where they were headed. This is defence in depth: every admin
 *      API route *also* calls `requireAdmin`, because a middleware that is
 *      accidentally bypassed must not be the only thing standing between the
 *      internet and the database.
 *   3. Attach security headers to every HTML response.
 */
import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { createDb } from './lib/db';
import { getSessionUser } from './lib/auth/session';
import { withEdgeCache } from './lib/cache';

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` is present for styles only: Astro inlines critical CSS and
 * the theme script must run before first paint to avoid a flash of the wrong
 * theme. Scripts are locked to same-origin plus the two Cloudflare origins we
 * actually load (Turnstile and Web Analytics).
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com",
    'frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://www.youtube.com https://www.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const isAdminArea = url.pathname.startsWith('/admin');
  const isAdminApi = url.pathname.startsWith('/api/admin');

  context.locals.user = null;

  // A session lookup that throws must not 500 the whole site — it means
  // "not signed in", and the admin gates below then fail closed.
  if (env.DB && env.JWT_SECRET) {
    try {
      context.locals.user = await getSessionUser(
        createDb(env.DB),
        { JWT_SECRET: env.JWT_SECRET },
        context.cookies,
      );
    } catch (cause) {
      console.error('session lookup failed', cause);
      context.locals.user = null;
    }
  }

  // The login page itself must stay reachable while signed out.
  const isLoginPage = url.pathname === '/admin/login';

  if (isAdminArea && !isLoginPage && !context.locals.user) {
    const target = `${url.pathname}${url.search}`;
    return context.redirect(`/admin/login?next=${encodeURIComponent(target)}`, 302);
  }

  // Already signed in and visiting the login page → go to the dashboard.
  if (isLoginPage && context.locals.user) {
    return context.redirect('/admin', 302);
  }

  if (isAdminApi && !context.locals.user) {
    return new Response(
      JSON.stringify({ error: 'You must sign in to do that.', code: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Edge caching for public pages.
   *
   * Only anonymous GETs of non-admin, non-API routes are cached. Caching a
   * response rendered for a signed-in admin into a *shared* cache is how one
   * visitor ends up being served another's page — so authentication short-
   * circuits the cache entirely rather than trying to vary on it.
   *
   * Invalidation is by content version (see lib/cache.ts), not by purge.
   */
  const isCacheable =
    context.request.method === 'GET' &&
    !isAdminArea &&
    !url.pathname.startsWith('/api/') &&
    // `/media/*` is excluded on purpose. Those objects are content-addressed —
    // the R2 key carries a random suffix, so a re-upload is a *new* URL — which
    // means they are genuinely immutable and the route serves them with
    // `max-age=31536000, immutable`. Routing them through the versioned cache
    // would overwrite that with `must-revalidate` and drag every image request
    // back to the Worker for no benefit.
    !url.pathname.startsWith('/media/') &&
    !context.locals.user;

  const render = async () => {
    const response = await next();

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/html')) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        response.headers.set(name, value);
      }
      response.headers.set('Content-Security-Policy', contentSecurityPolicy());

      // The admin panel is per-user; never let a shared cache hold it.
      if (isAdminArea) {
        response.headers.set('Cache-Control', 'private, no-store');
      }
    }

    return response;
  };

  if (!isCacheable || !env.KV) {
    return render();
  }

  return withEdgeCache(
    context.request,
    context.locals.cfContext,
    env.KV,
    false,
    render,
    // How long our *own* versioned entry may live at the edge. It is safe to
    // make this long: any content edit bumps the version, which changes the
    // cache key and orphans every existing entry immediately.
    { sMaxAge: 3600 },
  );
});
