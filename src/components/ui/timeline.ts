/** Shape consumed by `Timeline.astro`. Kept in a .ts module so it can be
 *  imported as a type from anywhere without pulling in the component. */
export interface TimelineEntry {
  /** e.g. "June 2021 — Present" */
  period: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  /** Rendered as HTML — produced by the markdown pipeline. */
  descriptionHtml?: string | null;
  tags?: string[];
  href?: string | null;
  /** Highlights the node: a current position or an ongoing project. */
  isCurrent?: boolean;
}
