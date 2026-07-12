import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, getUser } from '../../../lib/context';
import { handle, json } from '../../../lib/api/response';
import { destroyAllSessions, destroySession } from '../../../lib/auth/session';
import { audit } from '../../../lib/repositories/contacts';

export const prerender = false;

export const POST: APIRoute = async (context) =>
  handle(async () => {
    const db = getDb();
    const env = getEnv();
    const user = getUser(context);
    const meta = getRequestMeta(context);

    const url = new URL(context.request.url);
    const everywhere = url.searchParams.get('everywhere') === '1';

    if (user && everywhere) {
      await destroyAllSessions(db, user.id);
      context.cookies.delete('oe_session', { path: '/' });
    } else {
      await destroySession(db, { JWT_SECRET: env.JWT_SECRET }, context.cookies);
    }

    if (user) {
      await audit(db, {
        userId: user.id,
        action: everywhere ? 'auth.logout_all' : 'auth.logout',
        ipAddress: meta.ip,
      });
    }

    // Logging out is not an error even when there was no session to log out of.
    return json({ ok: true });
  });
