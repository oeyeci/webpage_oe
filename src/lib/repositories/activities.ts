/**
 * Activities repository — talks, conferences, outreach and other dated events,
 * each with an optional image gallery.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db';
import {
  activities,
  activityCategories,
  activityImages,
  media,
  type Activity,
  type ActivityCategory,
  type Media,
} from '../db/schema';
import { slugify } from '../utils/text';

export interface ActivityListItem extends Activity {
  category: ActivityCategory | null;
  cover: Media | null;
}

export interface ActivityDetail extends ActivityListItem {
  gallery: Media[];
}

export async function listActivities(
  db: Db,
  options: { includeUnpublished?: boolean; categorySlug?: string; limit?: number } = {},
): Promise<ActivityListItem[]> {
  const filters = [];
  if (!options.includeUnpublished) filters.push(eq(activities.isPublished, true));

  if (options.categorySlug) {
    const category = await db
      .select({ id: activityCategories.id })
      .from(activityCategories)
      .where(eq(activityCategories.slug, options.categorySlug))
      .get();
    if (!category) return [];
    filters.push(eq(activities.categoryId, category.id));
  }

  const query = db
    .select({ activity: activities, category: activityCategories, cover: media })
    .from(activities)
    .leftJoin(activityCategories, eq(activityCategories.id, activities.categoryId))
    .leftJoin(media, eq(media.id, activities.coverMediaId))
    .$dynamic();

  if (filters.length) query.where(and(...filters));

  const rows = await query
    .orderBy(desc(activities.activityDate), desc(activities.id))
    .limit(options.limit ?? 200)
    .all();

  return rows.map((r) => ({ ...r.activity, category: r.category, cover: r.cover }));
}

export async function getActivityBySlug(
  db: Db,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<ActivityDetail | null> {
  const filters = [eq(activities.slug, slug)];
  if (!options.includeUnpublished) filters.push(eq(activities.isPublished, true));

  const row = await db
    .select({ activity: activities, category: activityCategories, cover: media })
    .from(activities)
    .leftJoin(activityCategories, eq(activityCategories.id, activities.categoryId))
    .leftJoin(media, eq(media.id, activities.coverMediaId))
    .where(and(...filters))
    .get();

  if (!row) return null;

  const gallery = await db
    .select({ media })
    .from(activityImages)
    .innerJoin(media, eq(media.id, activityImages.mediaId))
    .where(eq(activityImages.activityId, row.activity.id))
    .orderBy(activityImages.sortOrder)
    .all();

  return {
    ...row.activity,
    category: row.category,
    cover: row.cover,
    gallery: gallery.map((g) => g.media),
  };
}

export function getActivity(db: Db, id: number) {
  return db.select().from(activities).where(eq(activities.id, id)).get();
}

export function listActivityCategories(db: Db) {
  return db.select().from(activityCategories).orderBy(activityCategories.sortOrder).all();
}

export async function setActivityGallery(
  db: Db,
  activityId: number,
  mediaIds: number[],
): Promise<void> {
  await db.delete(activityImages).where(eq(activityImages.activityId, activityId));
  let order = 0;
  for (const mediaId of mediaIds) {
    await db.insert(activityImages).values({ activityId, mediaId, sortOrder: order++ });
  }
}

export async function uniqueActivitySlug(
  db: Db,
  desired: string,
  excludeId?: number,
): Promise<string> {
  const base = slugify(desired) || 'activity';
  let candidate = base;
  let suffix = 1;

  for (;;) {
    const clash = await db
      .select({ id: activities.id })
      .from(activities)
      .where(
        excludeId
          ? and(eq(activities.slug, candidate), ne(activities.id, excludeId))
          : eq(activities.slug, candidate),
      )
      .get();

    if (!clash) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export async function deleteActivity(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(activities).where(eq(activities.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Resolves a list of media ids to rows, preserving the given order. */
export async function resolveMedia(db: Db, ids: number[]): Promise<Media[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(media).where(inArray(media.id, ids)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((m): m is Media => Boolean(m));
}
