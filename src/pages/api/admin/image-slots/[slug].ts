import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { ERROR_CODES, fail, handle, json, notFound, parseJson } from '../../../../lib/api/response';
import { imageSlotSchema } from '../../../../lib/validation/schemas';
import { media } from '../../../../lib/db/schema';
import { validateDimensions } from '../../../../lib/storage/image';
import { assignImageSlot, getImageSlot } from '../../../../lib/repositories/about';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);

    const slug = context.params.slug;
    if (!slug) return notFound();

    const slot = await getImageSlot(getDb(), slug);
    if (!slot) return notFound(`Unknown image slot "${slug}".`);

    return json(slot);
  });

/**
 * PUT — point a slot at an existing media item (or clear it with `mediaId: null`).
 *
 * Uploading *into* a slot goes through POST /api/admin/media with `slot=<slug>`,
 * which validates the file's real dimensions against the slot's rule first. This
 * endpoint is for re-pointing a slot at something already in the library, so it
 * re-runs that check here rather than trusting the caller.
 */
export const PUT: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const slug = context.params.slug;
    if (!slug) return notFound();

    const slot = await getImageSlot(db, slug);
    if (!slot) return notFound(`Unknown image slot "${slug}".`);

    const { mediaId } = await parseJson(context.request, imageSlotSchema);

    if (mediaId !== null) {
      const row = await db.select().from(media).where(eq(media.id, mediaId)).get();
      if (!row) return notFound('That media item does not exist.');

      if (row.width && row.height) {
        const check = validateDimensions(
          { width: row.width, height: row.height },
          {
            requiredWidth: slot.requiredWidth,
            requiredHeight: slot.requiredHeight,
            aspectRatio: slot.aspectRatio,
            tolerance: slot.tolerance,
          },
        );
        if (!check.ok) {
          return fail(422, ERROR_CODES.VALIDATION, check.reason);
        }
      }
    }

    await assignImageSlot(db, slug, mediaId);

    await audit(db, {
      userId: user.id,
      action: 'image_slot.assign',
      entity: 'image_slots',
      entityId: slug,
      meta: { mediaId },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(await getImageSlot(db, slug));
  });
