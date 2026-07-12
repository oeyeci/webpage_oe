import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { created, handle, json, parseJson } from '../../../../lib/api/response';
import { activitySchema } from '../../../../lib/validation/schemas';
import { activities } from '../../../../lib/db/schema';
import {
  listActivities,
  setActivityGallery,
  uniqueActivitySlug,
} from '../../../../lib/repositories/activities';
import { renderRichText } from '../../../../lib/content/markdown';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';
import { stripHtml, truncate } from '../../../../lib/utils/text';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();
    return json(await listActivities(db, { includeUnpublished: true }));
  });

export const POST: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const input = await parseJson(context.request, activitySchema);

    const html = input.descriptionMd.trim() ? await renderRichText(input.descriptionMd) : null;
    const slug = await uniqueActivitySlug(db, input.slug ?? input.title);

    const activity = await db
      .insert(activities)
      .values({
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
      })
      .returning()
      .get();

    if (input.galleryMediaIds.length > 0) {
      await setActivityGallery(db, activity.id, input.galleryMediaIds);
    }

    await audit(db, {
      userId: user.id,
      action: 'activities.create',
      entity: 'activities',
      entityId: activity.id,
      meta: { title: activity.title },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return created(activity);
  });
