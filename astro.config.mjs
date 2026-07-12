// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://ondereyecioglu.com';

/**
 * Forces Astro to stream HTML as a `ReadableStream` rather than an async
 * iterable when running on workerd.
 *
 * Astro picks between the two with this check
 * (astro/dist/runtime/server/render/util.js):
 *
 *   const isNode = typeof process !== 'undefined'
 *               && Object.prototype.toString.call(process) === '[object process]';
 *
 * We must enable `nodejs_compat` — the adapter imports `node:events`, and the
 * remark/rehype pipeline needs Node builtins. That flag hands workerd a
 * `process` global which *satisfies the check above*, so Astro concludes it is
 * running on Node and renders the page to an **async iterable**.
 *
 * workerd's `Response` does not accept an async iterable as a body. Instead of
 * throwing, it coerces the value with `String()` — so every HTML page was
 * served as the 15-byte string "[object Object]", with a 200 status. API routes
 * were unaffected because they construct their own `Response` from a string,
 * which is why /sitemap.xml and /rss.xml worked while every page did not.
 *
 * `isNode` has exactly one consumer in Astro (the streaming branch in
 * render/page.js), so pinning it to `false` is safe: it only selects the
 * ReadableStream path, which workerd handles natively.
 *
 * The plugin throws if the constant ever disappears, so an Astro upgrade that
 * fixes this properly fails the build loudly instead of silently reverting to
 * a broken site.
 */
function workerdHtmlStreamingFix() {
  const TARGET = 'astro/dist/runtime/server/render/util.js';
  const NEEDLE = 'Object.prototype.toString.call(process) === "[object process]"';

  return {
    name: 'workerd-html-streaming-fix',
    enforce: /** @type {const} */ ('post'),

    /** @param {string} code @param {string} id */
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith(TARGET)) return null;

      if (!code.includes(NEEDLE)) {
        throw new Error(
          "[workerd-html-streaming-fix] Astro's `isNode` check is no longer where " +
            'this patch expects it. Re-verify whether Astro still renders to an ' +
            'async iterable on workerd before removing this plugin — see the comment ' +
            'in astro.config.mjs.',
        );
      }

      return code.replace(NEEDLE, 'false /* forced: running on workerd, not Node */');
    },
  };
}

export default defineConfig({
  site: SITE,

  // Server-rendered on Cloudflare Workers. Individual routes opt into
  // static generation with `export const prerender = true`.
  output: 'server',

  adapter: cloudflare({
    // `astro dev` runs the app inside the real workerd runtime via
    // @cloudflare/vite-plugin, so D1, R2 and KV behave locally exactly as they
    // do in production — no mocks, no separate code path.
    imageService: 'compile',
    // Reuse the KV namespace we already provision instead of letting Astro
    // auto-provision a second one for its session store.
    sessionKVBindingName: 'KV',
  }),

  integrations: [react()],

  vite: {
    plugins: [tailwindcss(), workerdHtmlStreamingFix()],
  },

  build: {
    inlineStylesheets: 'auto',
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },

  security: {
    // Rejects cross-origin form posts — CSRF defence on top of SameSite cookies.
    checkOrigin: true,
  },

  devToolbar: { enabled: false },
});
