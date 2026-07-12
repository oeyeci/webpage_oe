import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { created, handle, json, notFound, parseJson } from '../../../../lib/api/response';
import { getResource, isResourceName } from '../../../../lib/api/resources';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

/** GET /api/admin/[resource] — list all rows. */
export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);

    const name = context.params.resource;
    if (!isResourceName(name)) return notFound('Unknown resource.');

    const { table, orderBy } = getResource(name);
    const db = getDb();

    const rows = await db.select().from(table).orderBy(...orderBy).all();
    return json(rows);
  });

/** POST /api/admin/[resource] — create a row. */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);

    const name = context.params.resource;
    if (!isResourceName(name)) return notFound('Unknown resource.');

    const { table, schema, transform, label } = getResource(name);
    const db = getDb();
    const env = getEnv();

    const input = (await parseJson(context.request, schema)) as Record<string, unknown>;
    const values = transform ? await transform(input) : input;

    const row = await db
      .insert(table)
      .values(values as never)
      .returning()
      .get();

    await audit(db, {
      userId: user.id,
      action: `${name}.create`,
      entity: name,
      entityId: (row as { id?: number }).id,
      meta: { label },
      ipAddress: getRequestMeta(context).ip,
    });

    // Public pages are cached at the edge by content version; bumping it is what
    // makes this change visible immediately rather than at the next TTL.
    await bumpContentVersion(env.KV);

    return created(row);
  });
