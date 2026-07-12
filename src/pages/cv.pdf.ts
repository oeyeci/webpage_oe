import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, getEnv } from '../lib/context';
import { media } from '../lib/db/schema';
import { getProfile } from '../lib/repositories/about';

/**
 * Serves the CV at a stable, shareable URL.
 *
 * The underlying R2 key changes every time a new CV is uploaded (keys carry a
 * random suffix so they can be cached immutably), but `/cv.pdf` never does —
 * which matters, because this is the link that ends up in email signatures and
 * on other people's pages.
 */
export const GET: APIRoute = async () => {
  const db = getDb();
  const env = getEnv();

  const profile = await getProfile(db);
  if (!profile?.cvMediaId) {
    return new Response('No CV has been uploaded yet.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const row = await db.select().from(media).where(eq(media.id, profile.cvMediaId)).get();
  if (!row) return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(row.r2Key);
  if (!object) return new Response('Not found', { status: 404 });

  const filename = `${profile.fullName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}-CV.pdf`;

  return new Response(object.body, {
    headers: {
      'Content-Type': row.mimeType,
      // `inline` opens it in the browser's PDF viewer; the About page's link
      // carries `download`, so the visitor still chooses.
      'Content-Disposition': `inline; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      // The alias is stable but its target changes, so this must revalidate.
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      etag: object.httpEtag,
    },
  });
};
