/**
 * Pure text helpers shared by the server and the browser bundles.
 * Everything here must run unchanged in the Workers runtime — no Node APIs.
 */

/** Combining diacritical marks left behind by NFD normalisation (U+0300-U+036F). */
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');

/** Strips diacritics so "Eyecioğlu" and "Eyecioglu" compare equal. */
export function foldAccents(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'O')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss');
}

/** URL-safe slug. Turkish characters are transliterated, not dropped. */
export function slugify(input: string): string {
  return foldAccents(input)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/**
 * Case-insensitive, accent-insensitive comparison key.
 * Used to dedupe author records and to match search queries.
 */
export function normalizeKey(input: string): string {
  return foldAccents(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Collapses whitespace and trims. */
export function squish(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes text for safe interpolation into XML (sitemap / RSS). */
export function escapeXml(input: string): string {
  return escapeHtml(input);
}

/** Removes HTML tags — used to derive excerpts and meta descriptions. */
export function stripHtml(html: string): string {
  return squish(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

/** Truncates on a word boundary and appends an ellipsis. */
export function truncate(input: string, max = 160): string {
  const text = squish(input);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Reading time at 200 wpm — the figure most publishing platforms use.
 * Code blocks are counted at a slower rate because they are read, not skimmed.
 */
export function readingMinutes(markdown: string): number {
  const codeBlocks = markdown.match(/```[\s\S]*?```/g) ?? [];
  const codeWords = codeBlocks.join(' ').split(/\s+/).filter(Boolean).length;
  const prose = markdown.replace(/```[\s\S]*?```/g, ' ');
  const proseWords = prose.split(/\s+/).filter(Boolean).length;
  const minutes = proseWords / 200 + codeWords / 80;
  return Math.max(1, Math.round(minutes));
}

/** `tailwind-merge`-lite: joins truthy class names. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
