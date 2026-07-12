import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, getEnv, getRequestMeta, isSecureRequest } from '../../../lib/context';
import { fail, handle, json, parseJson, tooManyRequests, ERROR_CODES } from '../../../lib/api/response';
import { loginSchema } from '../../../lib/validation/schemas';
import { users } from '../../../lib/db/schema';
import { hashPassword, needsRehash, verifyPassword } from '../../../lib/auth/password';
import { createSession } from '../../../lib/auth/session';
import { audit } from '../../../lib/repositories/contacts';
import { LIMITS, clientIp, rateLimit } from '../../../lib/security/rate-limit';

export const prerender = false;

/** Ensures a post-login redirect stays on this site (no open redirect). */
function safeNext(next: string | undefined): string {
  if (!next) return '/admin';
  // Must be a site-relative path — `//evil.com` and `https://evil.com` are not.
  if (!next.startsWith('/') || next.startsWith('//')) return '/admin';
  return next.startsWith('/admin') ? next : '/admin';
}

export const POST: APIRoute = async (context) =>
  handle(async () => {
    const db = getDb();
    const env = getEnv();
    const ip = clientIp(context.request);
    const meta = getRequestMeta(context);

    // Brute-force brake. The real cost to an attacker is PBKDF2's 600k
    // iterations; this just stops them from trying at speed.
    const limit = await rateLimit(env.KV, `login:${ip}`, LIMITS.login);
    if (!limit.allowed) {
      await audit(db, { action: 'auth.rate_limited', ipAddress: ip });
      return tooManyRequests(limit.retryAfter);
    }

    const input = await parseJson(context.request, loginSchema);

    const user = await db.select().from(users).where(eq(users.email, input.email)).get();

    /**
     * A wrong email and a wrong password must be indistinguishable — otherwise
     * this endpoint becomes an account-enumeration oracle. So we verify against
     * a dummy hash when the user does not exist, which keeps the timing and the
     * response identical.
     */
    const storedHash =
      user?.passwordHash ??
      'pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    const passwordOk = await verifyPassword(input.password, storedHash);

    if (!user || !passwordOk || !user.isActive) {
      await audit(db, {
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'user',
        entityId: input.email,
        ipAddress: ip,
      });
      return fail(401, ERROR_CODES.UNAUTHORIZED, 'Incorrect email or password.');
    }

    // Transparently upgrade a hash produced with weaker parameters.
    if (needsRehash(user.passwordHash)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.password) })
        .where(eq(users.id, user.id));
    }

    await createSession(
      db,
      { JWT_SECRET: env.JWT_SECRET },
      { id: user.id, email: user.email, name: user.name, role: user.role },
      context.cookies,
      {
        remember: input.remember,
        secure: isSecureRequest(context),
        userAgent: meta.userAgent ?? undefined,
        ip: ip === 'unknown' ? undefined : ip,
      },
    );

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    await audit(db, {
      userId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      ipAddress: ip,
    });

    return json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      mustChangePassword: user.mustChangePassword,
      redirect: safeNext(input.next),
    });
  });
