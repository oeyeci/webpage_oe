/**
 * Public entry point for the BibTeX subsystem.
 *
 * The admin pastes BibTeX; this module turns it into rows we can store,
 * render, filter and cite — without the admin ever filling in a form field.
 */
import type { PublicationCategory, PublicationEntryType } from '../db/schema';
import { publicationEntryTypes } from '../db/schema';
import { decodeLatex } from './latex';
import { parseAuthors, type ParsedName } from './authors';
import { toCategory, toIeeeCitation } from './ieee';
import { parseBibtex, type BibEntry, type ParseResult } from './parser';
import { slugify } from '../utils/text';

export { parseBibtex, toIeeeCitation, toCategory, parseAuthors, decodeLatex };
export type { BibEntry, ParseResult, ParsedName };
export * from './authors';

/** A publication ready to be inserted, plus its resolved author list. */
export interface PublicationDraft {
  citeKey: string;
  entryType: PublicationEntryType;
  category: PublicationCategory;
  title: string;
  authorsRaw: string;
  journal: string | null;
  booktitle: string | null;
  publisher: string | null;
  school: string | null;
  institution: string | null;
  series: string | null;
  edition: string | null;
  address: string | null;
  volume: string | null;
  number: string | null;
  pages: string | null;
  year: number;
  month: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  projectUrl: string | null;
  codeUrl: string | null;
  slidesUrl: string | null;
  arxivId: string | null;
  isbn: string | null;
  issn: string | null;
  abstract: string | null;
  keywords: string | null;
  note: string | null;
  bibtexRaw: string;
  ieeeCitation: string;
  authors: ParsedName[];
}

function opt(entry: BibEntry, name: string): string | null {
  const raw = entry.fields[name];
  if (!raw) return null;
  const decoded = decodeLatex(raw).trim();
  return decoded || null;
}

/** Normalises a DOI to its bare `10.x/y` form, whatever the input looked like. */
function normalizeDoi(value: string | null): string | null {
  if (!value) return null;
  const doi = value
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  return /^10\.\d{4,9}\//.test(doi) ? doi : doi || null;
}

/** Widens an unknown BibTeX type into one we store, defaulting to `misc`. */
function normalizeEntryType(type: string): PublicationEntryType {
  const known = publicationEntryTypes as readonly string[];
  if (known.includes(type)) return type as PublicationEntryType;
  // Common aliases from non-standard exporters.
  if (type === 'proceedings') return 'inproceedings';
  if (type === 'thesis') return 'phdthesis';
  if (type === 'online' || type === 'electronic' || type === 'www') return 'misc';
  return 'misc';
}

/** Derives `eyecioglu2026qlid` when the pasted entry has no usable key. */
function deriveCiteKey(entry: BibEntry, authors: ParsedName[], year: number): string {
  if (entry.key && !/^entry-\d+$/.test(entry.key)) return entry.key;
  const surname = slugify(authors[0]?.last ?? 'anon').replace(/-/g, '') || 'anon';
  const firstWord =
    decodeLatex(entry.fields.title ?? '')
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
      .find((w) => w.length > 3)
      ?.toLowerCase() ?? 'untitled';
  return `${surname}${year || 'nd'}${firstWord}`.slice(0, 64);
}

/** Extracts an arXiv id from any of the several places exporters hide it. */
function extractArxiv(entry: BibEntry): string | null {
  const eprint = entry.fields.eprint ?? '';
  const archive = entry.fields.archiveprefix ?? '';
  if (eprint && /arxiv/i.test(archive)) return eprint.trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(eprint.trim())) return eprint.trim();

  const url = entry.fields.url ?? '';
  const m = /arxiv\.org\/abs\/([^\s,}]+)/i.exec(url);
  return m ? m[1]!.trim() : null;
}

/** Converts one parsed BibTeX entry into an insertable publication. */
export function toPublicationDraft(entry: BibEntry): PublicationDraft {
  const authors = parseAuthors(entry.fields.author ?? entry.fields.editor ?? '');

  const yearRaw = entry.fields.year ?? entry.fields.date?.slice(0, 4) ?? '';
  const year = Number.parseInt(yearRaw, 10);
  const safeYear = Number.isFinite(year) ? year : 0;

  const entryType = normalizeEntryType(entry.type);
  const normalizedEntry: BibEntry = { ...entry, type: entryType };

  return {
    citeKey: deriveCiteKey(entry, authors, safeYear),
    entryType,
    category: toCategory(normalizedEntry),
    title: decodeLatex(entry.fields.title ?? 'Untitled'),
    authorsRaw: authors.map((a) => a.full).join(', '),
    journal: opt(entry, 'journal') ?? opt(entry, 'journaltitle'),
    booktitle: opt(entry, 'booktitle'),
    publisher: opt(entry, 'publisher'),
    school: opt(entry, 'school'),
    institution: opt(entry, 'institution'),
    series: opt(entry, 'series'),
    edition: opt(entry, 'edition'),
    address: opt(entry, 'address') ?? opt(entry, 'location'),
    volume: opt(entry, 'volume'),
    number: opt(entry, 'number') ?? opt(entry, 'issue'),
    pages: opt(entry, 'pages'),
    year: safeYear,
    month: opt(entry, 'month'),
    doi: normalizeDoi(opt(entry, 'doi')),
    url: opt(entry, 'url'),
    pdfUrl: opt(entry, 'pdf') ?? opt(entry, 'pdfurl'),
    projectUrl: opt(entry, 'project') ?? opt(entry, 'projecturl'),
    codeUrl: opt(entry, 'code') ?? opt(entry, 'codeurl') ?? opt(entry, 'github'),
    slidesUrl: opt(entry, 'slides') ?? opt(entry, 'presentation'),
    arxivId: extractArxiv(entry),
    isbn: opt(entry, 'isbn'),
    issn: opt(entry, 'issn'),
    abstract: opt(entry, 'abstract'),
    keywords: opt(entry, 'keywords'),
    note: opt(entry, 'note'),
    bibtexRaw: entry.raw,
    ieeeCitation: toIeeeCitation(normalizedEntry),
    authors,
  };
}

export interface ImportResult {
  drafts: PublicationDraft[];
  errors: string[];
  warnings: string[];
}

/** Parses a BibTeX document and converts every entry into a draft publication. */
export function parseBibtexToDrafts(input: string): ImportResult {
  const { entries, errors, warnings } = parseBibtex(input);
  const drafts: PublicationDraft[] = [];
  const localWarnings = [...warnings];

  for (const entry of entries) {
    try {
      drafts.push(toPublicationDraft(entry));
    } catch (cause) {
      errors.push(
        `Could not convert @${entry.type}{${entry.key}}: ${
          cause instanceof Error ? cause.message : 'unknown error'
        }`,
      );
    }
  }

  return { drafts, errors, warnings: localWarnings };
}

/**
 * Serialises publications back to a BibTeX document.
 * Stored `bibtexRaw` is preferred so a download round-trips exactly what the
 * publisher issued; only synthesised entries are rebuilt from columns.
 */
export function toBibtexDocument(
  publications: Array<{ bibtexRaw: string | null; citeKey: string }>,
): string {
  return publications
    .map((p) => (p.bibtexRaw?.trim() ? p.bibtexRaw.trim() : `@misc{${p.citeKey}}`))
    .join('\n\n')
    .concat('\n');
}
