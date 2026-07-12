# Deployment

Complete walkthrough from a fresh clone to a live site on a custom domain.

**Prerequisites:** Node 22.12+, a Cloudflare account, and a domain on Cloudflare (optional — a
`*.workers.dev` subdomain works too).

---

## 1 · Install and authenticate

```bash
npm install
npx wrangler login
```

---

## 2 · Provision the Cloudflare resources

```bash
npm run bootstrap
```

This creates the D1 database, the R2 bucket and the KV namespace, and prints their IDs. It is
idempotent — a resource that already exists is reported and left alone, so re-running after a
partial failure is safe.

It deliberately does **not** rewrite `wrangler.jsonc` for you: that file has comments a naive
rewrite would strip, and silently editing a checked-in config is how deployments become
unexplainable six months later.

### Paste the IDs into `wrangler.jsonc`

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ondereyecioglu-db",
    "database_id": "1a2b3c4d-…",          // ← from bootstrap
    "migrations_dir": "migrations"
  }
],
"kv_namespaces": [
  { "binding": "KV", "id": "9f8e7d6c…" }  // ← from bootstrap
]
```

Doing it manually:

```bash
npx wrangler d1 create ondereyecioglu-db
npx wrangler r2 bucket create ondereyecioglu-media
npx wrangler kv namespace create KV
```

---

## 3 · Secrets

Secrets are **never** in `wrangler.jsonc`. They are encrypted at rest by Cloudflare and injected at
runtime.

```bash
# Signing key for admin session JWTs. Must be 32+ characters.
openssl rand -base64 48 | npx wrangler secret put JWT_SECRET

# Turnstile — dash.cloudflare.com → Turnstile → Add site
npx wrangler secret put TURNSTILE_SECRET_KEY

# Optional: contact-form email notifications (resend.com).
# Without it, messages are still stored and shown in the admin inbox.
npx wrangler secret put RESEND_API_KEY
```

| Secret | Required | Purpose |
| --- | :---: | --- |
| `JWT_SECRET` | ✅ | Signs admin session tokens (HMAC-SHA256) |
| `TURNSTILE_SECRET_KEY` | ✅ | Verifies contact-form challenges. **Fails closed** if unset — a missing secret must never mean "everyone passes". |
| `RESEND_API_KEY` | — | Emails you when someone uses the contact form |

### Public variables

These live in `wrangler.jsonc` → `vars` and are safe to expose:

```jsonc
"vars": {
  "PUBLIC_SITE_URL": "https://ondereyecioglu.com",   // ← your domain
  "PUBLIC_TURNSTILE_SITE_KEY": "0x4AAA…",            // ← the *site* key (public half)
  "PUBLIC_CF_ANALYTICS_TOKEN": "",                   // ← from Web Analytics, once deployed
  "CONTACT_TO_EMAIL": "you@example.com",
  "CONTACT_FROM_EMAIL": "no-reply@ondereyecioglu.com",
  "MEDIA_PUBLIC_BASE": "/media",
  "ENVIRONMENT": "production"
}
```

> `PUBLIC_TURNSTILE_SITE_KEY` ships with Cloudflare's **test key** (`1x0000…AA`), which always
> passes. Replace it before going live, or your contact form has no spam protection.

---

## 4 · Database

```bash
npm run db:migrate:remote     # apply the schema
npm run db:seed:remote        # first deploy only — loads the CV content
```

`db:seed:remote` **wipes and replaces** all content tables. Run it once, on the first deploy. After
that, content is managed through the admin panel.

To regenerate the seed after editing `seed/publications.bib` or `scripts/build-seed.ts`:

```bash
npm run seed:build
```

---

## 5 · Deploy

```bash
npm run deploy
```

This runs `astro build`, then `wrangler deploy -c dist/server/wrangler.json`.

> **Why that config path?** The Astro adapter merges your `wrangler.jsonc` with the build output
> (worker entry, assets directory) and writes the deployable config to `dist/server/wrangler.json`.
> Deploying from the root config would fail — it has no `main`.

A preview deployment that does not affect production traffic:

```bash
npm run deploy:preview        # wrangler versions upload
```

---

## 6 · Rotate the admin password

The seeded account is flagged `must_change_password`. Rotate it immediately:

```bash
npm run admin:password -- 'your new strong password'
```

Then apply the printed hash:

```bash
npx wrangler d1 execute ondereyecioglu-db --remote \
  --command "UPDATE users SET password_hash = '<hash>', must_change_password = 0 \
             WHERE email = 'you@example.com';"
```

---

## 7 · Custom domain

**Dashboard →** Workers & Pages → `ondereyecioglu` → Settings → Domains & Routes → **Add custom
domain**.

Cloudflare provisions the certificate and the DNS record automatically. Then:

1. Update `PUBLIC_SITE_URL` in `wrangler.jsonc` — it drives canonical URLs, the sitemap, RSS and
   JSON-LD, and a wrong value quietly poisons all four.
2. Redeploy.

---

## 8 · Turnstile

**Dashboard →** Turnstile → **Add site**.

| | |
| --- | --- |
| Domain | `ondereyecioglu.com` (add `localhost` for local testing) |
| Widget mode | **Managed** |

You get two keys:

- **Site key** (public) → `PUBLIC_TURNSTILE_SITE_KEY` in `wrangler.jsonc`
- **Secret key** → `npx wrangler secret put TURNSTILE_SECRET_KEY`

---

## 9 · Web Analytics

**Dashboard →** Analytics & Logs → Web Analytics → **Add a site**.

Copy the token into `PUBLIC_CF_ANALYTICS_TOKEN` and redeploy. Cookieless, privacy-first, and
omitted entirely when the token is blank.

---

## 10 · Verify

```bash
curl -sI https://ondereyecioglu.com | head -1                     # 200
curl -s  https://ondereyecioglu.com/robots.txt                    # Sitemap: …
curl -s  https://ondereyecioglu.com/sitemap.xml | head -3         # <urlset>
curl -s  https://ondereyecioglu.com/rss.xml | head -3             # <rss>
curl -s  https://ondereyecioglu.com/publications.bib | head -2    # % BibTeX library
curl -sI https://ondereyecioglu.com/admin | grep -i location      # → /admin/login
```

Then sign in at `/admin/login` and confirm the dashboard loads.

### Checklist

- [ ] Admin password rotated
- [ ] Real Turnstile keys (not the `1x0000…` test key)
- [ ] `PUBLIC_SITE_URL` matches the live domain
- [ ] `ENVIRONMENT` is `production` (otherwise `robots.txt` disallows everything — deliberately, so
      preview deployments never get indexed)
- [ ] `/admin` redirects to `/admin/login` when signed out
- [ ] Contact form delivers a message
- [ ] Portrait uploaded via Admin → Media → Image slots

---

## Troubleshooting

**Every HTML page returns the 15-byte string `[object Object]` with a 200 status**
(API routes like `/sitemap.xml` still work.)

Astro chose its async-iterable streaming path because it thinks it is running on Node:

```js
// astro/dist/runtime/server/render/util.js
const isNode = typeof process !== 'undefined'
            && Object.prototype.toString.call(process) === '[object process]';
```

`nodejs_compat` — which this project requires — gives workerd a `process` global that satisfies that
check. workerd's `Response` does not accept an async iterable as a body, so it coerces it with
`String()`. The `workerdHtmlStreamingFix` Vite plugin in `astro.config.mjs` pins `isNode` to `false`,
forcing the `ReadableStream` path. **It throws at build time if Astro moves that constant**, so an
upgrade fails loudly instead of silently shipping a blank site.

**Login returns 500 with `Pbkdf2 failed: iteration counts above 100000 are not supported`**
workerd hard-caps PBKDF2 at 100,000 iterations. Node's Web Crypto does not, so a higher count works
locally and dies in production. `src/lib/auth/password.ts` is pinned to 100,000; if you raise it,
every login breaks.

**`The provided Wrangler config main field … doesn't point to an existing file`**
You are deploying with the root `wrangler.jsonc`. Use `-c dist/server/wrangler.json`, or just
`npm run deploy`. Cloudflare **Workers Builds** needs these two commands set in the dashboard:

| Field | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy -c dist/server/wrangler.json` |

**`JWT_SECRET must be set and at least 32 characters long`**
The secret is missing or too short. `openssl rand -base64 48 | npx wrangler secret put JWT_SECRET`.

**Login always fails after a fresh remote seed**
The seed script generates a random salt per run, so the hash in your *local* `seed.sql` is not the
one in the remote database if you re-ran `seed:build` in between. Set the password explicitly with
`npm run admin:password`.

**Contact form always says "Verification is misconfigured"**
`TURNSTILE_SECRET_KEY` is not set. It fails **closed** on purpose.

**Media 404s after deploying**
The R2 bucket name in `wrangler.jsonc` does not match the one you created. Check
`npx wrangler r2 bucket list`.

**Content edits do not appear on the public site**
The edge cache is keyed by a version in KV. Confirm the `KV` binding id is correct — a failed
`bumpContentVersion()` means visitors keep seeing cached pages until the TTL expires (1 hour).

---

## Cost

At the traffic an academic site sees, this runs comfortably inside Cloudflare's **free tier**:

| Service | Free tier | Typical use |
| --- | --- | --- |
| Workers | 100k requests/day | Well under |
| D1 | 5 GB, 5M reads/day | A few MB |
| R2 | 10 GB, no egress fees | A few hundred MB |
| KV | 100k reads/day | Rate limits + one cache version key |
| Turnstile | Unlimited | — |
| Web Analytics | Unlimited | — |

Egress is free on R2 — which is the whole reason media lives there rather than in S3.
