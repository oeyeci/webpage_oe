import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdmin } from '../../../lib/context';
import { handle, json, parseJson } from '../../../lib/api/response';
import { renderMarkdown } from '../../../lib/content/markdown';

export const prerender = false;

const previewSchema = z.object({
  markdown: z.string().max(400_000),
});

/**
 * Renders markdown for the editor's live preview.
 *
 * Deliberately the *same* pipeline the save path uses, rather than a JS
 * markdown renderer in the browser. A preview that is rendered by different
 * code from the published page is a preview that lies — and it would also mean
 * shipping remark, rehype, KaTeX and Shiki to the client.
 */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);

    const { markdown } = await parseJson(context.request, previewSchema);
    const rendered = await renderMarkdown(markdown);

    return json({
      html: rendered.html,
      toc: rendered.toc,
      readingMinutes: rendered.readingMinutes,
      excerpt: rendered.excerpt,
    });
  });
