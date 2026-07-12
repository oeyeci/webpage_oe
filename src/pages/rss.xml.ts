import type { APIRoute } from 'astro';
import { getDb, getEnv } from '../lib/context';
import { listPosts } from '../lib/repositories/blog';
import { getSettings } from '../lib/repositories/settings';
import { absoluteUrl } from '../lib/seo';
import { escapeXml } from '../lib/utils/text';
import { toRfc822 } from '../lib/utils/date';

/**
 * RSS 2.0 feed of published blog posts.
 *
 * Full post HTML goes in `content:encoded` (inside CDATA), so a reader can show
 * the whole article; `description` carries the plain-text excerpt for clients
 * that only render that.
 */
export const GET: APIRoute = async () => {
  const db = getDb();
  const env = getEnv();
  const siteUrl = env.PUBLIC_SITE_URL;

  const [{ items: posts }, settings] = await Promise.all([
    listPosts(db, { limit: 30 }),
    getSettings(db),
  ]);

  const siteName = settings['site.title'];
  const lastBuild = posts[0]?.publishedAt ?? new Date();

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/blog/${post.slug}`, siteUrl);

      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        post.publishedAt ? `      <pubDate>${toRfc822(post.publishedAt)}</pubDate>` : null,
        post.excerpt ? `      <description>${escapeXml(post.excerpt)}</description>` : null,
        post.category ? `      <category>${escapeXml(post.category.name)}</category>` : null,
        ...post.tags.map((tag) => `      <category>${escapeXml(tag.name)}</category>`),
        post.authorName
          ? `      <dc:creator><![CDATA[${post.authorName}]]></dc:creator>`
          : null,
        // `]]>` inside the body would close the CDATA section early; splitting it
        // across two sections is the standard, safe escape.
        `      <content:encoded><![CDATA[${post.contentHtml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>`,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)} — Blog</title>
    <link>${escapeXml(absoluteUrl('/blog', siteUrl))}</link>
    <description>${escapeXml(settings['site.description'])}</description>
    <language>${escapeXml(settings['site.locale'])}</language>
    <lastBuildDate>${toRfc822(lastBuild)}</lastBuildDate>
    <atom:link href="${escapeXml(absoluteUrl('/rss.xml', siteUrl))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
};
