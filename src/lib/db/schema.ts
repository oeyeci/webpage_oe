/**
 * Database schema — Cloudflare D1 (SQLite) via Drizzle ORM.
 *
 * Conventions
 * -----------
 * • Surrogate integer primary keys everywhere; natural keys get a UNIQUE index.
 * • Timestamps are unix epoch seconds (`integer … mode: 'timestamp'`).
 * • Booleans are `integer … mode: 'boolean'` (SQLite has no BOOLEAN type).
 * • Column names are snake_case — produced automatically by drizzle's
 *   `casing: 'snake_case'` setting, so TS stays camelCase.
 * • Deleting a parent cascades to its join/child rows; deleting media that is
 *   still referenced sets the reference to NULL rather than destroying content.
 *
 * The rendered ER diagram lives in docs/ER-DIAGRAM.md.
 */
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/* ═══════════════════════════════════════════════════════════════════════════
 * Shared column helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

const id = () => integer().primaryKey({ autoIncrement: true });

const createdAt = () =>
  integer({ mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`);

const updatedAt = () =>
  integer({ mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`);

const sortOrder = () => integer().notNull().default(0);

/* ═══════════════════════════════════════════════════════════════════════════
 * Identity & auditing
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Site administrators. Role is reserved for future editor/viewer tiers. */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    /** PBKDF2-SHA256, serialised as `pbkdf2$<iterations>$<salt>$<hash>`. */
    passwordHash: text().notNull(),
    name: text().notNull(),
    role: text({ enum: ['admin', 'editor'] })
      .notNull()
      .default('admin'),
    // `users` → `media` → `users` is a reference cycle, so TypeScript cannot
    // infer the column type on its own. The explicit `AnySQLiteColumn` return
    // annotation breaks the cycle (see drizzle's "foreign key cycles" docs).
    avatarMediaId: integer().references((): AnySQLiteColumn => media.id, { onDelete: 'set null' }),
    /** Set when the account must rotate its password on next login. */
    mustChangePassword: integer({ mode: 'boolean' }).notNull().default(false),
    isActive: integer({ mode: 'boolean' }).notNull().default(true),
    lastLoginAt: integer({ mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

/**
 * Server-side session registry.
 *
 * The browser holds a signed JWT, but every request also checks that the
 * token's `jti` is still present here — that is what makes "log out
 * everywhere" and immediate revocation possible with stateless tokens.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    /** JWT `jti` claim. */
    id: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
    userAgent: text(),
    ipAddress: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

/** Append-only audit trail of every admin mutation. */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    /** e.g. `publication.create`, `media.delete`, `auth.login_failed` */
    action: text().notNull(),
    entity: text(),
    entityId: text(),
    /** JSON blob with a short, non-sensitive diff/summary. */
    meta: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ipAddress: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt),
    index('audit_user_idx').on(t.userId),
    index('audit_entity_idx').on(t.entity, t.entityId),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Media library (Cloudflare R2)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const media = sqliteTable(
  'media',
  {
    id: id(),
    /** Object key inside the R2 bucket, e.g. `2026/07/hero-a1b2c3.webp`. */
    r2Key: text().notNull(),
    /** Key of the generated 480px thumbnail, if one exists. */
    thumbKey: text(),
    filename: text().notNull(),
    mimeType: text().notNull(),
    /** Bytes. */
    size: integer().notNull(),
    width: integer(),
    height: integer(),
    /** Alt text — required for WCAG AA; enforced at the API layer. */
    alt: text().notNull().default(''),
    caption: text(),
    /** Virtual folder for the media manager, e.g. `blog`, `activities`. */
    folder: text().notNull().default('uploads'),
    /** Tiny blurred base64 placeholder used for LQIP while the image loads. */
    blurhash: text(),
    /** Other half of the users ⇄ media cycle — see `users.avatarMediaId`. */
    uploadedBy: integer().references((): AnySQLiteColumn => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_r2key_uq').on(t.r2Key),
    index('media_folder_idx').on(t.folder),
    index('media_created_idx').on(t.createdAt),
  ],
);

/**
 * Predefined image placeholders (About portrait, home hero, OG default …).
 *
 * The slot row carries the *expected* dimensions so the admin UI can validate
 * an upload before it is accepted, which is what keeps the layout from
 * breaking when content is edited by a non-designer.
 */
export const imageSlots = sqliteTable(
  'image_slots',
  {
    id: id(),
    /** Stable machine key, e.g. `about.portrait`, `home.hero`. */
    slug: text().notNull(),
    label: text().notNull(),
    description: text(),
    mediaId: integer().references(() => media.id, { onDelete: 'set null' }),
    /** Validation constraints applied at upload time. */
    requiredWidth: integer(),
    requiredHeight: integer(),
    /** Width / height. Used when exact pixels are too strict. */
    aspectRatio: real(),
    /** Pixel tolerance allowed against required width/height. */
    tolerance: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('image_slots_slug_uq').on(t.slug)],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Site settings (typed key/value store)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  /** JSON-encoded value; shape is validated by Zod in `lib/services/settings.ts`. */
  value: text({ mode: 'json' }).$type<unknown>().notNull(),
  group: text().notNull().default('general'),
  updatedAt: updatedAt(),
});

/* ═══════════════════════════════════════════════════════════════════════════
 * About / profile
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Singleton row (id = 1) holding the owner's identity and biography. */
export const profile = sqliteTable('profile', {
  id: integer().primaryKey(),
  fullName: text().notNull(),
  /** e.g. "Assoc. Prof. Dr." */
  honorific: text(),
  /** e.g. "Associate Professor of Computer Engineering" */
  title: text().notNull(),
  institution: text(),
  department: text(),
  /** One-line hero statement. */
  tagline: text(),
  /** Short summary used on the home page and meta descriptions. */
  summary: text(),
  professionalBioMd: text(),
  professionalBioHtml: text(),
  academicBioMd: text(),
  academicBioHtml: text(),
  email: text(),
  phone: text(),
  office: text(),
  address: text(),
  /** Latitude/longitude for the contact-page map. */
  latitude: real(),
  longitude: real(),
  googleMapsUrl: text(),
  cvMediaId: integer().references(() => media.id, { onDelete: 'set null' }),
  orcid: text(),
  googleScholar: text(),
  researchGate: text(),
  scopusId: text(),
  webOfScience: text(),
  github: text(),
  linkedin: text(),
  twitter: text(),
  youtube: text(),
  updatedAt: updatedAt(),
});

export const researchInterests = sqliteTable(
  'research_interests',
  {
    id: id(),
    title: text().notNull(),
    description: text(),
    /** Lucide icon name, e.g. `Atom`. */
    icon: text(),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    sortOrder: sortOrder(),
  },
  (t) => [index('research_sort_idx').on(t.sortOrder)],
);

export const education = sqliteTable(
  'education',
  {
    id: id(),
    degree: text().notNull(),
    field: text(),
    institution: text().notNull(),
    department: text(),
    location: text(),
    startYear: integer(),
    endYear: integer(),
    /** Exact graduation date when known, e.g. "22 August 2012". */
    completedOn: text(),
    thesisTitle: text(),
    advisor: text(),
    description: text(),
    sortOrder: sortOrder(),
  },
  (t) => [index('education_sort_idx').on(t.sortOrder)],
);

export const awards = sqliteTable(
  'awards',
  {
    id: id(),
    title: text().notNull(),
    issuer: text(),
    year: integer(),
    description: text(),
    url: text(),
    sortOrder: sortOrder(),
  },
  (t) => [index('awards_year_idx').on(t.year)],
);

export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    organization: text().notNull(),
    role: text(),
    startYear: integer(),
    endYear: integer(),
    url: text(),
    sortOrder: sortOrder(),
  },
  (t) => [index('memberships_sort_idx').on(t.sortOrder)],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Experience, projects, supervision
 * ═══════════════════════════════════════════════════════════════════════════ */

export const experienceTypes = [
  'academic',
  'administrative',
  'industry',
  'visiting',
  'editorial',
  'teaching',
] as const;

export const experiences = sqliteTable(
  'experiences',
  {
    id: id(),
    type: text({ enum: experienceTypes }).notNull().default('academic'),
    /** Job title, e.g. "Associate Professor". */
    title: text().notNull(),
    organization: text().notNull(),
    department: text(),
    location: text(),
    /** ISO `YYYY-MM-DD`; day precision is optional in the UI. */
    startDate: text().notNull(),
    endDate: text(),
    isCurrent: integer({ mode: 'boolean' }).notNull().default(false),
    summary: text(),
    descriptionMd: text(),
    descriptionHtml: text(),
    url: text(),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    isPublished: integer({ mode: 'boolean' }).notNull().default(true),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('experiences_type_idx').on(t.type),
    index('experiences_start_idx').on(t.startDate),
  ],
);

export const projectRoles = ['pi', 'co-pi', 'researcher', 'advisor', 'scholar'] as const;

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    title: text().notNull(),
    /** Funding body, e.g. "TÜBİTAK (3001)" or "BAP". */
    funder: text(),
    grantNumber: text(),
    role: text({ enum: projectRoles }).notNull().default('researcher'),
    /** Free-text list of collaborators, as it appears on the CV. */
    team: text(),
    startDate: text(),
    endDate: text(),
    status: text({ enum: ['ongoing', 'completed', 'planned'] })
      .notNull()
      .default('completed'),
    scope: text({ enum: ['national', 'international'] })
      .notNull()
      .default('national'),
    descriptionMd: text(),
    descriptionHtml: text(),
    url: text(),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    isPublished: integer({ mode: 'boolean' }).notNull().default(true),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_status_idx').on(t.status)],
);

export const supervisedTheses = sqliteTable(
  'supervised_theses',
  {
    id: id(),
    studentName: text().notNull(),
    title: text().notNull(),
    degree: text({ enum: ['msc', 'phd'] }).notNull(),
    year: integer(),
    institution: text(),
    status: text({ enum: ['completed', 'ongoing'] })
      .notNull()
      .default('completed'),
    url: text(),
    isPublished: integer({ mode: 'boolean' }).notNull().default(true),
    sortOrder: sortOrder(),
  },
  (t) => [index('theses_degree_year_idx').on(t.degree, t.year)],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Publications (BibTeX-driven)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * BibTeX entry types we support. `entryType` stores the raw BibTeX type;
 * `category` is the coarse bucket used for grouping, filtering and statistics.
 */
export const publicationEntryTypes = [
  'article',
  'inproceedings',
  'conference',
  'book',
  'inbook',
  'incollection',
  'phdthesis',
  'mastersthesis',
  'techreport',
  'patent',
  'misc',
  'unpublished',
] as const;

export const publicationCategories = [
  'journal',
  'conference',
  'book',
  'chapter',
  'thesis',
  'preprint',
  'patent',
  'other',
] as const;

/**
 * Distinct people, deduplicated across publications.
 * `isSelf` marks the site owner so the UI can bold their name in every
 * author list — including under alternate spellings (see `authorAliases`).
 */
export const authors = sqliteTable(
  'authors',
  {
    id: id(),
    /** Display form, e.g. "Önder Eyecioğlu". */
    fullName: text().notNull(),
    lastName: text(),
    firstName: text(),
    /** Accent-folded, lowercased "last, first" — the dedupe key. */
    normalized: text().notNull(),
    isSelf: integer({ mode: 'boolean' }).notNull().default(false),
    orcid: text(),
    url: text(),
  },
  (t) => [
    uniqueIndex('authors_normalized_uq').on(t.normalized),
    index('authors_self_idx').on(t.isSelf),
  ],
);

export const publications = sqliteTable(
  'publications',
  {
    id: id(),
    /** BibTeX citation key, e.g. `eyecioglu2026qlid`. */
    citeKey: text().notNull(),
    entryType: text({ enum: publicationEntryTypes }).notNull(),
    category: text({ enum: publicationCategories }).notNull(),

    title: text().notNull(),
    /** Denormalised author list in BibTeX order — kept for fast rendering
     *  and exact citation output; the normalised truth is publicationAuthors. */
    authorsRaw: text().notNull().default(''),

    journal: text(),
    booktitle: text(),
    publisher: text(),
    school: text(),
    institution: text(),
    series: text(),
    edition: text(),
    address: text(),
    volume: text(),
    number: text(),
    pages: text(),
    year: integer().notNull(),
    month: text(),

    doi: text(),
    url: text(),
    pdfUrl: text(),
    projectUrl: text(),
    codeUrl: text(),
    slidesUrl: text(),
    arxivId: text(),
    isbn: text(),
    issn: text(),

    abstract: text(),
    keywords: text(),
    note: text(),

    /** Verbatim BibTeX as pasted by the admin — the source of truth. */
    bibtexRaw: text().notNull(),
    /** IEEE-style reference string, regenerated whenever the entry changes. */
    ieeeCitation: text().notNull().default(''),

    /** Manually curated counter shown as a Google-Scholar-style badge. */
    citationCount: integer().notNull().default(0),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    isPublished: integer({ mode: 'boolean' }).notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publications_citekey_uq').on(t.citeKey),
    index('publications_year_idx').on(t.year),
    index('publications_category_idx').on(t.category),
    index('publications_featured_idx').on(t.isFeatured),
  ],
);

export const publicationAuthors = sqliteTable(
  'publication_authors',
  {
    publicationId: integer()
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    authorId: integer()
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    /** Zero-based position in the byline. */
    position: integer().notNull(),
    isCorresponding: integer({ mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.publicationId, t.authorId] }),
    index('pubauthors_author_idx').on(t.authorId),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Blog
 * ═══════════════════════════════════════════════════════════════════════════ */

export const blogCategories = sqliteTable(
  'blog_categories',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    /** Hex colour used for the category chip. */
    color: text().notNull().default('#5b6bf0'),
    sortOrder: sortOrder(),
  },
  (t) => [uniqueIndex('blog_categories_slug_uq').on(t.slug)],
);

export const blogTags = sqliteTable(
  'blog_tags',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
  },
  (t) => [uniqueIndex('blog_tags_slug_uq').on(t.slug)],
);

export const postStatuses = ['draft', 'scheduled', 'published'] as const;

export const blogPosts = sqliteTable(
  'blog_posts',
  {
    id: id(),
    slug: text().notNull(),
    title: text().notNull(),
    excerpt: text(),

    /** Author-entered source. Markdown + LaTeX + inline HTML are all valid. */
    contentMd: text().notNull().default(''),
    /** Rendered once on save, so public requests never pay for parsing. */
    contentHtml: text().notNull().default(''),
    /** JSON array of `{ depth, id, text }` used to build the table of contents. */
    toc: text({ mode: 'json' })
      .$type<Array<{ depth: number; id: string; text: string }>>()
      .default([]),

    coverMediaId: integer().references(() => media.id, { onDelete: 'set null' }),
    categoryId: integer().references(() => blogCategories.id, { onDelete: 'set null' }),
    authorId: integer().references(() => users.id, { onDelete: 'set null' }),

    status: text({ enum: postStatuses }).notNull().default('draft'),
    /** Set when the post first goes live; drives ordering and the RSS feed. */
    publishedAt: integer({ mode: 'timestamp' }),
    /** Future timestamp for `status = 'scheduled'`; a cron promotes it. */
    scheduledFor: integer({ mode: 'timestamp' }),

    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    /** Whether the post body should render a table of contents. */
    showToc: integer({ mode: 'boolean' }).notNull().default(true),
    readingMinutes: integer().notNull().default(1),
    viewCount: integer().notNull().default(0),

    seoTitle: text(),
    seoDescription: text(),
    ogMediaId: integer().references(() => media.id, { onDelete: 'set null' }),
    canonicalUrl: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('blog_posts_slug_uq').on(t.slug),
    index('blog_posts_status_pub_idx').on(t.status, t.publishedAt),
    index('blog_posts_category_idx').on(t.categoryId),
    index('blog_posts_featured_idx').on(t.isFeatured),
    index('blog_posts_scheduled_idx').on(t.scheduledFor),
  ],
);

export const blogPostTags = sqliteTable(
  'blog_post_tags',
  {
    postId: integer()
      .notNull()
      .references(() => blogPosts.id, { onDelete: 'cascade' }),
    tagId: integer()
      .notNull()
      .references(() => blogTags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index('blog_post_tags_tag_idx').on(t.tagId)],
);

export const blogPostGallery = sqliteTable(
  'blog_post_gallery',
  {
    id: id(),
    postId: integer()
      .notNull()
      .references(() => blogPosts.id, { onDelete: 'cascade' }),
    mediaId: integer()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortOrder: sortOrder(),
  },
  (t) => [index('blog_gallery_post_idx').on(t.postId)],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Activities
 * ═══════════════════════════════════════════════════════════════════════════ */

export const activityCategories = sqliteTable(
  'activity_categories',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    color: text().notNull().default('#0ea5a4'),
    sortOrder: sortOrder(),
  },
  (t) => [uniqueIndex('activity_categories_slug_uq').on(t.slug)],
);

export const activities = sqliteTable(
  'activities',
  {
    id: id(),
    slug: text().notNull(),
    title: text().notNull(),
    /** ISO `YYYY-MM-DD`. */
    activityDate: text().notNull(),
    endDate: text(),
    location: text(),
    categoryId: integer().references(() => activityCategories.id, { onDelete: 'set null' }),
    excerpt: text(),
    descriptionMd: text(),
    descriptionHtml: text(),
    coverMediaId: integer().references(() => media.id, { onDelete: 'set null' }),
    url: text(),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    isPublished: integer({ mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('activities_slug_uq').on(t.slug),
    index('activities_date_idx').on(t.activityDate),
    index('activities_published_idx').on(t.isPublished),
  ],
);

export const activityImages = sqliteTable(
  'activity_images',
  {
    id: id(),
    activityId: integer()
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    mediaId: integer()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortOrder: sortOrder(),
  },
  (t) => [index('activity_images_activity_idx').on(t.activityId)],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Skills
 * ═══════════════════════════════════════════════════════════════════════════ */

export const skillDisplayModes = ['bar', 'chip', 'card', 'certificate'] as const;

export const skillCategories = sqliteTable(
  'skill_categories',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    icon: text(),
    /** How the skills in this group are visualised on the public page. */
    displayMode: text({ enum: skillDisplayModes }).notNull().default('bar'),
    sortOrder: sortOrder(),
  },
  (t) => [uniqueIndex('skill_categories_slug_uq').on(t.slug)],
);

export const skills = sqliteTable(
  'skills',
  {
    id: id(),
    categoryId: integer()
      .notNull()
      .references(() => skillCategories.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** 0–100. Drives the animated progress indicator. */
    level: integer().notNull().default(0),
    /** Optional proficiency word shown to screen readers, e.g. "Advanced". */
    levelLabel: text(),
    yearsExperience: real(),
    description: text(),
    icon: text(),
    url: text(),
    /** Certificate-specific fields (used when displayMode = 'certificate'). */
    issuedBy: text(),
    issuedYear: integer(),
    credentialId: text(),
    isFeatured: integer({ mode: 'boolean' }).notNull().default(false),
    sortOrder: sortOrder(),
  },
  (t) => [
    index('skills_category_idx').on(t.categoryId),
    index('skills_featured_idx').on(t.isFeatured),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Contact form submissions
 * ═══════════════════════════════════════════════════════════════════════════ */

export const contactStatuses = ['new', 'read', 'replied', 'spam'] as const;

export const contacts = sqliteTable(
  'contacts',
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    subject: text().notNull(),
    message: text().notNull(),
    status: text({ enum: contactStatuses }).notNull().default('new'),
    ipAddress: text(),
    userAgent: text(),
    /** Cloudflare-derived country code, useful for triaging spam. */
    country: text(),
    createdAt: createdAt(),
    readAt: integer({ mode: 'timestamp' }),
  },
  (t) => [
    index('contacts_status_idx').on(t.status),
    index('contacts_created_idx').on(t.createdAt),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Relations (used by drizzle's relational query API)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  posts: many(blogPosts),
  avatar: one(media, { fields: [users.avatarMediaId], references: [media.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(users, { fields: [media.uploadedBy], references: [users.id] }),
}));

export const imageSlotsRelations = relations(imageSlots, ({ one }) => ({
  media: one(media, { fields: [imageSlots.mediaId], references: [media.id] }),
}));

export const publicationsRelations = relations(publications, ({ many }) => ({
  authors: many(publicationAuthors),
}));

export const authorsRelations = relations(authors, ({ many }) => ({
  publications: many(publicationAuthors),
}));

export const publicationAuthorsRelations = relations(publicationAuthors, ({ one }) => ({
  publication: one(publications, {
    fields: [publicationAuthors.publicationId],
    references: [publications.id],
  }),
  author: one(authors, {
    fields: [publicationAuthors.authorId],
    references: [authors.id],
  }),
}));

export const blogPostsRelations = relations(blogPosts, ({ one, many }) => ({
  category: one(blogCategories, {
    fields: [blogPosts.categoryId],
    references: [blogCategories.id],
  }),
  author: one(users, { fields: [blogPosts.authorId], references: [users.id] }),
  cover: one(media, { fields: [blogPosts.coverMediaId], references: [media.id] }),
  tags: many(blogPostTags),
  gallery: many(blogPostGallery),
}));

export const blogCategoriesRelations = relations(blogCategories, ({ many }) => ({
  posts: many(blogPosts),
}));

export const blogTagsRelations = relations(blogTags, ({ many }) => ({
  posts: many(blogPostTags),
}));

export const blogPostTagsRelations = relations(blogPostTags, ({ one }) => ({
  post: one(blogPosts, { fields: [blogPostTags.postId], references: [blogPosts.id] }),
  tag: one(blogTags, { fields: [blogPostTags.tagId], references: [blogTags.id] }),
}));

export const blogPostGalleryRelations = relations(blogPostGallery, ({ one }) => ({
  post: one(blogPosts, { fields: [blogPostGallery.postId], references: [blogPosts.id] }),
  media: one(media, { fields: [blogPostGallery.mediaId], references: [media.id] }),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  category: one(activityCategories, {
    fields: [activities.categoryId],
    references: [activityCategories.id],
  }),
  cover: one(media, { fields: [activities.coverMediaId], references: [media.id] }),
  images: many(activityImages),
}));

export const activityCategoriesRelations = relations(activityCategories, ({ many }) => ({
  activities: many(activities),
}));

export const activityImagesRelations = relations(activityImages, ({ one }) => ({
  activity: one(activities, {
    fields: [activityImages.activityId],
    references: [activities.id],
  }),
  media: one(media, { fields: [activityImages.mediaId], references: [media.id] }),
}));

export const skillCategoriesRelations = relations(skillCategories, ({ many }) => ({
  skills: many(skills),
}));

export const skillsRelations = relations(skills, ({ one }) => ({
  category: one(skillCategories, {
    fields: [skills.categoryId],
    references: [skillCategories.id],
  }),
}));

export const profileRelations = relations(profile, ({ one }) => ({
  cv: one(media, { fields: [profile.cvMediaId], references: [media.id] }),
}));

/* ═══════════════════════════════════════════════════════════════════════════
 * Inferred types — the single source of truth for the rest of the app
 * ═══════════════════════════════════════════════════════════════════════════ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type ImageSlot = typeof imageSlots.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Profile = typeof profile.$inferSelect;
export type ResearchInterest = typeof researchInterests.$inferSelect;
export type Education = typeof education.$inferSelect;
export type Award = typeof awards.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type SupervisedThesis = typeof supervisedTheses.$inferSelect;
export type Author = typeof authors.$inferSelect;
export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;
export type BlogCategory = typeof blogCategories.$inferSelect;
export type BlogTag = typeof blogTags.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type ActivityCategory = typeof activityCategories.$inferSelect;
export type SkillCategory = typeof skillCategories.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type Contact = typeof contacts.$inferSelect;

export type ExperienceType = (typeof experienceTypes)[number];
export type PublicationCategory = (typeof publicationCategories)[number];
export type PublicationEntryType = (typeof publicationEntryTypes)[number];
export type PostStatus = (typeof postStatuses)[number];
export type ContactStatus = (typeof contactStatuses)[number];
export type SkillDisplayMode = (typeof skillDisplayModes)[number];
