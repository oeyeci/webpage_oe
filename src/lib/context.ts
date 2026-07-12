/**
 * Per-request context helpers.
 *
 * In Astro 7 + @astrojs/cloudflare v14, bindings come from the `cloudflare:workers`
 * module (a workerd built-in) rather than from `Astro.locals.runtime.env`, which
 * was removed. `astro dev` runs the app inside real workerd, so this is the same
 * code path locally and in production.
 *
 * Everything in the app goes through these accessors rather than importing
 * `env` directly, so there is exactly one place to change if the runtime moves
 * again.
 */
import { env } from 'cloudflare:workers';
import type { APIContext, AstroGlobal } from 'astro';
import { createDb, type Db } from './db';
import { ERROR_CODES, HttpError } from './api/response';
import type { SessionUser } from './auth/session';

type Ctx = APIContext | AstroGlobal;

/** The Cloudflare bindings and vars for this Worker. */
export function getEnv(): Cloudflare.Env {
  return env;
}

/** A request-scoped Drizzle client over D1. */
export function getDb(): Db {
  return createDb(env.DB);
}

/**
 * The Workers `ExecutionContext`, for `waitUntil`.
 * Used to write to the cache and increment counters without making the visitor
 * wait for them.
 */
export function getExecutionContext(context: Ctx): ExecutionContext {
  return context.locals.cfContext;
}

/** The signed-in user, or `null`. Populated by the middleware. */
export function getUser(context: Ctx): SessionUser | null {
  return context.locals.user ?? null;
}

/** Throws a 401 unless a user is signed in. Called at the top of every admin route. */
export function requireUser(context: Ctx): SessionUser {
  const user = getUser(context);
  if (!user) {
    throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'You must sign in to do that.');
  }
  return user;
}

/** Throws a 403 unless the signed-in user is an administrator. */
export function requireAdmin(context: Ctx): SessionUser {
  const user = requireUser(context);
  if (user.role !== 'admin') {
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Administrator access is required.');
  }
  return user;
}

/** Cloudflare geo/IP metadata attached to the incoming request. */
export function getRequestMeta(context: Ctx): {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
} {
  const request = context.request;
  const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf;

  return {
    ip: request.headers.get('CF-Connecting-IP'),
    country: (cf?.country as string | undefined) ?? null,
    userAgent: request.headers.get('User-Agent'),
  };
}

/** True when the request arrived over HTTPS — drives the `Secure` cookie flag. */
export function isSecureRequest(context: Ctx): boolean {
  return new URL(context.request.url).protocol === 'https:';
}
