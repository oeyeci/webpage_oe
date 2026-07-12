import { motion, useReducedMotion } from 'motion/react';
import type { PublicationStats as Stats } from '../../lib/repositories/publications';

/**
 * Publication metrics: headline counters plus a per-year timeline.
 *
 * This is a React island (`client:visible`) because it is the one part of the
 * publications page that genuinely benefits from it — the bars animate in, and
 * the numbers count up. The publication *list* is deliberately server-rendered
 * HTML: it must be crawlable, and 90+ cards of hydrated React would cost far
 * more than it returns. See docs/ARCHITECTURE.md → "Where React earns its cost".
 */

interface Props {
  stats: Stats;
}

const COUNTER_ORDER: Array<{ key: keyof Stats['byCategory']; label: string }> = [
  { key: 'journal', label: 'Journal papers' },
  { key: 'conference', label: 'Conference papers' },
  { key: 'book', label: 'Books' },
  { key: 'chapter', label: 'Book chapters' },
  { key: 'patent', label: 'Patents' },
  { key: 'preprint', label: 'Preprints' },
  { key: 'thesis', label: 'Theses' },
];

export default function PublicationStats({ stats }: Props) {
  const prefersReducedMotion = useReducedMotion();

  const counters = [
    { label: 'Total publications', value: stats.total, accent: true },
    ...COUNTER_ORDER.filter(({ key }) => stats.byCategory[key] > 0).map(({ key, label }) => ({
      label,
      value: stats.byCategory[key],
      accent: false,
    })),
  ];

  const peak = Math.max(1, ...stats.timeline.map((t) => t.count));
  const span =
    stats.firstYear && stats.latestYear ? `${stats.firstYear}–${stats.latestYear}` : null;

  return (
    <div className="space-y-8">
      {/* ── Counters ───────────────────────────────────────────────────── */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {counters.map((counter, index) => (
          <motion.li
            key={counter.label}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.3), ease: [0.22, 1, 0.36, 1] }}
            className={`card p-4 ${counter.accent ? 'border-accent/40 bg-accent-soft' : ''}`}
          >
            <p
              className={`font-serif text-3xl font-semibold tabular-nums ${
                counter.accent ? 'text-accent' : 'text-ink'
              }`}
            >
              {counter.value}
            </p>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-ink-subtle">
              {counter.label}
            </p>
          </motion.li>
        ))}
      </ul>

      {/* ── Timeline ───────────────────────────────────────────────────── */}
      {stats.timeline.length > 1 && (
        <figure className="card p-5 md:p-6">
          <figcaption className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-lg font-semibold">Publications by year</h3>
            {span && <p className="text-xs text-ink-subtle">{span}</p>}
          </figcaption>

          {/*
            A bar chart, but built as a definition list so it is not a
            picture-of-data to a screen reader: each year/count pair is read out
            in order. The bars themselves are aria-hidden decoration on top.
          */}
          <dl className="flex h-44 items-end gap-[3px] md:gap-1.5">
            {stats.timeline.map((point, index) => (
              <div
                key={point.year}
                className="group relative flex h-full flex-1 flex-col justify-end"
              >
                <dt className="sr-only">{point.year}</dt>
                <dd className="sr-only">
                  {point.count} {point.count === 1 ? 'publication' : 'publications'}
                </dd>

                <motion.div
                  aria-hidden="true"
                  initial={prefersReducedMotion ? false : { scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{
                    duration: 0.6,
                    delay: Math.min(index * 0.025, 0.5),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{
                    height: `${Math.max(4, (point.count / peak) * 100)}%`,
                    transformOrigin: 'bottom',
                  }}
                  className="w-full rounded-t-[3px] bg-accent/25 transition-colors duration-200 group-hover:bg-accent"
                />

                {/* Tooltip on hover/focus. */}
                <div
                  role="presentation"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100"
                >
                  <strong className="font-semibold">{point.year}</strong>
                  <span className="text-ink-muted"> · {point.count}</span>
                </div>
              </div>
            ))}
          </dl>

          {/* Sparse year axis — every label would be unreadable across 20 years. */}
          <div
            className="mt-2 flex justify-between font-mono text-[0.6875rem] text-ink-subtle"
            aria-hidden="true"
          >
            <span>{stats.firstYear}</span>
            <span>{stats.latestYear}</span>
          </div>
        </figure>
      )}
    </div>
  );
}
