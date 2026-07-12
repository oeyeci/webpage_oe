# ondereyecioglu.com

The personal academic website of **Assoc. Prof. Dr. Önder Eyecioğlu** — Department of Computer
Engineering, Bolu Abant İzzet Baysal University.

A full serverless web application running entirely on Cloudflare: a public site, a complete
content-management system, a BibTeX-driven publication engine, and a media library. No origin
server, no container, no VM.

```
Astro 7 (SSR)  →  Cloudflare Workers
React 19       →  D1 (SQLite)  ·  R2 (media)  ·  KV (cache + rate limits)
Tailwind 4     →  Drizzle ORM  ·  Turnstile  ·  Web Analytics
```

---

## What it does

| | |
| --- | --- |
| **Publications** | Paste BibTeX → parsed, LaTeX-decoded, authors deduplicated, **IEEE citations generated**, categorised, and filterable. One-click `.bib` export. |
| **Blog** | Markdown + LaTeX + code + raw HTML. Drafts, scheduling, categories, tags, galleries, table of contents, SEO overrides. |
| **Activities** | Talks, seminars and workshops, with image galleries and a chronological timeline. |
| **Experience** | Positions, funded projects and supervised theses. |
| **Skills** | Seven category types, each rendering differently (bars, chips, cards, certificates). |
| **Media** | Upload to R2, resized and converted to WebP in the browser, dimension-validated on the server. |
| **Admin** | Dashboard, audit log, settings, JSON backup, contact inbox. |
| **Contact** | Turnstile, rate limiting, honeypot, email notification. |

---

## Quick start

Requires **Node 22.12+** and a Cloudflare account.

```bash
npm install

# 1 · Provision D1, R2 and KV, then paste the printed IDs into wrangler.jsonc
npm run bootstrap

# 2 · Local secrets
cp .dev.vars.example .dev.vars      # the defaults work for local development

# 3 · Database
npm run db:migrate:local
npm run seed:build                  # generates seed/seed.sql from the CV + BibTeX
npm run db:seed:local

# 4 · Run
npm run dev                         # → http://localhost:4321
```

`astro dev` runs the app inside the **real workerd runtime**, so D1, R2 and KV behave exactly as
they do in production. There is no mock layer and no separate development code path.

**Admin:** <http://localhost:4321/admin> — `oeyeci@gmail.com` / `ChangeMe!2026-Admin`
(the seeded account is flagged `must_change_password`; rotate it with `npm run admin:password`).

---

## Deploying

Full walkthrough in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. The short version:

```bash
npx wrangler secret put JWT_SECRET           # openssl rand -base64 48
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY       # optional

npm run db:migrate:remote
npm run db:seed:remote                       # first deploy only
npm run deploy
```

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on real workerd |
| `npm run build` | Production build |
| `npm run preview` | Build, then serve the built Worker locally |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm test` | Test suite (BibTeX → IEEE engine) |
| `npm run check` | `astro check` — types across `.ts`, `.tsx` and `.astro` |
| `npm run seed:build` | Regenerate `seed/seed.sql` from `seed/publications.bib` + the CV |
| `npm run db:migrate:local` / `:remote` | Apply migrations |
| `npm run db:reset:local` | Drop, migrate and re-seed the local database |
| `npm run db:backup` | Full D1 + R2 backup to `backups/` |
| `npm run admin:password` | Generate a PBKDF2 hash for an admin password |
| `npm run db:generate` | Generate a migration after editing the schema |

---

## Documentation

| | |
| --- | --- |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it is built, and **why** — the decisions worth arguing about |
| **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** | Cloudflare setup, secrets, domains, migrations |
| **[ER-DIAGRAM.md](docs/ER-DIAGRAM.md)** | The 28-table schema, in full |
| **[OPERATIONS.md](docs/OPERATIONS.md)** | Backups, monitoring, maintenance, updating content |

---

## Project layout

```
src/
  lib/
    bibtex/          BibTeX parser, LaTeX decoder, IEEE citation generator  ← the crown jewel
    db/              Drizzle schema (28 tables) + client
    repositories/    Data access. Nothing else touches the database.
    auth/            PBKDF2 hashing, HS256 JWTs, server-side sessions
    content/         Markdown → HTML (remark · rehype · KaTeX · Shiki)
    storage/         R2 upload, magic-byte sniffing, dimension validation
    security/        Turnstile, rate limiting
    api/             Response envelope, error handling, resource registry
    validation/      Zod schemas — every write path parses through one
  components/
    admin/           React islands: the CMS
    publications/    Publication card, statistics island
    ui/              Shared Astro primitives
  pages/
    api/             REST endpoints
    admin/           The CMS screens
    *.astro          The public site
  middleware.ts      Auth gate · security headers · edge cache

migrations/          D1 migrations (generated by drizzle-kit)
seed/                publications.bib → seed.sql
scripts/             bootstrap · build-seed · backup · hash-password
tests/               BibTeX → IEEE test suite
docs/                Architecture, deployment, ER diagram, operations
```

---

## The part worth reading

`src/lib/bibtex/` is where the real work is. Adding a publication is *pasting BibTeX* — everything
else is derived:

```bibtex
@article{eyecioglu2026qlidnet,
  author  = {Eyecio{\u{g}}lu, {\"O}nder and Hang{\i}n, Batuhan},
  title   = {{QLID-Net}: A Hybrid Quantum-Classical Neural Network},
  journal = {IEEE Access},
  volume  = {14},
  pages   = {32118--32133},
  year    = {2026},
  doi     = {10.1109/ACCESS.2026.3668295}
}
```

becomes:

> Ö. Eyecioğlu and B. Hangın, "QLID-Net: A Hybrid Quantum-Classical Neural Network," *IEEE Access*,
> vol. 14, pp. 32118–32133, 2026, doi: 10.1109/ACCESS.2026.3668295.

Note `Eyecio{\u{g}}lu` → **Eyecioğlu**. A naive de-bracing would render that "Eyeciolu", which is
why every LaTeX accent form BibTeX permits is implemented and tested. `npm test` covers 32 cases
across LaTeX decoding, the BibTeX name grammar, parser robustness, all seven entry-type templates,
and preprint detection.

---

## Licence

Source code: MIT. Site content (publications, biography, posts): © Önder Eyecioğlu.
