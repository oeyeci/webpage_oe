import { motion, useReducedMotion } from 'motion/react';

/**
 * Animated proficiency meter.
 *
 * The visible bar is decoration; the accessible truth is the `progressbar` role
 * with its `aria-valuenow` and a text label. A screen reader announces
 * "Python, 95 percent, Expert" — never "an image of a bar".
 */

interface Props {
  name: string;
  level: number;
  levelLabel?: string | null;
  description?: string | null;
  index?: number;
}

export default function SkillMeter({ name, level, levelLabel, description, index = 0 }: Props) {
  const prefersReducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, level));

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.9375rem] font-medium">{name}</span>
        <span className="shrink-0 font-mono text-xs text-ink-subtle">
          {levelLabel ?? `${clamped}%`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name}${levelLabel ? ` — ${levelLabel}` : ''}`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <motion.div
          initial={prefersReducedMotion ? false : { width: 0 }}
          whileInView={{ width: `${clamped}%` }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{
            duration: 0.9,
            delay: Math.min(index * 0.06, 0.4),
            ease: [0.22, 1, 0.36, 1],
          }}
          className="h-full rounded-full bg-accent"
        />
      </div>

      {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
    </li>
  );
}
