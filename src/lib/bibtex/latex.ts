/**
 * LaTeX → Unicode decoding for BibTeX field values.
 *
 * This matters more than it looks: publisher-exported BibTeX writes Turkish
 * names as `Eyecio{\u{g}}lu`, `{\c{S}}ent{\"u}rk`, `Kay{\i}{\c{s}}l{\i}` — and a
 * naive "strip the braces" approach would render those as "Eyeciolu". Every
 * accent form BibTeX permits is handled:
 *
 *   \"{o}   \"o   {\"o}   {\"{o}}   → ö
 *   \u{g}   \ug              → ğ
 *   \c{s}                    → ş
 *   \i                       → ı  (dotless i)
 */

/** \<cmd>{x} accent commands, keyed by command then base letter. */
const ACCENTS: Record<string, Record<string, string>> = {
  // Diaeresis / umlaut
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü', Y: 'Ÿ' },
  // Acute
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ć', N: 'Ń', S: 'Ś', Z: 'Ź' },
  // Grave
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  // Circumflex
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', c: 'ĉ', g: 'ĝ', s: 'ŝ', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  // Tilde
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  // Macron
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū', A: 'Ā', E: 'Ē', I: 'Ī', O: 'Ō', U: 'Ū' },
  // Dot above  — \.{I} is Turkish dotted capital İ
  '.': { c: 'ċ', e: 'ė', g: 'ġ', z: 'ż', I: 'İ', C: 'Ċ', E: 'Ė', G: 'Ġ', Z: 'Ż' },
  // Breve — Turkish ğ
  u: { a: 'ă', e: 'ĕ', g: 'ğ', i: 'ĭ', o: 'ŏ', u: 'ŭ', A: 'Ă', E: 'Ĕ', G: 'Ğ', I: 'Ĭ', O: 'Ŏ', U: 'Ŭ' },
  // Cedilla — Turkish ç / ş
  c: { c: 'ç', s: 'ş', g: 'ģ', k: 'ķ', l: 'ļ', n: 'ņ', r: 'ŗ', t: 'ţ', e: 'ȩ', C: 'Ç', S: 'Ş', G: 'Ģ', K: 'Ķ', L: 'Ļ', N: 'Ņ', R: 'Ŗ', T: 'Ţ' },
  // Caron / háček
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', d: 'ď', e: 'ě', n: 'ň', t: 'ť', g: 'ǧ', C: 'Č', S: 'Š', Z: 'Ž', R: 'Ř', D: 'Ď', E: 'Ě', N: 'Ň', T: 'Ť' },
  // Ring above
  r: { a: 'å', u: 'ů', A: 'Å', U: 'Ů' },
  // Double acute
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  // Ogonek
  k: { a: 'ą', e: 'ę', i: 'į', u: 'ų', A: 'Ą', E: 'Ę', I: 'Į', U: 'Ų' },
  // Bar / stroke
  b: { l: 'ł', L: 'Ł' },
  // Dot below
  d: { a: 'ạ', e: 'ẹ', i: 'ị', o: 'ọ', u: 'ụ' },
};

/** Standalone commands that take no argument. */
const SYMBOLS: Record<string, string> = {
  i: 'ı', // dotless i (Turkish)
  j: 'ȷ',
  o: 'ø',
  O: 'Ø',
  l: 'ł',
  L: 'Ł',
  aa: 'å',
  AA: 'Å',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  ss: 'ß',
  SS: 'ẞ',
  dh: 'ð',
  DH: 'Ð',
  th: 'þ',
  TH: 'Þ',
  dj: 'đ',
  DJ: 'Đ',
  ng: 'ŋ',
  NG: 'Ŋ',
  pounds: '£',
  copyright: '©',
  dag: '†',
  ddag: '‡',
  ldots: '…',
  dots: '…',
  textendash: '–',
  textemdash: '—',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  textregistered: '®',
  texttrademark: '™',
  textbullet: '•',
  textdegree: '°',
  textperiodcentered: '·',
  textbackslash: '\\',
  degree: '°',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  omega: 'ω',
  Omega: 'Ω',
  Delta: 'Δ',
  times: '×',
  pm: '±',
  leq: '≤',
  geq: '≥',
  neq: '≠',
  approx: '≈',
  infty: '∞',
  rightarrow: '→',
  to: '→',
};

/** Escaped punctuation: `\&` → `&`. */
const ESCAPED = new Set(['&', '%', '$', '#', '_', '{', '}']);

/**
 * Reads the argument of an accent command starting at `i`, where `i` points at
 * the first character after the command name. Handles `{o}`, `{\i}`, and a
 * bare `o`. Returns the decoded base letter and the index just past it.
 */
function readAccentArgument(src: string, i: number): { letter: string; next: number } | null {
  let j = i;
  while (j < src.length && src[j] === ' ') j += 1;
  if (j >= src.length) return null;

  if (src[j] === '{') {
    // Find the matching close brace.
    let depth = 1;
    let k = j + 1;
    while (k < src.length && depth > 0) {
      if (src[k] === '{') depth += 1;
      else if (src[k] === '}') depth -= 1;
      if (depth > 0) k += 1;
    }
    const inner = src.slice(j + 1, k);
    // `\i` / `\j` inside the braces are the dotless forms used under accents.
    const letter = inner === '\\i' ? 'i' : inner === '\\j' ? 'j' : decodeLatex(inner);
    return { letter, next: k + 1 };
  }

  // Bare single letter, e.g. \"o
  return { letter: src[j]!, next: j + 1 };
}

/**
 * Decodes LaTeX markup to plain Unicode text.
 *
 * `keepBraces = false` also removes the capitalisation-protecting braces
 * (`{DNA}` → `DNA`), which is what you want for display.
 */
export function decodeLatex(input: string): string {
  let out = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) {
        i += 1;
        continue;
      }

      // \& \% \$ \# \_ \{ \}
      if (ESCAPED.has(next)) {
        out += next;
        i += 2;
        continue;
      }

      // Non-letter accent commands: \" \' \` \^ \~ \= \.
      if (ACCENTS[next] && !/[a-zA-Z]/.test(next)) {
        const arg = readAccentArgument(input, i + 2);
        if (arg) {
          out += ACCENTS[next]![arg.letter] ?? arg.letter;
          i = arg.next;
          continue;
        }
        i += 2;
        continue;
      }

      // Letter commands: \u{g}, \c{s}, \v{s}, \ss, \i, \textbf{…}
      const nameMatch = /^[a-zA-Z]+/.exec(input.slice(i + 1));
      if (nameMatch) {
        const name = nameMatch[0];

        // Longest-match first: an accent command name is a single letter, but a
        // symbol name may be longer (\ss vs \s), so try symbols before accents
        // when the full name is a known symbol.
        if (SYMBOLS[name]) {
          out += SYMBOLS[name];
          i += 1 + name.length;
          // LaTeX swallows the space that terminates a control word.
          if (input[i] === ' ') i += 1;
          continue;
        }

        // Single-letter accent command with an argument.
        const head = name[0]!;
        if (name.length === 1 && ACCENTS[head]) {
          const arg = readAccentArgument(input, i + 2);
          if (arg) {
            out += ACCENTS[head]![arg.letter] ?? arg.letter;
            i = arg.next;
            continue;
          }
        }

        // Formatting commands we unwrap: \textbf{x} \emph{x} \text{x} \mathrm{x}
        const rest = input.slice(i + 1 + name.length);
        if (rest.startsWith('{')) {
          let depth = 1;
          let k = 1;
          while (k < rest.length && depth > 0) {
            if (rest[k] === '{') depth += 1;
            else if (rest[k] === '}') depth -= 1;
            if (depth > 0) k += 1;
          }
          out += decodeLatex(rest.slice(1, k));
          i += 1 + name.length + k + 1;
          continue;
        }

        // Unknown bare command — drop it.
        i += 1 + name.length;
        if (input[i] === ' ') i += 1;
        continue;
      }

      // Escaped backslash or unknown symbol.
      i += 2;
      continue;
    }

    // Capitalisation-protecting braces are dropped for display.
    if (ch === '{' || ch === '}') {
      i += 1;
      continue;
    }

    // Ties render as regular spaces.
    if (ch === '~') {
      out += ' ';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  // Dashes and quotes, after command expansion so we don't damage `--` in URLs
  // that were already emitted verbatim.
  return out
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the value still contains LaTeX math that should be rendered by KaTeX. */
export function containsMath(value: string): boolean {
  return /\$[^$]+\$/.test(value);
}
