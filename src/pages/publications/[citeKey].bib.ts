import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb } from '../../lib/context';
import { publications } from '../../lib/db/schema';

/** Serves the verbatim BibTeX for a single publication. */
export const GET: APIRoute = async (context) => {
  const citeKey = context.params.citeKey;
  if (!citeKey) return new Response('Not found', { status: 404 });

  const db = getDb();
  const row = await db
    .select({ bibtexRaw: publications.bibtexRaw, citeKey: publications.citeKey })
    .from(publications)
    .where(eq(publications.citeKey, citeKey))
    .get();

  if (!row) return new Response('Not found', { status: 404 });

  return new Response(`${row.bibtexRaw.trim()}\n`, {
    headers: {
      'Content-Type': 'application/x-bibtex; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.citeKey}.bib"`,
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
