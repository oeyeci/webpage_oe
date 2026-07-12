import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { created, handle, json, parseJson } from '../../../../lib/api/response';
import { blogPostSchema } from '../../../../lib/validation/schemas';
import { blogPosts } from '../../../../lib/db/schema';
import {
  listPosts,
  setPostGallery,
  setPostTags,
  uniqueSlug,
  upsertTags,
} from '../../../../lib/repositories/blog';
import { renderMarkdown } from '../../../../lib/content/markdown';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';
import { truncate } from '../../../../lib/utils/text';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();

    const url = new URL(context.request.url);
    const { items, total } = await listPosts(db, {
      includeUnpublished: true,
      search: url.searchParams.get('q') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? '50'),
      offset: Number(url.searchParams.get('offset') ?? '0'),
    });

    return json({ items, total });
  });

/**
 * POST /api/admin/blog — create a post.
 *
 * The markdown is rendered to HTML *here*, once, and both are stored. Every
 * public request then just streams the stored HTML. See lib/content/markdown.ts
 * for why that trade is worth making.
 */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const input = await parseJson(context.request, blogPostSchema);

    const rendered = await renderMarkdown(input.contentMd);
    const slug = await uniqueSlug(db, input.slug ?? input.title);

    /**
     * `published_at` is what the public query filters on, so it must be set the
     * moment a post goes live — not left null for a cron job to fill in later.
     * A scheduled post carries its future timestamp from the start, which means
     * it becomes visible on its own even if the cron never runs.
     */
    const publishedAt =
      input.status === 'published'
        ? (input.publishedAt ? new Date(input.publishedAt) : new Date())
        : input.status === 'scheduled' && input.scheduledFor
          ? new Date(input.scheduledFor)
          : null;

    const post = await db
      .insert(blogPosts)
      .values({
        slug,
        title: input.title,
        excerpt: input.excerpt ?? truncate(rendered.excerpt, 200),
        contentMd: input.contentMd,
        contentHtml: rendered.html,
        toc: rendered.toc,
        readingMinutes: rendered.readingMinutes,
        coverMediaId: input.coverMediaId,
        ogMediaId: input.ogMediaId,
        categoryId: input.categoryId,
        authorId: user.id,
        status: input.status,
        publishedAt,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        isFeatured: input.isFeatured,
        showToc: input.showToc,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        canonicalUrl: input.canonicalUrl,
      })
      .returning()
      .get();

    if (input.tags.length > 0) {
      await setPostTags(db, post.id, await upsertTags(db, input.tags));
    }
    if (input.galleryMediaIds.length > 0) {
      await setPostGallery(db, post.id, input.galleryMediaIds);
    }

    await audit(db, {
      userId: user.id,
      action: 'blog.create',
      entity: 'blog_posts',
      entityId: post.id,
      meta: { title: post.title, status: post.status },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return created(post);
  });
