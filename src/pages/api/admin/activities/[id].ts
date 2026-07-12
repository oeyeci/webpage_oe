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
import { activitySchema } from '../../../../lib/validation/schemas';
import { activities } from '../../../../lib/db/schema';
import {
  deleteActivity,
  getActivity,
  setActivityGallery,
  uniqueActivitySlug,
} from '../../../../lib/repositories/activities';
import { renderRichText } from '../../../../lib/content/markdown';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';
import { stripHtml, truncate } from '../../../../lib/utils/text';

export const prerender = false;

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const activity = await getActivity(db, id);
    if (!activity) return notFound();

    return json(activity);
  });

export const PUT: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getActivity(db, id);
    if (!existing) return notFound();

    const input = await parseJson(context.request, activitySchema);

    const html = input.descriptionMd.trim() ? await renderRichText(input.descriptionMd) : null;
    const slug = await uniqueActivitySlug(db, input.slug ?? input.title, id);

    const activity = await db
      .update(activities)
      .set({
        slug,
        title: input.title,
        activityDate: input.activityDate,
        endDate: input.endDate,
        location: input.location,
        categoryId: input.categoryId,
        excerpt: input.excerpt ?? (html ? truncate(stripHtml(html), 200) : null),
        descriptionMd: input.descriptionMd,
        descriptionHtml: html,
        coverMediaId: input.coverMediaId,
        url: input.url,
        isFeatured: input.isFeatured,
        isPublished: input.isPublished,
        updatedAt: new Date(),
      })
      .where(eq(activities.id, id))
      .returning()
      .get();

    await setActivityGallery(db, id, input.galleryMediaIds);

    await audit(db, {
      userId: user.id,
      action: 'activities.update',
      entity: 'activities',
      entityId: id,
      meta: { title: activity.title },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(activity);
  });

export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getActivity(db, id);
    if (!existing) return notFound();

    await deleteActivity(db, id);

    await audit(db, {
      userId: user.id,
      action: 'activities.delete',
      entity: 'activities',
      entityId: id,
      meta: { title: existing.title },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return noContent();
  });
