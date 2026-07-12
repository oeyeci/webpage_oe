import type { APIRoute } from 'astro';
import { getDb } from '../lib/context';
import { listPublications } from '../lib/repositories/publications';
import { toBibtexDocument } from '../lib/bibtex';

/**
 * The complete BibTeX library.
 *
 * Serves each entry's stored source verbatim, so what a reader downloads is
 * byte-for-byte what the publisher issued — round-tripping it through a
 * serialiser would silently drop fields we do not model.
 */
export const GET: APIRoute = async () => {
  const db = getDb();
  const publications = await listPublications(db);

  const header = [
    '% BibTeX library — Önder Eyecioğlu',
    `% ${publications.length} entries, exported ${new Date().toISOString().slice(0, 10)}`,
    '',
    '',
  ].join('\n');

  return new Response(header + toBibtexDocument(publications), {
    headers: {
      'Content-Type': 'application/x-bibtex; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ondereyecioglu.bib"',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
