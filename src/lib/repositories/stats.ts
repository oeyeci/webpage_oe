/**
 * Dashboard statistics — the numbers on the admin landing page.
 */
import { count, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import {
  activities,
  blogPosts,
  contacts,
  experiences,
  media,
  projects,
  publications,
  skills,
} from '../db/schema';

export interface DashboardStats {
  publications: { total: number; featured: number };
  posts: { total: number; published: number; drafts: number; scheduled: number; views: number };
  activities: { total: number; published: number };
  experiences: number;
  projects: number;
  skills: number;
  media: { count: number; bytes: number };
  contacts: { total: number; unread: number };
}

export async function getDashboardStats(db: Db): Promise<DashboardStats> {
  const [
    pubTotal,
    pubFeatured,
    postRows,
    postViews,
    activityTotal,
    activityPublished,
    experienceTotal,
    projectTotal,
    skillTotal,
    mediaRow,
    contactTotal,
    contactUnread,
  ] = await Promise.all([
    db.select({ n: count() }).from(publications).get(),
    db.select({ n: count() }).from(publications).where(eq(publications.isFeatured, true)).get(),
    db.select({ status: blogPosts.status, n: count() }).from(blogPosts).groupBy(blogPosts.status).all(),
    db.select({ n: sql<number>`coalesce(sum(${blogPosts.viewCount}), 0)` }).from(blogPosts).get(),
    db.select({ n: count() }).from(activities).get(),
    db.select({ n: count() }).from(activities).where(eq(activities.isPublished, true)).get(),
    db.select({ n: count() }).from(experiences).get(),
    db.select({ n: count() }).from(projects).get(),
    db.select({ n: count() }).from(skills).get(),
    db
      .select({ n: count(), bytes: sql<number>`coalesce(sum(${media.size}), 0)` })
      .from(media)
      .get(),
    db.select({ n: count() }).from(contacts).get(),
    db.select({ n: count() }).from(contacts).where(eq(contacts.status, 'new')).get(),
  ]);

  const byStatus = new Map(postRows.map((r) => [r.status, r.n]));

  return {
    publications: { total: pubTotal?.n ?? 0, featured: pubFeatured?.n ?? 0 },
    posts: {
      total: postRows.reduce((sum, r) => sum + r.n, 0),
      published: byStatus.get('published') ?? 0,
      drafts: byStatus.get('draft') ?? 0,
      scheduled: byStatus.get('scheduled') ?? 0,
      views: postViews?.n ?? 0,
    },
    activities: { total: activityTotal?.n ?? 0, published: activityPublished?.n ?? 0 },
    experiences: experienceTotal?.n ?? 0,
    projects: projectTotal?.n ?? 0,
    skills: skillTotal?.n ?? 0,
    media: { count: mediaRow?.n ?? 0, bytes: mediaRow?.bytes ?? 0 },
    contacts: { total: contactTotal?.n ?? 0, unread: contactUnread?.n ?? 0 },
  };
}

/** Most-viewed published posts, for the dashboard's "top content" panel. */
export function topPosts(db: Db, limit = 5) {
  return db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      slug: blogPosts.slug,
      viewCount: blogPosts.viewCount,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.viewCount))
    .limit(limit)
    .all();
}

/** Human-readable byte size, e.g. "12.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
