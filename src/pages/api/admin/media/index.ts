import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { created, fail, handle, json, ERROR_CODES } from '../../../../lib/api/response';
import { listMedia, uploadMedia } from '../../../../lib/storage/r2';
import { assignImageSlot, getImageSlot } from '../../../../lib/repositories/about';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();

    const url = new URL(context.request.url);
    const items = await listMedia(db, {
      folder: url.searchParams.get('folder') ?? undefined,
      limit: Math.min(200, Number(url.searchParams.get('limit') ?? '60')),
      offset: Number(url.searchParams.get('offset') ?? '0'),
    });

    return json(items);
  });

/**
 * POST /api/admin/media — upload a file to R2.
 *
 * `multipart/form-data` with:
 *   file       — the upload (required)
 *   thumbnail  — optional pre-resized thumbnail, generated client-side
 *   folder     — virtual folder, e.g. "blog"
 *   alt        — alt text (required for images, for WCAG AA)
 *   slot       — optional image-slot slug; the slot's stored dimension rule is
 *                then enforced against the file's *actual* header, and the slot
 *                is reassigned on success.
 */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    let form: FormData;
    try {
      form = await context.request.formData();
    } catch {
      return fail(400, ERROR_CODES.VALIDATION, 'Expected a multipart/form-data upload.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return fail(400, ERROR_CODES.VALIDATION, 'No file was provided.');
    }

    const thumbnail = form.get('thumbnail');
    const slotSlug = form.get('slot');
    const alt = String(form.get('alt') ?? '').trim();
    const caption = String(form.get('caption') ?? '').trim();
    const allowDocuments = form.get('allowDocuments') === '1';

    // Resolve the slot first so its dimension rule can be enforced *before* the
    // object is written to R2 — otherwise a rejected upload still costs storage.
    const slot = typeof slotSlug === 'string' && slotSlug ? await getImageSlot(db, slotSlug) : null;
    if (typeof slotSlug === 'string' && slotSlug && !slot) {
      return fail(404, ERROR_CODES.NOT_FOUND, `Unknown image slot "${slotSlug}".`);
    }

    const result = await uploadMedia(db, env.MEDIA, {
      file,
      folder: String(form.get('folder') ?? slot?.slug.split('.')[0] ?? 'uploads'),
      alt,
      caption: caption || undefined,
      uploadedBy: user.id,
      thumbnail: thumbnail instanceof File ? thumbnail : null,
      allowDocuments,
      rule: slot
        ? {
            requiredWidth: slot.requiredWidth,
            requiredHeight: slot.requiredHeight,
            aspectRatio: slot.aspectRatio,
            tolerance: slot.tolerance,
          }
        : undefined,
    });

    if (!result.ok) {
      const code =
        result.status === 413
          ? ERROR_CODES.PAYLOAD_TOO_LARGE
          : result.status === 415
            ? ERROR_CODES.UNSUPPORTED_MEDIA
            : ERROR_CODES.VALIDATION;
      return fail(result.status, code, result.error);
    }

    if (slot) {
      await assignImageSlot(db, slot.slug, result.media.id);
    }

    await audit(db, {
      userId: user.id,
      action: 'media.upload',
      entity: 'media',
      entityId: result.media.id,
      meta: {
        filename: result.media.filename,
        size: result.media.size,
        slot: slot?.slug ?? null,
      },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return created(result.media);
  });
