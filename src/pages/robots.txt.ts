import type { APIRoute } from 'astro';
import { getEnv } from '../lib/context';
import { absoluteUrl } from '../lib/seo';

export const GET: APIRoute = () => {
  const env = getEnv();
  const siteUrl = env.PUBLIC_SITE_URL;

  // Preview and development deployments must never be indexed — otherwise they
  // compete with the real site in search results and split its ranking.
  const isProduction = env.ENVIRONMENT === 'production';

  const body = isProduction
    ? [
        'User-agent: *',
        'Allow: /',
        '',
        '# The admin panel and API are not content.',
        'Disallow: /admin',
        'Disallow: /api/',
        '',
        `Sitemap: ${absoluteUrl('/sitemap.xml', siteUrl)}`,
        '',
      ].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
};
