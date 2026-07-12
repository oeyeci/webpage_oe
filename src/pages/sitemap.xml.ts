import type { APIRoute } from 'astro';
import { getDb, getEnv } from '../lib/context';
import { listPosts } from '../lib/repositories/blog';
import { listActivities } from '../lib/repositories/activities';
import { absoluteUrl } from '../lib/seo';
import { escapeXml } from '../lib/utils/text';

/**
 * XML sitemap.
 *
 * Generated at request time rather than at build time, because the content
 * lives in D1 — a build-time sitemap would go stale the moment a post is
 * published. It is cached at the edge and invalidated by the content version,
 * so the cost is one D1 read per hour, not per crawl.
 */

interface Entry {
  path: string;
  lastmod?: Date | string | null;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

export const GET: APIRoute = async () => {
  const db = getDb();
  const env = getEnv();
  const siteUrl = env.PUBLIC_SITE_URL;

  const [posts, activities] = await Promise.all([
    listPosts(db, { limit: 500 }),
    listActivities(db, { limit: 500 }),
  ]);

  const entries: Entry[] = [
    { path: '/', changefreq: 'weekly', priority: 1.0 },
    { path: '/about', changefreq: 'monthly', priority: 0.9 },
    { path: '/publications', changefreq: 'weekly', priority: 0.9 },
    { path: '/experiences', changefreq: 'monthly', priority: 0.8 },
    { path: '/blog', changefreq: 'daily', priority: 0.8 },
    { path: '/activities', changefreq: 'weekly', priority: 0.7 },
    { path: '/skills', changefreq: 'monthly', priority: 0.6 },
    { path: '/contact', changefreq: 'yearly', priority: 0.6 },
    { path: '/privacy', changefreq: 'yearly', priority: 0.2 },

    ...posts.items.map((post): Entry => ({
      path: `/blog/${post.slug}`,
      lastmod: post.updatedAt,
      changefreq: 'monthly',
      priority: post.isFeatured ? 0.8 : 0.7,
    })),

    ...activities.map((activity): Entry => ({
      path: `/activities/${activity.slug}`,
      lastmod: activity.updatedAt,
      changefreq: 'yearly',
      priority: 0.5,
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((entry) => {
    const lastmod =
      entry.lastmod instanceof Date
        ? entry.lastmod.toISOString()
        : entry.lastmod
          ? new Date(entry.lastmod).toISOString()
          : null;

    return [
      '  <url>',
      `    <loc>${escapeXml(absoluteUrl(entry.path, siteUrl))}</loc>`,
      lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority.toFixed(1)}</priority>`,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n');
  })
  .join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
};
