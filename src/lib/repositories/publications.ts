/**
 * Publications repository.
 *
 * Owns the write path from "admin pasted BibTeX" to "rows in three tables",
 * and the read path that the public page, the statistics panel and the RSS/
 * sitemap generators all share.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db';
import {
  authors,
  publicationAuthors,
  publications,
  type Publication,
  type PublicationCategory,
} from '../db/schema';
import type { PublicationDraft } from '../bibtex';
import { normalizeKey } from '../utils/text';

export interface PublicationWithAuthors extends Publication {
  authorList: Array<{ id: number; fullName: string; isSelf: boolean; orcid: string | null }>;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Authors
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Upserts an author by its normalised key and returns the row id.
 *
 * Deduplication is on the accent-folded "last, first" key, so
 * `Eyecio{\u{g}}lu, {\"O}nder` and `Eyecioglu, Onder` — which show up in
 * different publishers' exports of the same paper — collapse to one author.
 */
async function upsertAuthor(
  db: Db,
  name: { full: string; first: string; last: string; normalized: string },
): Promise<number> {
  const existing = await db
    .select({ id: authors.id })
    .from(authors)
    .where(eq(authors.normalized, name.normalized))
    .get();

  if (existing) return existing.id;

  const inserted = await db
    .insert(authors)
    .values({
      fullName: name.full,
      firstName: name.first || null,
      lastName: name.last || null,
      normalized: name.normalized,
    })
    .returning({ id: authors.id })
    .get();

  return inserted.id;
}

/** Marks the author records that represent the site owner, so the UI can bold them. */
export async function markSelfAuthors(db: Db, aliases: string[]): Promise<number> {
  const keys = aliases.map(normalizeKey).filter(Boolean);
  if (keys.length === 0) return 0;

  const result = await db
    .update(authors)
    .set({ isSelf: true })
    .where(inArray(authors.normalized, keys))
    .run();

  return result.meta.changes ?? 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Writes
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SaveOptions {
  /** Overwrite an entry whose citation key already exists. */
  overwrite?: boolean;
}

export type SaveOutcome =
  | { status: 'created'; id: number; citeKey: string }
  | { status: 'updated'; id: number; citeKey: string }
  | { status: 'skipped'; citeKey: string; reason: string };

/**
 * Persists one draft: the publication row, its author rows, and the join rows
 * that preserve byline order.
 *
 * D1 does not support interactive transactions, so the write is ordered so that
 * any interruption leaves the database consistent-enough: the publication is
 * written first, then its authors are replaced wholesale. A crash between the
 * two leaves a publication with a stale author list — visible and repairable by
 * re-importing — rather than orphaned join rows pointing at nothing.
 */
export async function savePublication(
  db: Db,
  draft: PublicationDraft,
  options: SaveOptions = {},
): Promise<SaveOutcome> {
  const existing = await db
    .select({ id: publications.id })
    .from(publications)
    .where(eq(publications.citeKey, draft.citeKey))
    .get();

  if (existing && !options.overwrite) {
    return {
      status: 'skipped',
      citeKey: draft.citeKey,
      reason: 'A publication with this citation key already exists.',
    };
  }

  const values = {
    citeKey: draft.citeKey,
    entryType: draft.entryType,
    category: draft.category,
    title: draft.title,
    authorsRaw: draft.authorsRaw,
    journal: draft.journal,
    booktitle: draft.booktitle,
    publisher: draft.publisher,
    school: draft.school,
    institution: draft.institution,
    series: draft.series,
    edition: draft.edition,
    address: draft.address,
    volume: draft.volume,
    number: draft.number,
    pages: draft.pages,
    year: draft.year,
    month: draft.month,
    doi: draft.doi,
    url: draft.url,
    pdfUrl: draft.pdfUrl,
    projectUrl: draft.projectUrl,
    codeUrl: draft.codeUrl,
    slidesUrl: draft.slidesUrl,
    arxivId: draft.arxivId,
    isbn: draft.isbn,
    issn: draft.issn,
    abstract: draft.abstract,
    keywords: draft.keywords,
    note: draft.note,
    bibtexRaw: draft.bibtexRaw,
    ieeeCitation: draft.ieeeCitation,
    updatedAt: new Date(),
  };

  let id: number;
  if (existing) {
    await db.update(publications).set(values).where(eq(publications.id, existing.id));
    id = existing.id;
  } else {
    const inserted = await db
      .insert(publications)
      .values(values)
      .returning({ id: publications.id })
      .get();
    id = inserted.id;
  }

  // Replace the byline wholesale — simpler and more predictable than diffing,
  // and the row counts here are single digits.
  await db.delete(publicationAuthors).where(eq(publicationAuthors.publicationId, id));

  const seen = new Set<number>();
  let position = 0;
  for (const name of draft.authors) {
    if (name.isOthers) continue;

    const authorId = await upsertAuthor(db, name);
    // A malformed export can list the same person twice; the join table's
    // composite primary key would reject the duplicate insert.
    if (seen.has(authorId)) continue;
    seen.add(authorId);

    await db.insert(publicationAuthors).values({
      publicationId: id,
      authorId,
      position: position++,
    });
  }

  return { status: existing ? 'updated' : 'created', id, citeKey: draft.citeKey };
}

/** Imports a batch of drafts, reporting the outcome of each. */
export async function importPublications(
  db: Db,
  drafts: PublicationDraft[],
  options: SaveOptions = {},
): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  for (const draft of drafts) {
    outcomes.push(await savePublication(db, draft, options));
  }
  return outcomes;
}

export async function updatePublicationMeta(
  db: Db,
  id: number,
  patch: Partial<
    Pick<
      Publication,
      | 'isFeatured'
      | 'isPublished'
      | 'citationCount'
      | 'pdfUrl'
      | 'projectUrl'
      | 'codeUrl'
      | 'slidesUrl'
      | 'abstract'
      | 'doi'
      | 'url'
    >
  >,
): Promise<void> {
  await db
    .update(publications)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(publications.id, id));
}

export async function deletePublication(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(publications).where(eq(publications.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Reads
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Loads publications with their authors.
 *
 * Deliberately two queries, not a join with N rows per publication: the whole
 * corpus is ~100 rows, so we fetch the publications and their bylines and
 * stitch them in memory. That is one round trip per table instead of one per
 * publication (the N+1 that would otherwise be tempting here).
 */
export async function listPublications(
  db: Db,
  options: { includeUnpublished?: boolean; category?: PublicationCategory } = {},
): Promise<PublicationWithAuthors[]> {
  const query = db.select().from(publications).$dynamic();

  const filters = [];
  if (!options.includeUnpublished) filters.push(eq(publications.isPublished, true));
  if (options.category) filters.push(eq(publications.category, options.category));
  if (filters.length) query.where(and(...filters));

  const rows = await query.orderBy(desc(publications.year), desc(publications.id)).all();
  if (rows.length === 0) return [];

  const bylines = await db
    .select({
      publicationId: publicationAuthors.publicationId,
      position: publicationAuthors.position,
      id: authors.id,
      fullName: authors.fullName,
      isSelf: authors.isSelf,
      orcid: authors.orcid,
    })
    .from(publicationAuthors)
    .innerJoin(authors, eq(authors.id, publicationAuthors.authorId))
    .where(
      inArray(
        publicationAuthors.publicationId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(publicationAuthors.publicationId, publicationAuthors.position)
    .all();

  const byPublication = new Map<number, PublicationWithAuthors['authorList']>();
  for (const row of bylines) {
    const list = byPublication.get(row.publicationId) ?? [];
    list.push({ id: row.id, fullName: row.fullName, isSelf: row.isSelf, orcid: row.orcid });
    byPublication.set(row.publicationId, list);
  }

  return rows.map((row) => ({ ...row, authorList: byPublication.get(row.id) ?? [] }));
}

export async function getPublication(db: Db, id: number): Promise<Publication | undefined> {
  return db.select().from(publications).where(eq(publications.id, id)).get();
}

export async function getFeaturedPublications(db: Db, limit = 3): Promise<PublicationWithAuthors[]> {
  const all = await listPublications(db);
  const featured = all.filter((p) => p.isFeatured);
  return (featured.length > 0 ? featured : all).slice(0, limit);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Statistics
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PublicationStats {
  total: number;
  byCategory: Record<PublicationCategory, number>;
  /** Ascending by year — drives the timeline chart. */
  timeline: Array<{ year: number; count: number }>;
  totalCitations: number;
  firstYear: number | null;
  latestYear: number | null;
  /** Distinct co-authors, excluding the site owner. */
  coAuthors: number;
  /** Publications where the owner is listed first. */
  firstAuthorCount: number;
}

const EMPTY_CATEGORIES: Record<PublicationCategory, number> = {
  journal: 0,
  conference: 0,
  book: 0,
  chapter: 0,
  thesis: 0,
  preprint: 0,
  patent: 0,
  other: 0,
};

/** Aggregates the numbers behind the "Google-Scholar-style" counters. */
export async function getPublicationStats(db: Db): Promise<PublicationStats> {
  const categoryRows = await db
    .select({ category: publications.category, n: count() })
    .from(publications)
    .where(eq(publications.isPublished, true))
    .groupBy(publications.category)
    .all();

  const yearRows = await db
    .select({ year: publications.year, n: count() })
    .from(publications)
    .where(eq(publications.isPublished, true))
    .groupBy(publications.year)
    .orderBy(publications.year)
    .all();

  const citationRow = await db
    .select({ total: sql<number>`coalesce(sum(${publications.citationCount}), 0)` })
    .from(publications)
    .where(eq(publications.isPublished, true))
    .get();

  const coAuthorRow = await db
    .select({ n: sql<number>`count(distinct ${publicationAuthors.authorId})` })
    .from(publicationAuthors)
    .innerJoin(authors, eq(authors.id, publicationAuthors.authorId))
    .where(eq(authors.isSelf, false))
    .get();

  const firstAuthorRow = await db
    .select({ n: count() })
    .from(publicationAuthors)
    .innerJoin(authors, eq(authors.id, publicationAuthors.authorId))
    .where(and(eq(authors.isSelf, true), eq(publicationAuthors.position, 0)))
    .get();

  const byCategory = { ...EMPTY_CATEGORIES };
  for (const row of categoryRows) byCategory[row.category] = row.n;

  const timeline = yearRows
    .filter((r) => r.year > 0)
    .map((r) => ({ year: r.year, count: r.n }));

  return {
    total: categoryRows.reduce((sum, r) => sum + r.n, 0),
    byCategory,
    timeline,
    totalCitations: citationRow?.total ?? 0,
    firstYear: timeline[0]?.year ?? null,
    latestYear: timeline[timeline.length - 1]?.year ?? null,
    coAuthors: coAuthorRow?.n ?? 0,
    firstAuthorCount: firstAuthorRow?.n ?? 0,
  };
}

/** Groups publications by year, newest first — the public page's layout. */
export function groupByYear(
  items: PublicationWithAuthors[],
): Array<{ year: number; items: PublicationWithAuthors[] }> {
  const groups = new Map<number, PublicationWithAuthors[]>();
  for (const item of items) {
    const list = groups.get(item.year) ?? [];
    list.push(item);
    groups.set(item.year, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, items: list }));
}
