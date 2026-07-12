// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://ondereyecioglu.com';

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
    plugins: [tailwindcss()],
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
