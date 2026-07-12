/**
 * IEEE reference-style citation generation.
 *
 * Follows the IEEE Editorial Style Manual / IEEE Reference Guide. Each entry
 * type has its own template — a journal article and a conference paper are
 * genuinely different strings, not the same string with a different field.
 *
 *   Journal:    A. Author and B. Author, "Title of paper," Journal Name,
 *               vol. 4, no. 2, pp. 11–18, Mar. 2023, doi: 10.xxxx/yyyy.
 *   Conference: A. Author, "Title of paper," in Proc. Conf. Name, City,
 *               Country, 2025, pp. 744–749.
 *   Book:       A. Author, Title of Book, 2nd ed. City, Country: Publisher, 2020.
 *   Chapter:    A. Author, "Chapter title," in Book Title, E. Editor, Ed.
 *               City: Publisher, 2019, pp. 1–20.
 *   Thesis:     A. Author, "Title," Ph.D. dissertation, Dept., Univ., City, 2012.
 *   Preprint:   A. Author, "Title," 2024, arXiv:2401.00001.
 *   Patent:     A. Author, "Title," Turkish Patent 2020/17759, Nov. 5, 2020.
 */
import type { BibEntry } from './parser';
import { decodeLatex } from './latex';
import { formatAuthorsIeee, formatEditorsIeee, parseAuthors } from './authors';
import { formatIeeeMonth } from '../utils/date';

/** Trims a trailing comma/period so segments can be joined without doubling up. */
function clean(part: string): string {
  return part.trim().replace(/[,.\s]+$/, '');
}

/**
 * Joins non-empty segments with ", " and terminates with a single period.
 *
 * A quoted title already carries its comma *inside* the quotes — `"Title,"` —
 * because that is what IEEE (and American typographic convention) requires. So
 * when the text so far already ends in a comma, we join with a plain space
 * instead of adding a second one.
 */
function sentence(parts: Array<string | undefined | null>): string {
  const segments = parts.map((p) => (p ? p.trim() : '')).filter(Boolean);

  let out = '';
  for (const segment of segments) {
    if (!out) {
      out = segment;
      continue;
    }
    out += /,["'”]$/.test(out) || out.endsWith(',') ? ` ${segment}` : `, ${segment}`;
  }

  return out ? `${out.replace(/[,\s]+$/, '')}.` : '';
}

/** Page ranges use an en dash in IEEE, not a hyphen. */
function formatPages(pages: string | undefined): string {
  if (!pages) return '';
  const normalized = decodeLatex(pages).replace(/\s*(--|–|-)\s*/g, '–').trim();
  if (!normalized) return '';
  return normalized.includes('–') ? `pp. ${normalized}` : `p. ${normalized}`;
}

function field(entry: BibEntry, name: string): string {
  const raw = entry.fields[name];
  return raw ? decodeLatex(raw) : '';
}

/** "Mar. 2023" / "2023" — IEEE puts the month before the year when known. */
function monthYear(entry: BibEntry): string {
  const year = field(entry, 'year') || field(entry, 'date').slice(0, 4);
  const month = formatIeeeMonth(entry.fields.month);
  return [month, year].filter(Boolean).join(' ');
}

/** IEEE abbreviates "Proceedings of the" to "Proc." */
function proceedingsName(booktitle: string): string {
  const name = booktitle.trim();
  if (!name) return '';
  if (/^(proc\.|proceedings)/i.test(name)) {
    return name.replace(/^proceedings\s+of\s+(the\s+)?/i, 'Proc. ').replace(/^proceedings/i, 'Proc.');
  }
  return `Proc. ${name}`;
}

/** DOI is rendered as a trailing `doi:` clause; falls back to a bare URL. */
function trailingLink(entry: BibEntry): string {
  const doi = field(entry, 'doi').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (doi) return `doi: ${doi}`;

  const eprint = field(entry, 'eprint') || field(entry, 'arxivid');
  if (eprint) return `arXiv:${eprint}`;

  const url = field(entry, 'url');
  if (url) return `[Online]. Available: ${url}`;

  return '';
}

/**
 * Builds the IEEE reference string for a single BibTeX entry.
 * The result is stored on the publication row and regenerated on every edit.
 */
export function toIeeeCitation(entry: BibEntry): string {
  const authors = formatAuthorsIeee(parseAuthors(entry.fields.author ?? ''));
  const editors = formatEditorsIeee(parseAuthors(entry.fields.editor ?? ''));
  const title = clean(field(entry, 'title'));
  const year = field(entry, 'year') || field(entry, 'date').slice(0, 4);
  const pages = formatPages(entry.fields.pages);
  const volume = field(entry, 'volume');
  const number = field(entry, 'number') || field(entry, 'issue');
  const publisher = field(entry, 'publisher');
  const address = field(entry, 'address') || field(entry, 'location');
  const edition = field(entry, 'edition');
  const link = trailingLink(entry);

  switch (entry.type) {
    /* ── Journal article ─────────────────────────────────────────────────── */
    case 'article': {
      const journal = field(entry, 'journal') || field(entry, 'journaltitle');
      return sentence([
        authors,
        title ? `"${title},"` : '',
        journal ? `${journal}` : '',
        volume ? `vol. ${volume}` : '',
        number ? `no. ${number}` : '',
        pages,
        monthYear(entry),
        link,
      ]);
    }

    /* ── Conference paper ────────────────────────────────────────────────── */
    case 'inproceedings':
    case 'conference': {
      const venue = proceedingsName(field(entry, 'booktitle'));
      return sentence([
        authors,
        title ? `"${title},"` : '',
        venue ? `in ${venue}` : '',
        address,
        year,
        pages,
        link,
      ]);
    }

    /* ── Whole book ──────────────────────────────────────────────────────── */
    case 'book': {
      // Book titles are italicised in IEEE and are NOT wrapped in quotes.
      // The title is closed by a period (or by the edition), then the imprint:
      //   A. Author, Title of Book, 3rd ed. New York, NY, USA: Wiley, 2019.
      //   A. Author, Title of Book. New York, NY, USA: Wiley, 2019.
      const byline = authors || editors;
      const imprint = [address, publisher].filter(Boolean).join(': ');

      let out = [byline, title].filter(Boolean).join(', ');
      out += edition ? `, ${edition} ed.` : '.';
      if (imprint) out += ` ${imprint}`;
      if (year) out += `${imprint ? ',' : ''} ${year}`;
      if (link) out += `, ${link}`;

      return `${out.replace(/[,.\s]+$/, '')}.`;
    }

    /* ── Chapter in an edited book ───────────────────────────────────────── */
    case 'inbook':
    case 'incollection': {
      const bookTitle = field(entry, 'booktitle') || field(entry, 'title');
      const chapterTitle = entry.type === 'incollection' ? title : field(entry, 'chapter') || title;
      const place = [address, publisher].filter(Boolean).join(': ');
      return sentence([
        authors,
        chapterTitle ? `"${chapterTitle},"` : '',
        bookTitle && bookTitle !== chapterTitle ? `in ${bookTitle}` : '',
        editors,
        place,
        year,
        pages,
        link,
      ]);
    }

    /* ── Theses ──────────────────────────────────────────────────────────── */
    case 'phdthesis':
    case 'mastersthesis': {
      const kind = entry.type === 'phdthesis' ? 'Ph.D. dissertation' : 'M.S. thesis';
      const dept = field(entry, 'department') || field(entry, 'type');
      const school = field(entry, 'school') || field(entry, 'institution');
      return sentence([
        authors,
        title ? `"${title},"` : '',
        entry.type === 'phdthesis' || entry.type === 'mastersthesis' ? kind : '',
        dept && dept !== kind ? dept : '',
        school,
        address,
        year,
        link,
      ]);
    }

    /* ── Technical report ────────────────────────────────────────────────── */
    case 'techreport': {
      const institution = field(entry, 'institution') || field(entry, 'school');
      const reportNumber = field(entry, 'number');
      return sentence([
        authors,
        title ? `"${title},"` : '',
        institution,
        address,
        reportNumber ? `Rep. ${reportNumber}` : '',
        monthYear(entry),
        link,
      ]);
    }

    /* ── Patent ──────────────────────────────────────────────────────────── */
    case 'patent': {
      const nationality = field(entry, 'nationality') || field(entry, 'country') || '';
      const patentNumber = field(entry, 'number') || field(entry, 'patentnumber');
      const label = [nationality, 'Patent', patentNumber].filter(Boolean).join(' ');
      const day = field(entry, 'day');
      const month = formatIeeeMonth(entry.fields.month);
      const date = [month, day ? `${day},` : '', year].filter(Boolean).join(' ').replace(/\s+/g, ' ');
      return sentence([authors, title ? `"${title},"` : '', label, date || year, link]);
    }

    /* ── Preprint / everything else ──────────────────────────────────────── */
    case 'unpublished':
    case 'misc':
    default: {
      const howPublished = field(entry, 'howpublished');
      const note = field(entry, 'note');
      return sentence([
        authors,
        title ? `"${title},"` : '',
        howPublished,
        field(entry, 'journal'),
        monthYear(entry),
        note,
        link,
      ]);
    }
  }
}

/**
 * Maps a BibTeX entry type to the coarse bucket used for grouping, filtering
 * and the publication statistics on the public page.
 */
export function toCategory(entry: BibEntry): import('../db/schema').PublicationCategory {
  const journal = (entry.fields.journal ?? '').toLowerCase();

  /**
   * A preprint announces itself in one of several places depending on the
   * exporter: `archivePrefix = {arXiv}`, a bare arXiv id in `eprint`
   * (`2401.01234`), an arXiv URL, or the journal name itself.
   */
  const isPreprint = (): boolean => {
    const eprint = (entry.fields.eprint ?? '').trim();
    const archive = entry.fields.archiveprefix ?? entry.fields.eprinttype ?? '';
    const howPublished = entry.fields.howpublished ?? '';
    const url = entry.fields.url ?? '';

    return (
      /arxiv|biorxiv|ssrn|preprint/i.test(archive) ||
      /arxiv|biorxiv|ssrn|preprint/i.test(journal) ||
      /arxiv|preprint/i.test(howPublished) ||
      /arxiv\.org/i.test(url) ||
      /^\d{4}\.\d{4,5}(v\d+)?$/.test(eprint)
    );
  };

  switch (entry.type) {
    case 'article':
      // An @article hosted on arXiv is a preprint, not a peer-reviewed paper.
      return isPreprint() ? 'preprint' : 'journal';
    case 'inproceedings':
    case 'conference':
      return 'conference';
    case 'book':
      return 'book';
    case 'inbook':
    case 'incollection':
      return 'chapter';
    case 'phdthesis':
    case 'mastersthesis':
      return 'thesis';
    case 'patent':
      return 'patent';
    case 'misc':
    case 'unpublished':
      return isPreprint() ? 'preprint' : 'other';
    default:
      return 'other';
  }
}
