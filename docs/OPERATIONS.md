# Operations

Day-to-day running of the site: content, backups, monitoring, maintenance.

---

## Updating content

Everything is edited at **`/admin`**. Nothing requires a redeploy.

| To change | Go to |
| --- | --- |
| Add a publication | **Publications → Import BibTeX**. Paste one entry or a hundred. |
| Write a post | **Blog → New post** |
| Add a talk or seminar | **Activities → New activity** |
| Positions, projects, theses | **Experience** (three tabs) |
| Biography, education, awards | **About** |
| Portrait, images | **Media → Image slots** |
| Skills and certificates | **Skills** |
| Site title, SEO, toggles | **Settings** |
| Read messages | **Messages** |

### Adding a publication

1. Get the BibTeX from IEEE Xplore, Scopus, Google Scholar or the publisher.
2. **Publications → Import BibTeX** → paste → **Import**.

Everything else is derived: LaTeX escapes are decoded (`Eyecio{\u{g}}lu` → Eyecioğlu), authors are
deduplicated against existing records, the entry is categorised, and the **IEEE citation is
generated**. The original BibTeX is stored verbatim so downloads round-trip exactly.

Parse errors do not abort the import — a paste of 50 entries with one bad entry imports 49 and
reports the one.

**To correct a publication**, re-import the corrected BibTeX with **"Overwrite existing entries"**
ticked. Bibliographic fields are intentionally not editable in the form: `bibtex_raw` is the source
of truth, so the stored entry and its citation can never disagree.

**Citation counts** are entered manually (Publications → Edit) because Google Scholar has no public
API.

### Scheduling a post

Set **Status → Scheduled** and pick a time. The post goes live on its own — the public query treats
a scheduled post whose time has passed as published, so **no background job has to run**. The status
flag is tidied up the next time an admin opens the dashboard.

---

## Backups

### Automatic

Cloudflare D1 keeps **point-in-time recovery for 30 days** on paid plans. Restore:

```bash
npx wrangler d1 time-travel restore ondereyecioglu-db --timestamp=2026-07-01T12:00:00Z
```

Check what is available first:

```bash
npx wrangler d1 time-travel info ondereyecioglu-db
```

### Manual — full

```bash
npm run db:backup            # production
npm run db:backup -- --local # local dev database
```

Writes `backups/<timestamp>/`:

```
database.sql   full SQL dump — restore with `wrangler d1 execute --file`
media/         every object from R2
MANIFEST.txt   what was captured, and how to restore it
```

> The dump contains **password hashes and contact messages**. Store it accordingly. `backups/` is
> git-ignored.

### Manual — content only

**Admin → Settings → Download full backup**, or `GET /api/admin/backup`.

A readable JSON export of every content table. Excludes `users` (password hashes never leave the
database) and the R2 bytes (JSON cannot carry them — the media *metadata and keys* are included so a
restore can re-link them).

Add `?contacts=0` to exclude third-party personal data.

### Recommended cadence

| What | When | How |
| --- | --- | --- |
| D1 time-travel | Continuous | Automatic (paid plans) |
| Full backup | Monthly, and before any schema migration | `npm run db:backup` |
| Content JSON | Before bulk edits | Admin → Settings |

---

## Restoring

**Database:**

```bash
npx wrangler d1 execute ondereyecioglu-db --remote --file=./backups/<stamp>/database.sql
```

**Media** — keys were flattened (`/` → `__`) to sit on a filesystem. Reverse that:

```bash
npx wrangler r2 object put ondereyecioglu-media/blog/2026/07/photo-a1b2.webp \
  --remote --file ./backups/<stamp>/media/blog__2026__07__photo-a1b2.webp
```

---

## Monitoring

### Live logs

```bash
npx wrangler tail
npx wrangler tail --status error       # errors only
npx wrangler tail --search "requestId" # trace a specific 500
```

Every unhandled exception is logged with a **correlation id** that is also returned to the client:

```json
{ "error": "Something went wrong on our side.", "code": "internal_error",
  "requestId": "8f3e2a1b-…" }
```

So a user reporting an error gives you the exact log line. Internal messages and stack traces are
never sent over the network.

### Dashboards

| | |
| --- | --- |
| **Workers → Metrics** | Requests, errors, CPU time, p50/p99 |
| **Workers → Logs** | Observability is enabled at 100% sampling in `wrangler.jsonc` |
| **D1 → Metrics** | Query volume, read/write units, storage |
| **R2 → Metrics** | Storage, Class A/B operations |
| **Web Analytics** | Page views, referrers, Core Web Vitals |

### The audit log

**Admin → Logs** records every administrative mutation: who, what, when, from where. Deletions and
failed logins are highlighted.

Contact-message bodies are **never** copied into it — deleting a message really deletes it.

### What to watch

| Signal | Meaning |
| --- | --- |
| `auth.login_failed` in bursts | Credential stuffing. Rate limiting (8 attempts / 15 min / IP) is already throttling it. |
| `auth.rate_limited` | Someone is hammering login. |
| Rising 500s | Check `wrangler tail --status error` for the `requestId`. |
| Growing D1 storage | Usually `audit_logs`. It self-trims to 5,000 rows. |
| Contact spam getting through | Turnstile keys may still be the test keys. |

---

## Maintenance

### Housekeeping

Two idempotent jobs run when an admin opens the dashboard:

- **Promote due scheduled posts** — cosmetic; they are already public (see
  [ARCHITECTURE.md §5](ARCHITECTURE.md#5--scheduling-has-no-cron)).
- **Prune expired sessions** — expired tokens already fail verification; this just clears the rows.

Neither is load-bearing. If nobody opens the dashboard for a month, the site is still correct.

### Dependencies

```bash
npm outdated
npm update
npm test && npm run check && npm run build
```

Then deploy. `npm audit` currently reports advisories inside **`drizzle-kit`**'s local esbuild
dev-server chain — a build-time tool that never enters the Worker bundle, so it is not a production
exposure.

### Bumping the compatibility date

`wrangler.jsonc` → `compatibility_date`. Move it forward deliberately, then run the full check:

```bash
npm test && npm run check && npm run build && npm run preview
```

### After changing the markdown pipeline

Blog HTML is rendered **at save time**, so changing `src/lib/content/markdown.ts` does **not** update
existing posts. Re-save each post, or write a one-off script that re-renders `content_md` →
`content_html`.

### Rotating the JWT secret

```bash
openssl rand -base64 48 | npx wrangler secret put JWT_SECRET
```

This **invalidates every existing session** — everyone is signed out. That is the point. Do it if you
suspect the secret has leaked.

---

## Security posture

| Control | Where |
| --- | --- |
| PBKDF2-SHA256, 600k iterations | `src/lib/auth/password.ts` |
| HS256 JWT + server-side session (revocable) | `src/lib/auth/session.ts` |
| Rate limiting (login, contact) | `src/lib/security/rate-limit.ts` |
| Turnstile (fails closed) | `src/lib/security/turnstile.ts` |
| CSP, HSTS, X-Frame-Options, nosniff | `src/middleware.ts` |
| Origin checking (CSRF) | `astro.config.mjs` → `security.checkOrigin` |
| Magic-byte MIME sniffing | `src/lib/storage/image.ts` |
| Zod validation on every write | `src/lib/validation/schemas.ts` |
| Audit trail | `src/lib/repositories/contacts.ts` → `audit()` |

If a security issue is found, rotate `JWT_SECRET` first (signs everyone out), then investigate via
the audit log and `wrangler tail`.
