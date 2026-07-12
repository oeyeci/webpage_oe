/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Ambient declarations.
 *
 * This file must stay a *global script*, not a module — a single top-level
 * `import` would scope every declaration below to the file and silently detach
 * the `Cloudflare.Env` augmentation. Types from other modules are therefore
 * pulled in with inline `import(...)` types instead.
 */

declare namespace Cloudflare {
  /**
   * Bindings and variables declared in `wrangler.jsonc` and `.dev.vars`.
   *
   * This is the interface behind `import { env } from 'cloudflare:workers'`.
   * `wrangler types` can generate it, but it is hand-written here so that
   * adding a binding is a reviewable diff rather than a regenerated artefact,
   * and so the note explaining what each secret is for lives next to it.
   */
  interface Env {
    /* ── Bindings ────────────────────────────────────────────────────────── */
    /** D1 relational database. */
    DB: D1Database;
    /** R2 bucket holding all uploaded media. */
    MEDIA: R2Bucket;
    /** KV: rate-limit counters and the cache-invalidation version. */
    KV: KVNamespace;
    /** Static assets, served by the Workers runtime. */
    ASSETS: Fetcher;

    /* ── Public vars (safe to expose to the browser) ─────────────────────── */
    PUBLIC_SITE_URL: string;
    PUBLIC_TURNSTILE_SITE_KEY: string;
    PUBLIC_CF_ANALYTICS_TOKEN: string;
    MEDIA_PUBLIC_BASE: string;
    CONTACT_TO_EMAIL: string;
    CONTACT_FROM_EMAIL: string;
    ENVIRONMENT: 'development' | 'preview' | 'production';

    /* ── Secrets (`wrangler secret put …`) ───────────────────────────────── */
    /** HMAC-SHA256 signing key for admin session JWTs. */
    JWT_SECRET: string;
    /** Turnstile secret, redeemed against the siteverify endpoint. */
    TURNSTILE_SECRET_KEY: string;
    /** Optional — contact-form email notifications are skipped without it. */
    RESEND_API_KEY?: string;
  }
}

/** The Workers runtime's `ExportedHandler<Env>` looks for a global `Env`. */
interface Env extends Cloudflare.Env {}

declare namespace App {
  interface Locals {
    /** Populated by `src/middleware.ts` when a valid session cookie is present. */
    user: import('./lib/auth/session').SessionUser | null;
  }
}
