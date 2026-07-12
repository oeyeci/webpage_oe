# Architecture

This document explains **why** the system is built the way it is. The parts that are obvious are
covered briefly; the parts where a reasonable engineer would have chosen differently are argued
in full.

---

## 1 · The shape of it

```
                  ┌─────────────────────────────────────────────┐
   Visitor  ─────▶│         Cloudflare edge (300+ PoPs)         │
                  │                                             │
                  │   Cache API ──── hit ────▶ cached HTML      │
                  │        │                                    │
                  │       miss                                  │
                  │        ▼                                    │
                  │   ┌─────────────────────────────────────┐   │
                  │   │        Worker (Astro SSR)           │   │
                  │   │                                     │   │
                  │   │   middleware.ts                     │   │
                  │   │     · session → locals.user         │   │
                  │   │     · /admin gate                   │   │
                  │   │     · security headers              │   │
                  │   │     · edge cache (versioned)        │   │
                  │   │                                     │   │
                  │   │   pages/     repositories/          │   │
                  │   └──────┬──────────┬─────────┬─────────┘   │
                  └──────────┼──────────┼─────────┼─────────────┘
                             │          │         │
                        ┌────▼───┐ ┌────▼───┐ ┌───▼────┐
                        │   D1   │ │   R2   │ │   KV   │
                        │ SQLite │ │ media  │ │ cache  │
                        └────────┘ └────────┘ │ limits │
                                              └────────┘
```

One Worker. No origin. The database, the object store and the cache are all bindings — there is no
network hop to a separate service, and no connection pool to exhaust.

---

## 2 · Why Astro, not Next.js

The brief allowed either. Astro wins here for one reason that dominates everything else:

**This is a content site, and content sites should not ship a framework.**

Astro renders to HTML by default and hydrates *only* the components you explicitly mark as islands.
The publications page — 45 cards, filtering, search, sorting, a stats chart — ships **~9 KB of
JavaScript**, and most of that is the stats chart. The equivalent Next.js App Router page ships the
React runtime whether you use it or not.

That matters because the brief also asked for **Lighthouse 100 on performance**. Those two
requirements — "use React" and "score 100" — are in tension on a content page, and the resolution is
not to compromise on either but to **put React where it earns its cost**:

| Surface | Approach | Why |
| --- | --- | --- |
| Public pages | Server-rendered HTML, ~1 KB inline JS | Crawlable, instant, zero hydration |
| Publication filters | Vanilla JS over the rendered DOM | The cards already exist in the HTML. Serialising 45 publications to JSON *and* shipping React to re-render them would be strictly slower for an identical result. |
| Publication statistics | **React island** + Framer Motion | Genuinely animated. Earns its bytes. |
| Contact form | **React island** | Real client state: validation, async submit, Turnstile token. |
| Admin panel | **React throughout** | A CMS is an application, not a document. This is what React is *for*. |

So the site uses React heavily — in the ~15 admin screens where interactivity is the product — and
barely at all on the pages a stranger will actually load.

---

## 3 · The BibTeX engine

`src/lib/bibtex/` is the feature the whole site is organised around. Adding a publication is
**pasting BibTeX**; everything downstream is derived.

```
BibTeX text
    │
    ├─ parser.ts     brace-aware tokeniser. @string macros, # concatenation,
    │                nested braces, "quoted" / {braced} / bare values,
    │                @comment, % line comments, CRLF, trailing commas.
    │                Never throws — collects diagnostics.
    │
    ├─ latex.ts      LaTeX → Unicode. Every accent form BibTeX permits:
    │                  \"{o}  \"o  {\"o}  {\"{o}}   → ö
    │                  \u{g}  → ğ      \c{s} → ş      \i → ı
    │
    ├─ authors.ts    The BibTeX name grammar — all three forms:
    │                  "First von Last"
    │                  "von Last, First"
    │                  "von Last, Jr, First"
    │                plus IEEE initials ("Jean-Pierre" → "J.-P.")
    │
    └─ ieee.ts       One template per entry type. A journal article and a
                     conference paper are genuinely different strings.
```

### Why write a parser instead of using a library

Because the failure mode is *silent and public*. A library that de-braces `Eyecio{\u{g}}lu` into
"Eyeciolu" produces a plausible-looking string that is wrong on every page of the site. Turkish
names are not an edge case here — they are most of the corpus.

So the parser is 250 lines, the LaTeX decoder handles every accent command in the BibTeX spec, and
**`npm test` covers 32 cases** across decoding, name parsing, parser robustness, all seven IEEE
templates, and preprint detection. Two real bugs were caught by those tests during development
(a doubled comma after quoted titles; arXiv preprints misclassified because the marker lives in
`archivePrefix`, not `eprint`).

### Author identity

`publications` ⇄ `publication_authors` ⇄ `authors`, deduplicated on an **accent-folded, lowercased
`"last, first"` key**. So `Eyecio{\u{g}}lu, {\"O}nder` (IEEE Xplore) and `Eyecioglu, Onder`
(Scopus) collapse to one author row — which is what makes co-author counts meaningful and lets the
UI **bold the site owner in every byline**.

### The BibTeX source is the source of truth

Bibliographic fields are **not editable** in the admin panel. `bibtex_raw` is stored verbatim and
everything else is derived from it. To correct a title, you re-import the corrected BibTeX. This
means the stored entry and its citation can never disagree, and a `.bib` download round-trips
byte-for-byte what the publisher issued.

What *is* editable is everything BibTeX has no field for: featured status, citation count, and links
to the PDF, code, slides or project page.

---

## 4 · Markdown is rendered once, on save

`blog_posts` stores **both** `content_md` and `content_html`.

The rendering pipeline — remark → GFM → math → rehype → raw HTML → KaTeX → Shiki → slugs → anchors —
runs **in the admin API when the post is saved**. Public requests just stream a string out of D1.

This is the single biggest lever on performance for a database-driven site. The alternative
(rendering per request) would put KaTeX and a syntax highlighter in the hot path of every page view,
on a platform billed by CPU time, to produce a byte-identical result every time.

The consequence to keep in mind: **changing the pipeline does not change existing posts.** Re-render
them by re-saving, or with a one-off script.

The editor's live preview calls `/api/admin/preview`, which runs *the same* pipeline server-side —
deliberately, because a preview rendered by a different markdown engine is a preview that lies.

---

## 5 · Scheduling has no cron

A scheduled post is visible when its time arrives, because **the query says so**:

```ts
// src/lib/repositories/blog.ts
function livePredicate() {
  const now = new Date();
  return or(
    and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, now)),
    and(eq(blogPosts.status, 'scheduled'), lte(blogPosts.scheduledFor, now)),  // ← self-executing
  );
}
```

A post booked for Friday 09:00 goes live at Friday 09:00 because the `WHERE` clause matches it — not
because a background job woke up and remembered to flip a flag.

This matters because Astro's Cloudflare adapter owns the Worker entrypoint, so there is no clean
place to add a `scheduled()` handler. The available options were: stand up a second Worker purely to
run two idempotent `UPDATE`s, or make the read path correct. The read path is correct.

`publishDuePosts()` still exists — it flips the stored `status` so the admin list agrees with
reality — and it runs **when an admin opens the dashboard**. If it never runs, the public site is
still right. Bookkeeping, not correctness.

---

## 6 · Cache invalidation without purging

A Worker **cannot wildcard-purge the Cache API**. That needs a zone-scoped API token and a round
trip to Cloudflare's control plane, on every content edit.

So we do not purge. We make stale entries **unreachable**:

```ts
// A monotonically increasing version in KV is baked into every cache key.
const version = await getContentVersion(kv);   //  → 47
const key = cacheKeyFor(request, version);     //  /publications?__v=47
```

Any admin mutation calls `bumpContentVersion(kv)` → `48`. Every cache key changes at once. The
orphaned entries are never looked up again and fall out on their own TTL.

One KV write invalidates the entire site, globally, with no purge API, no fan-out, and no per-URL
bookkeeping.

**Never cached:** anything for a signed-in user. Writing a personalised response into a *shared*
cache is how one visitor gets served another's page, so authentication short-circuits the cache
entirely rather than trying to vary on it.

---

## 7 · Security

### Trust boundaries

| Input | Treatment |
| --- | --- |
| Contact form | **Untrusted.** Zod-validated, Turnstile-verified, rate-limited, honeypotted. Rendered as **plain text, never HTML**. |
| Uploaded files | **Untrusted.** MIME type sniffed from **magic bytes** — the declared `Content-Type` is ignored. Dimensions read from the file header, not from what the browser claimed. |
| Admin markdown | **Trusted.** Raw HTML passes through, because embedding a YouTube iframe is the feature. The admin is the only writer and sits behind authentication. |
| BibTeX paste | **Trusted but hostile-tolerant.** The parser never throws; malformed input produces diagnostics, not a 500. |

### Authentication

- **PBKDF2-SHA256, 600,000 iterations** (the current OWASP floor). bcrypt/argon2 need native or WASM
  bindings the Workers runtime does not provide; PBKDF2 *is* in Web Crypto. Parameters travel with
  the hash (`pbkdf2$600000$salt$hash`), so they can be raised later without invalidating passwords —
  and `needsRehash()` upgrades them transparently on next login.
- **HS256 JWT in an HttpOnly cookie**, *plus* a server-side session row. Both must hold. That second
  check is what makes "sign out everywhere" and account deactivation take effect **immediately**
  rather than whenever the token happens to expire.
- The `alg` header is **pinned before any signature work** — closing the classic `alg: none` /
  algorithm-confusion hole.
- Login does not distinguish "no such account" from "wrong password", and verifies against a dummy
  hash when the user does not exist, so timing does not either. An enumeration oracle is worse than
  a vague error message.

### Defence in depth

`/admin/*` is gated by the middleware **and** every admin API route independently calls
`requireAdmin()`. A middleware that is accidentally bypassed must not be the only thing standing
between the internet and the database.

### Media serving

R2 is never public. `/media/[...key]` serves objects with a `Content-Type` taken from **our own
sniffing at upload time**, plus `X-Content-Type-Options: nosniff`. A file that lied about being a
PNG can therefore never be served as `text/html`.

---

## 8 · Images are processed in the browser

Uploads are resized and converted to WebP **on a canvas, client-side, before the upload**.

The Workers runtime has no native image pipeline. Doing this server-side means shipping a WASM
encoder into the request path — hundreds of kilobytes and tens of milliseconds of CPU, on a platform
billed by CPU time. Meanwhile the bytes are *already on the user's machine*: re-encoding a 6 MB photo
down to 1.2 MB before it crosses the network is faster for them and cheaper for us.

Downscaling is done in **halving steps** rather than one jump — a single large-ratio `drawImage` uses
bilinear sampling that skips most source pixels, which is exactly what makes browser-resized photos
look soft.

The server still validates everything it receives. Nothing the client says is trusted.

> **Cloudflare Images** can do this at the edge if you would rather pay for it. Set
> `imageService: 'cloudflare'` in `astro.config.mjs` and route media through `/cdn-cgi/image/…`.

---

## 9 · Image slots

The brief asked for "predefined image positions" with "automatically validated" dimensions.

`image_slots` rows carry the *expected* geometry (`required_width`, `required_height`,
`aspect_ratio`, `tolerance`). On upload:

1. The admin UI **centre-crops to the slot's aspect ratio automatically** — so the admin never has to
   open another program.
2. The server reads the **actual** dimensions from the file header and validates them against the
   rule.
3. A failure returns a message that says what to do: *"This slot expects a 1.91:1 aspect ratio, but
   the image is 1.33:1 (800×600)."*

This is what keeps the layout from breaking when content is edited by someone who is not a designer.

---

## 10 · The generic resource registry

Eleven content types (positions, projects, theses, skills, categories, awards, memberships …) need
the same five operations over the same five lines of code. They are declared in
`src/lib/api/resources.ts` and served by **one** route pair:

```
/api/admin/[resource]        GET (list) · POST (create)
/api/admin/[resource]/[id]   GET · PATCH · DELETE
```

Twenty-two route files collapse into two. The admin UI mirrors this: `ResourceManager.tsx` renders
the list, the form, the validation errors and the delete confirmation from a field declaration.

**The moment a type needs real behaviour, it gets a purpose-built route.** Publications (BibTeX),
blog posts (markdown, scheduling, tags), activities (galleries) and media (R2) all have explicit
handlers. Forcing those through a generic abstraction is how you end up with a configuration
language instead of a program.

---

## 11 · Data access

Repositories (`src/lib/repositories/`) are the **only** thing that touches the database. Pages and
API routes call repositories; they never build queries.

Two patterns worth calling out:

**No N+1.** `listPublications()` fetches publications, then fetches all their authors in one query
and stitches them in memory — two round trips regardless of corpus size. The tempting version (loop
and fetch each byline) would be 46.

**D1 has no interactive transactions.** So writes are ordered so that an interruption leaves the
database *consistent enough*. Deleting media removes the row first, then the R2 object: a failure
leaves an orphaned object (invisible, costs a fraction of a cent) rather than a dangling row that
renders a broken image on a live page. Failing in the direction of "correct page, wasted byte" is
the right trade.

---

## 12 · Accessibility

WCAG AA is a build constraint, not a checklist item.

- **Every foreground/background pair** in the token set clears 4.5:1 (body) or 3:1 (large text, UI).
  The muted tone is 6.3:1 on paper and 8.4:1 on ink — past the floor, not sitting on it.
- The accent flips to a light lavender in dark mode, so `btn-primary` **switches its label to ink**;
  white-on-lavender would fail.
- Charts are **not pictures of data**: the publication timeline is a `<dl>` that a screen reader
  reads as year/count pairs, with the bars as `aria-hidden` decoration on top. Skill meters are
  `role="progressbar"` with a real `aria-valuenow`.
- Filter changes announce their result count through a `role="status"` live region — otherwise the
  update is completely silent to a screen-reader user.
- Focus is **never** removed without a replacement. `:focus-visible` gets a 2px accent ring.
- `prefers-reduced-motion` collapses transitions to instant rather than removing them, so nothing
  ends up stuck mid-transition.
- Scroll-reveal only hides content *after* JavaScript confirms it can animate it back. With JS
  disabled, nothing is ever invisible.

---

## 13 · What I would change next

Honest list, in priority order:

1. **Real citation counts.** They are entered manually, because Google Scholar has no public API.
   A Semantic Scholar / OpenAlex integration would automate this.
2. **FTS5 for blog search.** Currently `LIKE`. At a few hundred posts that is genuinely identical in
   performance; past a few thousand it is not.
3. **A second editor role.** The schema and JWT already carry `role`; only `admin` is enforced.
4. **Media garbage collection.** Orphaned R2 objects (from a failed delete) accumulate slowly. A
   sweep comparing bucket keys against `media.r2_key` would clear them.
5. **Re-render on pipeline change.** Because HTML is rendered at save time, changing the markdown
   pipeline does not update existing posts. A `scripts/rerender.ts` would fix that properly.
