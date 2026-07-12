import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import {
  badRequest,
  handle,
  json,
  noContent,
  notFound,
  parseJson,
} from '../../../../lib/api/response';
import { mediaPatchSchema } from '../../../../lib/validation/schemas';
import { media } from '../../../../lib/db/schema';
import { deleteMedia } from '../../../../lib/storage/r2';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PATCH — edit alt text, caption or folder. The bytes themselves are immutable. */
export const PATCH: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await db.select().from(media).where(eq(media.id, id)).get();
    if (!existing) return notFound();

    const patch = await parseJson(context.request, mediaPatchSchema);
    if (Object.keys(patch).length === 0) return badRequest('No fields to update.');

    const row = await db.update(media).set(patch).where(eq(media.id, id)).returning().get();

    await audit(db, {
      userId: user.id,
      action: 'media.update',
      entity: 'media',
      entityId: id,
      meta: { fields: Object.keys(patch) },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(row);
  });

/**
 * DELETE — remove the row and its R2 objects.
 *
 * Anything still pointing at this media (a post's cover, an image slot) has an
 * `ON DELETE SET NULL` foreign key, so the reference is cleared rather than
 * left dangling — a post loses its cover image, it does not 500.
 */
export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await db.select().from(media).where(eq(media.id, id)).get();
    if (!existing) return notFound();

    await deleteMedia(db, env.MEDIA, id);

    await audit(db, {
      userId: user.id,
      action: 'media.delete',
      entity: 'media',
      entityId: id,
      meta: { filename: existing.filename, r2Key: existing.r2Key },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return noContent();
  });
