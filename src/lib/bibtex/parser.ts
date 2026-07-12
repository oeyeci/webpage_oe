/**
 * A brace-aware BibTeX parser.
 *
 * Supports everything real-world exports from IEEE Xplore, Scopus, Web of
 * Science and Google Scholar throw at you:
 *
 *   • `@article{key, field = {value}, …}` and `@article(key, …)`
 *   • `{braced}`, `"quoted"` and bare-number values
 *   • `@string{ieee = "IEEE"}` abbreviations and `#` concatenation
 *   • `@comment`/`@preamble` blocks and `%` line comments
 *   • Nested braces and escaped braces inside values
 *   • Trailing commas, arbitrary whitespace, CRLF line endings
 *
 * It never throws on malformed input — it collects diagnostics instead, so the
 * admin sees "entry 3: missing closing brace" rather than a 500.
 */

export interface BibEntry {
  /** Lower-cased entry type without the `@`, e.g. `article`. */
  type: string;
  /** Citation key, e.g. `eyecioglu2026qlid`. */
  key: string;
  /** Field names are lower-cased; values are raw (still LaTeX-encoded). */
  fields: Record<string, string>;
  /** The verbatim source of this entry — stored so BibTeX download is lossless. */
  raw: string;
}

export interface ParseResult {
  entries: BibEntry[];
  errors: string[];
  warnings: string[];
}

const ENTRY_START = /@([a-zA-Z]+)\s*[{(]/g;

/** Finds the index of the brace matching the opener at `start`. */
function matchBrace(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1; // skip escaped char
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits an entry body (everything between the outer braces, after the citation
 * key) into `name = value` pairs, respecting nesting and quotes.
 */
function splitFields(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;

    if (ch === '\\') {
      current += ch + (body[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '"' && depth === 0) inQuotes = !inQuotes;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    if (ch === ',' && depth === 0 && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Resolves one value token: `{braced}`, `"quoted"`, `123`, or a @string macro.
 * Concatenation (`a # " " # b`) is handled by the caller.
 */
function resolveToken(token: string, macros: Record<string, string>): string {
  const t = token.trim();
  if (!t) return '';

  if (t.startsWith('{') && t.endsWith('}')) {
    return t.slice(1, -1);
  }
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1);
  }
  if (/^-?\d+$/.test(t)) return t;

  // Bare word → @string macro, or (commonly) a three-letter month abbreviation.
  const macro = macros[t.toLowerCase()];
  return macro ?? t;
}

/** Splits a value on top-level `#` concatenation operators. */
function splitConcat(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === '\\') {
      current += ch + (value[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '"' && depth === 0) inQuotes = !inQuotes;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    if (ch === '#' && depth === 0 && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Removes `%` line comments that sit outside any entry. */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '\\') {
          out += line[i]! + (line[i + 1] ?? '');
          i += 1;
          continue;
        }
        if (line[i] === '%') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * Parses a BibTeX document, which may contain any number of entries.
 */
export function parseBibtex(input: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entries: BibEntry[] = [];
  const macros: Record<string, string> = {
    jan: 'January', feb: 'February', mar: 'March', apr: 'April',
    may: 'May', jun: 'June', jul: 'July', aug: 'August',
    sep: 'September', oct: 'October', nov: 'November', dec: 'December',
  };

  const src = stripLineComments(input.replace(/\r\n?/g, '\n'));
  const seenKeys = new Set<string>();

  ENTRY_START.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ENTRY_START.exec(src)) !== null) {
    const type = match[1]!.toLowerCase();
    const openIndex = match.index + match[0].length - 1;
    const openChar = src[openIndex]!;
    const closeChar = openChar === '{' ? '}' : ')';

    const closeIndex = matchBrace(src, openIndex, openChar, closeChar);
    if (closeIndex === -1) {
      errors.push(`Unbalanced braces in @${type} entry starting at character ${match.index}.`);
      break;
    }

    const body = src.slice(openIndex + 1, closeIndex);
    // Continue scanning after this entry.
    ENTRY_START.lastIndex = closeIndex + 1;

    if (type === 'comment' || type === 'preamble') continue;

    if (type === 'string') {
      // @string{ abbrev = "Full Name" }
      const eq = body.indexOf('=');
      if (eq > 0) {
        const name = body.slice(0, eq).trim().toLowerCase();
        const value = resolveToken(body.slice(eq + 1).trim(), macros);
        macros[name] = value;
      } else {
        warnings.push('Skipped a malformed @string definition.');
      }
      continue;
    }

    const chunks = splitFields(body);
    if (chunks.length === 0) {
      warnings.push(`Skipped an empty @${type} entry.`);
      continue;
    }

    // The first chunk is the citation key (it has no `=` at top level).
    const first = chunks[0]!;
    const key = first.includes('=') ? '' : first.trim();
    const fieldChunks = key ? chunks.slice(1) : chunks;

    if (!key) {
      warnings.push(`@${type} entry has no citation key; one will be generated.`);
    }

    const fields: Record<string, string> = {};
    for (const chunk of fieldChunks) {
      const eq = chunk.indexOf('=');
      if (eq <= 0) {
        warnings.push(`Ignored malformed field "${chunk.slice(0, 40)}" in @${type}{${key}}.`);
        continue;
      }
      const name = chunk.slice(0, eq).trim().toLowerCase();
      const rawValue = chunk.slice(eq + 1).trim();
      const value = splitConcat(rawValue)
        .map((token) => resolveToken(token, macros))
        .join('')
        .trim();

      if (name) fields[name] = value;
    }

    const finalKey = key || `entry-${entries.length + 1}`;
    if (seenKeys.has(finalKey)) {
      warnings.push(`Duplicate citation key "${finalKey}" within the pasted BibTeX.`);
    }
    seenKeys.add(finalKey);

    if (!fields.title) {
      errors.push(`@${type}{${finalKey}} has no title and cannot be imported.`);
      continue;
    }
    if (!fields.year && !fields.date) {
      warnings.push(`@${type}{${finalKey}} has no year; it will be filed under "Undated".`);
    }

    entries.push({
      type,
      key: finalKey,
      fields,
      raw: src.slice(match.index, closeIndex + 1).trim(),
    });
  }

  if (entries.length === 0 && errors.length === 0) {
    errors.push('No BibTeX entries were found. An entry looks like: @article{key, title = {…}}');
  }

  return { entries, errors, warnings };
}
