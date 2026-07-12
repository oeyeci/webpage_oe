import type { AstroCookies } from 'astro';
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../db';
import { sessions, users } from '../db/schema';
import { signJwt, verifyJwt } from './jwt';

export const SESSION_COOKIE = 'oe_session';

/** 8 hours for a normal login; 30 days when "keep me signed in" is checked. */
const TTL_DEFAULT = 8 * 60 * 60;
const TTL_REMEMBER = 30 * 24 * 60 * 60;

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'editor';
}

/**
 * Issues a session: a row in `sessions` (so it can be revoked) plus a signed
 * JWT carrying that row's id, written to an HttpOnly cookie.
 */
export async function createSession(
  db: Db,
  env: { JWT_SECRET: string },
  user: SessionUser,
  cookies: AstroCookies,
  options: { remember?: boolean; secure: boolean; userAgent?: string; ip?: string } = {
    secure: true,
  },
): Promise<string> {
  const ttl = options.remember ? TTL_REMEMBER : TTL_DEFAULT;
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await db.insert(sessions).values({
    id: jti,
    userId: user.id,
    expiresAt,
    userAgent: options.userAgent?.slice(0, 400) ?? null,
    ipAddress: options.ip ?? null,
  });

  const token = await signJwt(
    {
      sub: String(user.id),
      jti,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    env.JWT_SECRET,
    ttl,
  );

  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // `Secure` is dropped on plain-HTTP localhost only; every deployed
    // environment is HTTPS, so the flag is always on in practice.
    secure: options.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ttl,
  });

  return jti;
}

/**
 * Resolves the current user from the session cookie.
 *
 * Both halves must hold: the JWT signature/expiry must verify, *and* the
 * session row must still exist and be unexpired. The second check is what
 * makes "sign out of all devices" and account deactivation take effect
 * immediately rather than whenever the token happens to expire.
 */
export async function getSessionUser(
  db: Db,
  env: { JWT_SECRET: string },
  cookies: AstroCookies,
): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  const row = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, payload.jti), eq(sessions.userId, Number(payload.sub))))
    .get();

  if (!row) return null;
  if (!row.isActive) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, payload.jti));
    return null;
  }

  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Revokes the current session and clears the cookie. */
export async function destroySession(
  db: Db,
  env: { JWT_SECRET: string },
  cookies: AstroCookies,
): Promise<void> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifyJwt(token, env.JWT_SECRET);
    if (payload) {
      await db.delete(sessions).where(eq(sessions.id, payload.jti));
    }
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Revokes every session belonging to a user ("sign out everywhere"). */
export async function destroyAllSessions(db: Db, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping: drop rows whose expiry has passed. Called from the cron trigger. */
export async function pruneExpiredSessions(db: Db): Promise<number> {
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
  return result.meta.changes ?? 0;
}
