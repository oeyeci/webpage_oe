/** Date formatting helpers. All output is deterministic and locale-pinned
 *  to `en-GB`-style ordering so SSR and client hydration never disagree. */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTHS_SHORT = [
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'May',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sept.',
  'Oct.',
  'Nov.',
  'Dec.',
] as const;

/** Parses `YYYY`, `YYYY-MM` or `YYYY-MM-DD` without timezone drift. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 0;
  const day = m[3] ? Number(m[3]) : 1;
  return new Date(Date.UTC(year, month, day));
}

/** "March 2023" — the precision the CV actually has for most positions. */
export function formatMonthYear(value: string | null | undefined): string {
  const d = parseIsoDate(value);
  if (!d) return '';
  const hasMonth = /^\d{4}-\d{2}/.test(value!.trim());
  return hasMonth ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(d.getUTCFullYear());
}

/** "13 March 2023" */
export function formatLongDate(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : parseIsoDate(value);
  if (!d) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mar. 2023" — IEEE reference style. */
export function formatIeeeMonth(month: string | null | undefined): string {
  if (!month) return '';
  const raw = month.trim().toLowerCase();
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 12) {
    return MONTHS_SHORT[asNumber - 1]!;
  }
  const idx = MONTHS.findIndex((m) => m.toLowerCase().startsWith(raw.slice(0, 3)));
  return idx >= 0 ? MONTHS_SHORT[idx]! : '';
}

/** Renders an open-ended position range, e.g. "June 2021 — Present". */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  isCurrent = false,
): string {
  const from = formatMonthYear(start);
  if (isCurrent || !end) return from ? `${from} — Present` : 'Present';
  const to = formatMonthYear(end);
  return from === to ? from : `${from} — ${to}`;
}

/** ISO-8601 string for `<time datetime>` and structured data. */
export function toIsoString(value: Date | string | number | null | undefined): string {
  if (value == null) return '';
  const d =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value * 1000)
        : parseIsoDate(value);
  return d ? d.toISOString() : '';
}

/** RFC-822 date, required by the RSS 2.0 spec. */
export function toRfc822(value: Date): string {
  return value.toUTCString();
}

/** "3 days ago" — used in the admin dashboard only. */
export function timeAgo(value: Date | number): string {
  const then = value instanceof Date ? value.getTime() : value * 1000;
  const seconds = Math.round((Date.now() - then) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(-Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(-seconds, 'second');
}
