/**
 * Input validation.
 *
 * Every write path in the app parses its body through one of these. Nothing
 * reaches the database without passing a schema — the repositories trust their
 * inputs precisely because the API layer does not.
 */
import { z } from 'zod';
import {
  contactStatuses,
  experienceTypes,
  postStatuses,
  projectRoles,
  skillDisplayModes,
} from '../db/schema';

/* ═══════════════════════════════════════════════════════════════════════════
 * Primitives
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Trims, then rejects empty. Prevents "   " passing a `min(1)` check. */
const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number, label = 'This field') =>
  trimmed(max).min(1, `${label} is required.`);

/**
 * Email. Deliberately permissive: the only way to truly validate an address is
 * to send to it, and an over-strict pattern rejects valid addresses every day.
 */
const email = (max = 320) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max)
    .refine(
      (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
      'Enter a valid email address.',
    );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    // An empty string from a cleared form field means "no value", not "".
    .transform((v) => (v ? v : null));

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || /^https?:\/\/.+/i.test(v) || v.startsWith('/'),
    'Must be an absolute http(s) URL or a site-relative path.',
  );

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Use the format YYYY-MM-DD.');

const optionalIsoDate = isoDate.nullish().transform((v) => (v ? v : null));

const id = z.coerce.number().int().positive();
const optionalId = z.coerce
  .number()
  .int()
  .positive()
  .nullish()
  .transform((v) => v ?? null);

const year = z.coerce.number().int().min(1900).max(2100);
const optionalYear = year.nullish().transform((v) => v ?? null);

const bool = z.coerce.boolean();
const sortOrder = z.coerce.number().int().min(0).max(9999).default(0);

/* ═══════════════════════════════════════════════════════════════════════════
 * Auth
 * ═══════════════════════════════════════════════════════════════════════════ */

export const loginSchema = z.object({
  email: email(),
  password: z.string().min(1, 'Enter your password.').max(200),
  remember: z.coerce.boolean().default(false),
  /** Where to go after signing in. Validated as a same-site path in the route. */
  next: z.string().max(500).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

/* ═══════════════════════════════════════════════════════════════════════════
 * Contact (public)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const contactSchema = z.object({
  name: required(200, 'Your name').min(2, 'Please enter your name.'),
  email: email(),
  subject: required(300, 'A subject').min(3, 'Please add a subject.'),
  message: z
    .string()
    .trim()
    .min(20, 'Please write at least 20 characters.')
    .max(5000, 'Please keep the message under 5,000 characters.'),
  turnstileToken: z.string().max(4000).optional(),
  /** Honeypot: a real user never fills a field they cannot see. */
  website: z.string().max(200).optional(),
});

export const contactStatusSchema = z.object({
  status: z.enum(contactStatuses),
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Publications
 * ═══════════════════════════════════════════════════════════════════════════ */

export const bibtexImportSchema = z.object({
  bibtex: z.string().trim().min(10, 'Paste at least one BibTeX entry.').max(500_000),
  /** Replace entries whose citation key already exists. */
  overwrite: bool.default(false),
});

export const publicationPatchSchema = z.object({
  isFeatured: bool.optional(),
  isPublished: bool.optional(),
  citationCount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  doi: optionalText(200),
  url: optionalUrl,
  pdfUrl: optionalUrl,
  projectUrl: optionalUrl,
  codeUrl: optionalUrl,
  slidesUrl: optionalUrl,
  abstract: optionalText(8000),
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Blog
 * ═══════════════════════════════════════════════════════════════════════════ */

export const blogPostSchema = z.object({
  title: required(300, 'A title'),
  slug: optionalText(120),
  excerpt: optionalText(500),
  contentMd: z.string().max(400_000).default(''),
  coverMediaId: optionalId,
  ogMediaId: optionalId,
  categoryId: optionalId,
  status: z.enum(postStatuses).default('draft'),
  /** ISO datetime. Required when status is `scheduled`. */
  scheduledFor: z.iso.datetime({ offset: true }).nullish(),
  publishedAt: z.iso.datetime({ offset: true }).nullish(),
  isFeatured: bool.default(false),
  showToc: bool.default(true),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  galleryMediaIds: z.array(id).max(40).default([]),
  seoTitle: optionalText(200),
  seoDescription: optionalText(300),
  canonicalUrl: optionalUrl,
}).refine(
  (data) => data.status !== 'scheduled' || Boolean(data.scheduledFor),
  { message: 'Choose a date and time to publish.', path: ['scheduledFor'] },
).refine(
  (data) =>
    data.status !== 'scheduled' ||
    !data.scheduledFor ||
    new Date(data.scheduledFor).getTime() > Date.now(),
  { message: 'The scheduled time must be in the future.', path: ['scheduledFor'] },
);

export const blogCategorySchema = z.object({
  name: required(100, 'A name'),
  slug: optionalText(120),
  description: optionalText(500),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour, e.g. #5b6bf0.')
    .default('#5b6bf0'),
  sortOrder,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Activities
 * ═══════════════════════════════════════════════════════════════════════════ */

export const activitySchema = z.object({
  title: required(300, 'A title'),
  slug: optionalText(120),
  activityDate: isoDate,
  endDate: optionalIsoDate,
  location: optionalText(200),
  categoryId: optionalId,
  excerpt: optionalText(500),
  descriptionMd: z.string().max(200_000).default(''),
  coverMediaId: optionalId,
  galleryMediaIds: z.array(id).max(60).default([]),
  url: optionalUrl,
  isFeatured: bool.default(false),
  isPublished: bool.default(true),
});

export const activityCategorySchema = z.object({
  name: required(100, 'A name'),
  slug: optionalText(120),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#0ea5a4'),
  sortOrder,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Experience, projects, supervision
 * ═══════════════════════════════════════════════════════════════════════════ */

export const experienceSchema = z
  .object({
    type: z.enum(experienceTypes).default('academic'),
    title: required(200, 'A title'),
    organization: required(200, 'An organization'),
    department: optionalText(200),
    location: optionalText(200),
    startDate: isoDate,
    endDate: optionalIsoDate,
    isCurrent: bool.default(false),
    summary: optionalText(500),
    descriptionMd: z.string().max(20_000).default(''),
    url: optionalUrl,
    isFeatured: bool.default(false),
    isPublished: bool.default(true),
    sortOrder,
  })
  .refine((data) => data.isCurrent || !data.endDate || data.endDate >= data.startDate, {
    message: 'The end date cannot be before the start date.',
    path: ['endDate'],
  });

export const projectSchema = z.object({
  title: required(300, 'A title'),
  funder: optionalText(200),
  grantNumber: optionalText(100),
  role: z.enum(projectRoles).default('researcher'),
  team: optionalText(1000),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  status: z.enum(['ongoing', 'completed', 'planned']).default('completed'),
  scope: z.enum(['national', 'international']).default('national'),
  descriptionMd: z.string().max(20_000).default(''),
  url: optionalUrl,
  isFeatured: bool.default(false),
  isPublished: bool.default(true),
  sortOrder,
});

export const thesisSchema = z.object({
  studentName: required(200, "The student's name"),
  title: required(500, 'A title'),
  degree: z.enum(['msc', 'phd']),
  year: optionalYear,
  institution: optionalText(300),
  status: z.enum(['completed', 'ongoing']).default('completed'),
  url: optionalUrl,
  isPublished: bool.default(true),
  sortOrder,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Skills
 * ═══════════════════════════════════════════════════════════════════════════ */

export const skillCategorySchema = z.object({
  name: required(100, 'A name'),
  slug: optionalText(120),
  description: optionalText(500),
  icon: optionalText(60),
  displayMode: z.enum(skillDisplayModes).default('bar'),
  sortOrder,
});

export const skillSchema = z.object({
  categoryId: id,
  name: required(120, 'A name'),
  level: z.coerce.number().int().min(0).max(100).default(0),
  levelLabel: optionalText(60),
  yearsExperience: z.coerce.number().min(0).max(80).nullish().transform((v) => v ?? null),
  description: optionalText(500),
  icon: optionalText(60),
  url: optionalUrl,
  issuedBy: optionalText(200),
  issuedYear: optionalYear,
  credentialId: optionalText(120),
  isFeatured: bool.default(false),
  sortOrder,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * About / profile
 * ═══════════════════════════════════════════════════════════════════════════ */

export const profileSchema = z.object({
  fullName: required(200, 'A name'),
  honorific: optionalText(60),
  title: required(200, 'A title'),
  institution: optionalText(200),
  department: optionalText(200),
  tagline: optionalText(300),
  summary: optionalText(500),
  professionalBioMd: z.string().max(50_000).default(''),
  academicBioMd: z.string().max(50_000).default(''),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'Enter a valid email.'),
  phone: optionalText(60),
  office: optionalText(200),
  address: optionalText(500),
  latitude: z.coerce.number().min(-90).max(90).nullish().transform((v) => v ?? null),
  longitude: z.coerce.number().min(-180).max(180).nullish().transform((v) => v ?? null),
  googleMapsUrl: optionalUrl,
  cvMediaId: optionalId,
  orcid: optionalUrl,
  googleScholar: optionalUrl,
  researchGate: optionalUrl,
  scopusId: optionalText(60),
  webOfScience: optionalUrl,
  github: optionalUrl,
  linkedin: optionalUrl,
  twitter: optionalUrl,
  youtube: optionalUrl,
});

export const educationSchema = z.object({
  degree: required(120, 'A degree'),
  field: optionalText(200),
  institution: required(200, 'An institution'),
  department: optionalText(200),
  location: optionalText(200),
  startYear: optionalYear,
  endYear: optionalYear,
  completedOn: optionalText(60),
  thesisTitle: optionalText(500),
  advisor: optionalText(200),
  description: optionalText(1000),
  sortOrder,
});

export const awardSchema = z.object({
  title: required(300, 'A title'),
  issuer: optionalText(200),
  year: optionalYear,
  description: optionalText(1000),
  url: optionalUrl,
  sortOrder,
});

export const membershipSchema = z.object({
  organization: required(200, 'An organization'),
  role: optionalText(120),
  startYear: optionalYear,
  endYear: optionalYear,
  url: optionalUrl,
  sortOrder,
});

export const researchInterestSchema = z.object({
  title: required(150, 'A title'),
  description: optionalText(500),
  icon: optionalText(60),
  isFeatured: bool.default(false),
  sortOrder,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Media
 * ═══════════════════════════════════════════════════════════════════════════ */

export const mediaPatchSchema = z.object({
  alt: trimmed(500).optional(),
  caption: optionalText(1000),
  folder: trimmed(60).optional(),
});

export const imageSlotSchema = z.object({
  mediaId: optionalId,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Settings
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Keys are validated individually against SITE_SETTINGS in the repository. */
export const settingsSchema = z.record(z.string(), z.unknown());

export type LoginInput = z.infer<typeof loginSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type BlogPostInput = z.infer<typeof blogPostSchema>;
export type ActivityInput = z.infer<typeof activitySchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
