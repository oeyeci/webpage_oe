/**
 * BibTeX name grammar.
 *
 * BibTeX permits three shapes, and they mean different things:
 *
 *   1. "First von Last"           → Ludwig van Beethoven
 *   2. "von Last, First"          → van Beethoven, Ludwig
 *   3. "von Last, Jr, First"      → Vallée Poussin, Jr, Charles Louis
 *
 * Getting this wrong is how citation tools end up printing "Van, L. B." — so
 * the particle ("von") detection and the comma forms are both implemented
 * rather than assuming "everything before the last space is the first name".
 */
import { decodeLatex } from './latex';
import { normalizeKey } from '../utils/text';

export interface ParsedName {
  first: string;
  von: string;
  last: string;
  jr: string;
  /** Display form: "Önder Eyecioğlu". */
  full: string;
  /** Dedupe key: accent-folded, lower-cased "last, first". */
  normalized: string;
  /** True for the literal BibTeX token `others`, which renders as "et al." */
  isOthers: boolean;
}

/** Splits a BibTeX author field on top-level " and " separators. */
export function splitAuthorList(field: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = '';
  const src = field.trim();

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    if (
      depth === 0 &&
      (ch === 'a' || ch === 'A') &&
      /^\s$/.test(src[i - 1] ?? ' ') &&
      /^and\s/i.test(src.slice(i))
    ) {
      names.push(current.trim());
      current = '';
      i += 3; // skip "and" + the following space is consumed by trim
      continue;
    }
    current += ch;
  }
  if (current.trim()) names.push(current.trim());

  return names.filter(Boolean);
}

/** Splits on spaces, but keeps `{...}` groups intact. */
function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of value) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** A token is a particle when its first *unbraced* letter is lower-case. */
function isParticle(token: string): boolean {
  const decoded = decodeLatex(token);
  const first = decoded[0];
  if (!first) return false;
  // A brace-protected token like {van der Waals} is a surname, not a particle.
  if (token.startsWith('{')) return false;
  return first === first.toLowerCase() && first !== first.toUpperCase();
}

/** Parses one BibTeX name into its components. */
export function parseName(raw: string): ParsedName {
  const trimmed = raw.trim();

  if (trimmed.toLowerCase() === 'others') {
    return {
      first: '',
      von: '',
      last: 'others',
      jr: '',
      full: 'et al.',
      normalized: 'others',
      isOthers: true,
    };
  }

  // Split on top-level commas.
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of trimmed) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  let first = '';
  let von = '';
  let last = '';
  let jr = '';

  if (segments.length === 1) {
    // Form 1 — "First von Last"
    const tokens = tokenize(segments[0]!.trim());

    if (tokens.length === 1) {
      last = tokens[0] ?? '';
    } else {
      // The von run is the longest lower-case stretch that is not the final token.
      let vonStart = -1;
      let vonEnd = -1;
      for (let i = 0; i < tokens.length - 1; i += 1) {
        if (isParticle(tokens[i]!)) {
          if (vonStart === -1) vonStart = i;
          vonEnd = i;
        }
      }

      if (vonStart === -1) {
        last = tokens[tokens.length - 1]!;
        first = tokens.slice(0, -1).join(' ');
      } else {
        first = tokens.slice(0, vonStart).join(' ');
        von = tokens.slice(vonStart, vonEnd + 1).join(' ');
        last = tokens.slice(vonEnd + 1).join(' ');
      }
    }
  } else {
    // Form 2 — "von Last, First"   |   Form 3 — "von Last, Jr, First"
    const lastPart = tokenize(segments[0]!.trim());
    if (segments.length >= 3) {
      jr = segments[1]!.trim();
      first = segments.slice(2).join(', ').trim();
    } else {
      first = segments[1]!.trim();
    }

    let vonEnd = -1;
    for (let i = 0; i < lastPart.length - 1; i += 1) {
      if (isParticle(lastPart[i]!)) vonEnd = i;
      else break;
    }
    if (vonEnd >= 0) {
      von = lastPart.slice(0, vonEnd + 1).join(' ');
      last = lastPart.slice(vonEnd + 1).join(' ');
    } else {
      last = lastPart.join(' ');
    }
  }

  const dFirst = decodeLatex(first);
  const dVon = decodeLatex(von);
  const dLast = decodeLatex(last);
  const dJr = decodeLatex(jr);

  const full = [dFirst, dVon, dLast, dJr].filter(Boolean).join(' ').trim();

  return {
    first: dFirst,
    von: dVon,
    last: dLast,
    jr: dJr,
    full,
    normalized: normalizeKey(`${dVon} ${dLast}, ${dFirst}`),
    isOthers: false,
  };
}

/** Parses a whole `author = {...}` / `editor = {...}` field. */
export function parseAuthors(field: string): ParsedName[] {
  if (!field.trim()) return [];
  return splitAuthorList(field).map(parseName);
}

/**
 * Reduces a given name to IEEE initials: "Jean-Pierre" → "J.-P.".
 * Hyphenated and multi-part given names both keep their structure.
 */
export function toInitials(first: string): string {
  if (!first) return '';
  return first
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split('-')
        .filter(Boolean)
        .map((seg) => {
          const letter = seg[0];
          return letter ? `${letter.toUpperCase()}.` : '';
        })
        .join('-'),
    )
    .join(' ')
    .trim();
}

/** IEEE renders a single author as "Ö. Eyecioğlu" (initials first, then surname). */
export function formatNameIeee(name: ParsedName): string {
  if (name.isOthers) return 'et al.';
  const initials = toInitials(name.first);
  const surname = [name.von, name.last].filter(Boolean).join(' ');
  const withJr = name.jr ? `${surname}, ${name.jr}` : surname;
  return [initials, withJr].filter(Boolean).join(' ').trim();
}

/**
 * Joins an author list the way the IEEE Editorial Style Manual specifies:
 *
 *   1 author   → "A. Author"
 *   2 authors  → "A. Author and B. Author"
 *   3–6        → "A. Author, B. Author, and C. Author"   (serial comma)
 *   > 6        → "A. Author et al."
 */
export function formatAuthorsIeee(names: ParsedName[]): string {
  const list = names.filter((n) => !n.isOthers);
  const hasOthers = names.some((n) => n.isOthers);

  if (list.length === 0) return '';

  if (hasOthers || list.length > 6) {
    return `${formatNameIeee(list[0]!)} et al.`;
  }
  if (list.length === 1) return formatNameIeee(list[0]!);
  if (list.length === 2) {
    return `${formatNameIeee(list[0]!)} and ${formatNameIeee(list[1]!)}`;
  }

  const head = list.slice(0, -1).map(formatNameIeee).join(', ');
  return `${head}, and ${formatNameIeee(list[list.length - 1]!)}`;
}

/** "E. Editor, Ed." / "A. One and B. Two, Eds." */
export function formatEditorsIeee(names: ParsedName[]): string {
  if (names.length === 0) return '';
  const joined = formatAuthorsIeee(names);
  return `${joined}, ${names.length > 1 ? 'Eds.' : 'Ed.'}`;
}
