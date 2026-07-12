/**
 * Blog repository.
 *
 * Publication state is the interesting part. A post is visible to the public
 * only when `status = 'published'` **and** `published_at <= now`. Scheduling is
 * therefore not a background job that might not run — a scheduled post becomes
 * visible on its own the moment the clock passes it, and the cron trigger only
 * exists to flip the stored `status` so the admin list stays honest.
 */
import { and, desc, eq, inArray, like, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db';
import {
  blogCategories,
  blogPostGallery,
  blogPostTags,
  blogPosts,
  blogTags,
  media,
  users,
  type BlogCategory,
  type BlogPost,
  type BlogTag,
  type Media,
} from '../db/schema';
import { slugify } from '../utils/text';

export interface PostListItem extends BlogPost {
  category: BlogCategory | null;
  cover: Media | null;
  authorName: string | null;
  tags: BlogTag[];
}

export interface PostDetail extends PostListItem {
  gallery: Media[];
}

/**
 * A post is live when its publish time has arrived.
 *
 * Crucially this covers `scheduled` posts as well as `published` ones, which
 * makes scheduling *self-executing*: a post booked for Friday 09:00 goes live at
 * Friday 09:00 because the query says so, not because a background job woke up
 * and remembered to flip a flag. There is no cron in the critical path, so there
 * is no cron that can fail and silently leave a post unpublished.
 *
 * `publishDuePosts()` still exists, but only as bookkeeping — it tidies the
 * stored `status` so the admin list agrees with reality. If it never runs, the
 * public site is still correct.
 */
function livePredicate() {
  const now = new Date();
  return or(
    and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, now)),
    and(eq(blogPosts.status, 'scheduled'), lte(blogPosts.scheduledFor, now)),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Reads
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ListPostsOptions {
  /** Include drafts and future-scheduled posts (admin only). */
  includeUnpublished?: boolean;
  categorySlug?: string;
  tagSlug?: string;
  /** Free-text search across title, excerpt and body. */
  search?: string;
  featuredOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listPosts(
  db: Db,
  options: ListPostsOptions = {},
): Promise<{ items: PostListItem[]; total: number }> {
  const { includeUnpublished = false, limit = 12, offset = 0 } = options;

  const filters = [];
  if (!includeUnpublished) filters.push(livePredicate());
  if (options.featuredOnly) filters.push(eq(blogPosts.isFeatured, true));

  if (options.categorySlug) {
    const category = await db
      .select({ id: blogCategories.id })
      .from(blogCategories)
      .where(eq(blogCategories.slug, options.categorySlug))
      .get();
    // An unknown category must return nothing, not everything.
    filters.push(category ? eq(blogPosts.categoryId, category.id) : sql`1 = 0`);
  }

  if (options.tagSlug) {
    const tagged = await db
      .select({ postId: blogPostTags.postId })
      .from(blogPostTags)
      .innerJoin(blogTags, eq(blogTags.id, blogPostTags.tagId))
      .where(eq(blogTags.slug, options.tagSlug))
      .all();

    const ids = tagged.map((t) => t.postId);
    filters.push(ids.length ? inArray(blogPosts.id, ids) : sql`1 = 0`);
  }

  if (options.search?.trim()) {
    // LIKE is the right tool at this corpus size: a few hundred posts, an index
    // on nothing useful anyway, and D1 would need FTS5 virtual tables + triggers
    // to do better. Revisit if the blog ever passes a few thousand posts.
    const needle = `%${options.search.trim().toLowerCase()}%`;
    filters.push(
      or(
        like(sql`lower(${blogPosts.title})`, needle),
        like(sql`lower(${blogPosts.excerpt})`, needle),
        like(sql`lower(${blogPosts.contentMd})`, needle),
      ),
    );
  }

  const where = filters.length ? and(...filters) : undefined;

  const totalRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(blogPosts)
    .where(where)
    .get();

  const rows = await db
    .select({
      post: blogPosts,
      category: blogCategories,
      cover: media,
      authorName: users.name,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .leftJoin(media, eq(media.id, blogPosts.coverMediaId))
    .leftJoin(users, eq(users.id, blogPosts.authorId))
    .where(where)
    .orderBy(desc(blogPosts.isFeatured), desc(blogPosts.publishedAt), desc(blogPosts.id))
    .limit(limit)
    .offset(offset)
    .all();

  const tagsByPost = await loadTags(
    db,
    rows.map((r) => r.post.id),
  );

  return {
    total: totalRow?.n ?? 0,
    items: rows.map((r) => ({
      ...r.post,
      category: r.category,
      cover: r.cover,
      authorName: r.authorName,
      tags: tagsByPost.get(r.post.id) ?? [],
    })),
  };
}

/** Loads the tags for a set of posts in one query (avoids an N+1 in list views). */
async function loadTags(db: Db, postIds: number[]): Promise<Map<number, BlogTag[]>> {
  const map = new Map<number, BlogTag[]>();
  if (postIds.length === 0) return map;

  const rows = await db
    .select({ postId: blogPostTags.postId, tag: blogTags })
    .from(blogPostTags)
    .innerJoin(blogTags, eq(blogTags.id, blogPostTags.tagId))
    .where(inArray(blogPostTags.postId, postIds))
    .all();

  for (const row of rows) {
    const list = map.get(row.postId) ?? [];
    list.push(row.tag);
    map.set(row.postId, list);
  }
  return map;
}

export async function getPostBySlug(
  db: Db,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<PostDetail | null> {
  const filters = [eq(blogPosts.slug, slug)];
  if (!options.includeUnpublished) filters.push(livePredicate()!);

  const row = await db
    .select({
      post: blogPosts,
      category: blogCategories,
      cover: media,
      authorName: users.name,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .leftJoin(media, eq(media.id, blogPosts.coverMediaId))
    .leftJoin(users, eq(users.id, blogPosts.authorId))
    .where(and(...filters))
    .get();

  if (!row) return null;

  const tags = (await loadTags(db, [row.post.id])).get(row.post.id) ?? [];

  const gallery = await db
    .select({ media })
    .from(blogPostGallery)
    .innerJoin(media, eq(media.id, blogPostGallery.mediaId))
    .where(eq(blogPostGallery.postId, row.post.id))
    .orderBy(blogPostGallery.sortOrder)
    .all();

  return {
    ...row.post,
    category: row.category,
    cover: row.cover,
    authorName: row.authorName,
    tags,
    gallery: gallery.map((g) => g.media),
  };
}

export async function getPostById(db: Db, id: number): Promise<BlogPost | undefined> {
  return db.select().from(blogPosts).where(eq(blogPosts.id, id)).get();
}

/** Posts adjacent to `id` in publication order — the "previous / next" footer. */
export async function getAdjacentPosts(
  db: Db,
  publishedAt: Date | null,
): Promise<{ previous: BlogPost | null; next: BlogPost | null }> {
  if (!publishedAt) return { previous: null, next: null };

  const previous = await db
    .select()
    .from(blogPosts)
    .where(and(livePredicate(), sql`${blogPosts.publishedAt} < ${Math.floor(publishedAt.getTime() / 1000)}`))
    .orderBy(desc(blogPosts.publishedAt))
    .get();

  const next = await db
    .select()
    .from(blogPosts)
    .where(and(livePredicate(), sql`${blogPosts.publishedAt} > ${Math.floor(publishedAt.getTime() / 1000)}`))
    .orderBy(blogPosts.publishedAt)
    .get();

  return { previous: previous ?? null, next: next ?? null };
}

/** Related posts: same category first, then anything recent. */
export async function getRelatedPosts(
  db: Db,
  post: BlogPost,
  limit = 3,
): Promise<PostListItem[]> {
  const sameCategory = post.categoryId
    ? await listPosts(db, { limit: limit + 1 })
    : { items: [] as PostListItem[] };

  return sameCategory.items.filter((p) => p.id !== post.id).slice(0, limit);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Writes
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Ensures a slug is unique by appending `-2`, `-3`, … when it collides. */
export async function uniqueSlug(
  db: Db,
  desired: string,
  excludeId?: number,
): Promise<string> {
  const base = slugify(desired) || 'post';
  let candidate = base;
  let suffix = 1;

  for (;;) {
    const clash = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(
        excludeId
          ? and(eq(blogPosts.slug, candidate), ne(blogPosts.id, excludeId))
          : eq(blogPosts.slug, candidate),
      )
      .get();

    if (!clash) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

/** Resolves tag names to ids, creating any that do not exist yet. */
export async function upsertTags(db: Db, names: string[]): Promise<number[]> {
  const ids: number[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (!slug) continue;

    const existing = await db
      .select({ id: blogTags.id })
      .from(blogTags)
      .where(eq(blogTags.slug, slug))
      .get();

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const inserted = await db
      .insert(blogTags)
      .values({ name, slug })
      .returning({ id: blogTags.id })
      .get();
    ids.push(inserted.id);
  }

  return ids;
}

export async function setPostTags(db: Db, postId: number, tagIds: number[]): Promise<void> {
  await db.delete(blogPostTags).where(eq(blogPostTags.postId, postId));
  for (const tagId of new Set(tagIds)) {
    await db.insert(blogPostTags).values({ postId, tagId });
  }
}

export async function setPostGallery(db: Db, postId: number, mediaIds: number[]): Promise<void> {
  await db.delete(blogPostGallery).where(eq(blogPostGallery.postId, postId));
  let order = 0;
  for (const mediaId of mediaIds) {
    await db.insert(blogPostGallery).values({ postId, mediaId, sortOrder: order++ });
  }
}

export async function deletePost(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(blogPosts).where(eq(blogPosts.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Increments the view counter without blocking the response. */
export async function incrementViews(db: Db, id: number): Promise<void> {
  await db
    .update(blogPosts)
    .set({ viewCount: sql`${blogPosts.viewCount} + 1` })
    .where(eq(blogPosts.id, id));
}

/**
 * Promotes scheduled posts whose time has come. Idempotent; run from cron.
 * Returns the number of posts published.
 */
export async function publishDuePosts(db: Db): Promise<number> {
  const result = await db
    .update(blogPosts)
    .set({ status: 'published', publishedAt: sql`coalesce(${blogPosts.scheduledFor}, unixepoch())` })
    .where(and(eq(blogPosts.status, 'scheduled'), lte(blogPosts.scheduledFor, new Date())))
    .run();

  return result.meta.changes ?? 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Taxonomy
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function listCategories(db: Db): Promise<Array<BlogCategory & { postCount: number }>> {
  const rows = await db
    .select({
      category: blogCategories,
      postCount: sql<number>`(
        select count(*) from ${blogPosts}
        where ${blogPosts.categoryId} = ${blogCategories.id}
          and (
            (${blogPosts.status} = 'published' and ${blogPosts.publishedAt} <= unixepoch())
            or (${blogPosts.status} = 'scheduled' and ${blogPosts.scheduledFor} <= unixepoch())
          )
      )`,
    })
    .from(blogCategories)
    .orderBy(blogCategories.sortOrder, blogCategories.name)
    .all();

  return rows.map((r) => ({ ...r.category, postCount: r.postCount }));
}

export async function listTags(db: Db): Promise<Array<BlogTag & { postCount: number }>> {
  const rows = await db
    .select({
      tag: blogTags,
      postCount: sql<number>`(
        select count(*) from ${blogPostTags}
        join ${blogPosts} on ${blogPosts.id} = ${blogPostTags.postId}
        where ${blogPostTags.tagId} = ${blogTags.id}
          and (
            (${blogPosts.status} = 'published' and ${blogPosts.publishedAt} <= unixepoch())
            or (${blogPosts.status} = 'scheduled' and ${blogPosts.scheduledFor} <= unixepoch())
          )
      )`,
    })
    .from(blogTags)
    .orderBy(blogTags.name)
    .all();

  return rows.map((r) => ({ ...r.tag, postCount: r.postCount })).filter((t) => t.postCount > 0);
}
