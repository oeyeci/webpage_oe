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
import { blogPostSchema } from '../../../../lib/validation/schemas';
import { blogPosts } from '../../../../lib/db/schema';
import {
  deletePost,
  getPostById,
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

    const post = await getPostById(db, id);
    if (!post) return notFound();

    return json(post);
  });

/** PUT /api/admin/blog/[id] — full update (the editor always sends the whole post). */
export const PUT: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getPostById(db, id);
    if (!existing) return notFound();

    const input = await parseJson(context.request, blogPostSchema);

    const rendered = await renderMarkdown(input.contentMd);
    const slug = await uniqueSlug(db, input.slug ?? input.title, id);

    /**
     * Preserve the original publication timestamp across edits. Re-stamping it
     * on every save would silently reorder the blog (and the RSS feed) every
     * time a typo is fixed.
     */
    const publishedAt =
      input.status === 'published'
        ? (existing.publishedAt ??
          (input.publishedAt ? new Date(input.publishedAt) : new Date()))
        : input.status === 'scheduled' && input.scheduledFor
          ? new Date(input.scheduledFor)
          : null;

    const post = await db
      .update(blogPosts)
      .set({
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
        status: input.status,
        publishedAt,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        isFeatured: input.isFeatured,
        showToc: input.showToc,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        canonicalUrl: input.canonicalUrl,
        updatedAt: new Date(),
      })
      .where(eq(blogPosts.id, id))
      .returning()
      .get();

    await setPostTags(db, id, await upsertTags(db, input.tags));
    await setPostGallery(db, id, input.galleryMediaIds);

    await audit(db, {
      userId: user.id,
      action: 'blog.update',
      entity: 'blog_posts',
      entityId: id,
      meta: { title: post.title, status: post.status },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(post);
  });

export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getPostById(db, id);
    if (!existing) return notFound();

    await deletePost(db, id);

    await audit(db, {
      userId: user.id,
      action: 'blog.delete',
      entity: 'blog_posts',
      entityId: id,
      meta: { title: existing.title },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return noContent();
  });
