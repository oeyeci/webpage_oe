import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * Builds a request-scoped Drizzle client over the D1 binding.
 *
 * Workers are per-request isolates, so there is no connection pool to manage
 * and no benefit to memoising this — construct it once per request from
 * `Astro.locals.runtime.env.DB` and pass it down.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;

export { schema };
export * from './schema';
