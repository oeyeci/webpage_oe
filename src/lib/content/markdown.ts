/**
 * Markdown → HTML rendering for blog posts, activities and biography fields.
 *
 * Rendering happens **once, on save** (in the admin API) and the HTML is stored
 * on the row. Public requests therefore never pay for parsing, syntax
 * highlighting or KaTeX — they just stream a string out of D1. That is the
 * single biggest lever on the Lighthouse performance score for a database-
 * driven site, and it's why `blog_posts` has both `content_md` and
 * `content_html`.
 *
 * The pipeline supports everything the brief asks for:
 *   • Markdown + GFM (tables, task lists, strikethrough, footnotes)
 *   • Raw HTML passthrough — YouTube iframes, figures, custom embeds
 *   • LaTeX via `$…$` / `$$…$$`, rendered to HTML+MathML by KaTeX
 *   • Fenced code blocks with build-time syntax highlighting (Shiki)
 *   • Heading anchors + an extracted table of contents
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root } from 'hast';

import { createHighlighterCore } from 'shiki/core';
import type { HighlighterGeneric } from '@shikijs/types';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';

import { readingMinutes, stripHtml, truncate } from '../utils/text';

export interface TocItem {
  depth: number;
  id: string;
  text: string;
}

export interface RenderedContent {
  html: string;
  toc: TocItem[];
  readingMinutes: number;
  /** Plain-text excerpt, suitable for meta descriptions and cards. */
  excerpt: string;
  plainText: string;
}

/**
 * Collects `<h2>`–`<h4>` into a table of contents.
 * Runs after `rehype-slug`, so every heading already has a stable id.
 */
function collectToc(sink: TocItem[]) {
  return () => (tree: Root) => {
    visit(tree, 'element', (node) => {
      const match = /^h([2-4])$/.exec(node.tagName);
      if (!match) return;

      const id = String(node.properties?.id ?? '');
      if (!id) return;

      // `hast-util-to-string` would also pick up the anchor link injected by
      // rehype-autolink-headings; this plugin runs before that one, so the
      // heading still contains only its own text.
      const text = hastToString(node).trim();
      if (text) sink.push({ depth: Number(match[1]), id, text });
    });
  };
}

/**
 * Syntax highlighting.
 *
 * Shiki's default bundle registers **every** TextMate grammar it ships — around
 * 200 of them. In a Worker that is not a rounding error: it added ~4 MB to the
 * bundle (emacs-lisp, wolfram, wasm, cpp…), pushing the gzipped size to 2.5 MB
 * against Cloudflare's 3 MB free-plan ceiling.
 *
 * So the highlighter is built from `shiki/core` with an explicit language list —
 * the ones that actually appear in a computational-science blog. An unknown
 * language falls back to plain text rather than failing the save.
 *
 * The **JavaScript** regex engine (rather than the default Oniguruma WASM) keeps
 * this WASM-free, which is what lets it run in the Workers runtime at all.
 */
const LANGUAGES = [
  import('@shikijs/langs/python'),
  import('@shikijs/langs/typescript'),
  import('@shikijs/langs/javascript'),
  import('@shikijs/langs/tsx'),
  import('@shikijs/langs/bash'),
  import('@shikijs/langs/c'),
  import('@shikijs/langs/cpp'),
  import('@shikijs/langs/fortran-free-form'),
  import('@shikijs/langs/matlab'),
  import('@shikijs/langs/r'),
  import('@shikijs/langs/sql'),
  import('@shikijs/langs/json'),
  import('@shikijs/langs/yaml'),
  import('@shikijs/langs/latex'),
  import('@shikijs/langs/bibtex'),
  import('@shikijs/langs/diff'),
  import('@shikijs/langs/html'),
  import('@shikijs/langs/css'),
  import('@shikijs/langs/rust'),
  import('@shikijs/langs/go'),
  import('@shikijs/langs/java'),
  import('@shikijs/langs/markdown'),
];

const THEMES = [
  import('@shikijs/themes/github-light'),
  import('@shikijs/themes/github-dark'),
];

/**
 * One highlighter per isolate, created lazily on first use.
 *
 * Rendering only happens on save (a rare, admin-only path), so an isolate that
 * never serves an admin write never pays to construct this at all.
 */
let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    langs: LANGUAGES,
    themes: THEMES,
    engine: createJavaScriptRegexEngine(),
  });

  return highlighterPromise;
}

/**
 * Dual themes emitted as CSS variables, so a code block re-themes instantly
 * with the rest of the page — no second highlight pass, no flash of the wrong
 * palette on load. See `prose.css` → "Shiki dual-theme output".
 */
const SHIKI_OPTIONS = {
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: false,
  cssVariablePrefix: '--shiki-',
  fallbackLanguage: 'text',
} as const;

/** Renders Markdown (with GFM, LaTeX, raw HTML and code) to HTML. */
export async function renderMarkdown(markdown: string): Promise<RenderedContent> {
  const toc: TocItem[] = [];
  const highlighter = await getHighlighter();

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    // `allowDangerousHtml` + `rehype-raw` is what lets an author drop a YouTube
    // iframe or a <figure> into a post. The admin panel is the only writer and
    // it sits behind authentication, so this is authored content, not user
    // input — see docs/ARCHITECTURE.md ("Trust boundaries").
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // KaTeX renders both HTML and MathML by default, which is what gives the
    // equations an accessible representation for screen readers.
    // `throwOnError: false` degrades a broken formula to visible red source
    // text instead of failing the whole save.
    .use(rehypeKatex, { throwOnError: false, strict: false })
    .use(rehypeSlug)
    .use(collectToc(toc))
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: {
        className: ['heading-anchor'],
        ariaLabel: 'Permalink to this section',
      },
      content: { type: 'text', value: '#' },
    })
    // `createHighlighterCore` returns `HighlighterCore`; the plugin's signature
    // asks for `HighlighterGeneric<any, any>`. It is the same object — the
    // generic form is how the *bundled* entrypoint types itself, and that is the
    // entrypoint we are deliberately not using. So this cast is to the plugin's
    // own declared parameter type, not a claim about the value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .use(
      rehypeShikiFromHighlighter,
      highlighter as unknown as HighlighterGeneric<any, any>,
      SHIKI_OPTIONS,
    )
    .use(rehypeExternalLinks, {
      target: '_blank',
      rel: ['noopener', 'noreferrer'],
      protocols: ['http', 'https'],
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  const html = String(file);
  const plainText = stripHtml(html);

  return {
    html,
    toc,
    readingMinutes: readingMinutes(markdown),
    excerpt: truncate(plainText, 180),
    plainText,
  };
}

/**
 * Renders a short rich-text field (biography, activity description).
 * Same pipeline, minus the table of contents and heading anchors.
 */
export async function renderRichText(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // KaTeX renders both HTML and MathML by default, which is what gives the
    // equations an accessible representation for screen readers.
    // `throwOnError: false` degrades a broken formula to visible red source
    // text instead of failing the whole save.
    .use(rehypeKatex, { throwOnError: false, strict: false })
    .use(rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return String(file);
}
