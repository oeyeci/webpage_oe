/**
 * Registry of the simple CRUD resources.
 *
 * Eleven tables (experiences, projects, theses, skills, categories, education,
 * awards, …) all need the same five operations over the same five lines of
 * code. Rather than 22 near-identical route files that drift apart over time,
 * they are described *declaratively* here and served by one generic route pair:
 *
 *   /api/admin/[resource]        → GET (list), POST (create)
 *   /api/admin/[resource]/[id]   → GET, PATCH, DELETE
 *
 * Anything with real behaviour — publications (BibTeX), blog posts (markdown
 * rendering, scheduling, tags), activities (galleries), media (R2) — has its
 * own explicit route, because forcing those through a generic abstraction is
 * how you end up with a config language instead of a program.
 */
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { asc, desc, type SQL } from 'drizzle-orm';

import {
  activityCategories,
  awards,
  blogCategories,
  education,
  experiences,
  memberships,
  projects,
  researchInterests,
  skillCategories,
  skills,
  supervisedTheses,
} from '../db/schema';

import {
  activityCategorySchema,
  awardSchema,
  blogCategorySchema,
  educationSchema,
  experienceSchema,
  membershipSchema,
  projectSchema,
  researchInterestSchema,
  skillCategorySchema,
  skillSchema,
  thesisSchema,
} from '../validation/schemas';

import { renderRichText } from '../content/markdown';
import { slugify } from '../utils/text';

export interface ResourceDefinition {
  table: SQLiteTable;
  /** Validates the body for both create and update (update parses partially). */
  schema: z.ZodType;
  /** Human name used in audit-log entries and error messages. */
  label: string;
  /** Default ordering for the list endpoint. */
  orderBy: SQL[];
  /**
   * Last step before the row is written: derive columns the client does not
   * send (rendered HTML, generated slugs).
   */
  transform?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** Renders `<field>Md` into `<field>Html`, the pattern every rich-text row uses. */
const withRenderedMarkdown =
  (field: 'descriptionMd') =>
  async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const markdown = input[field];
    if (typeof markdown !== 'string') return input;

    const htmlField = field.replace(/Md$/, 'Html');
    return {
      ...input,
      [htmlField]: markdown.trim() ? await renderRichText(markdown) : null,
    };
  };

/** Derives a slug from `name` when the client did not supply one. */
const withSlug =
  (source: string) =>
  async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const existing = input.slug;
    if (typeof existing === 'string' && existing.trim()) {
      return { ...input, slug: slugify(existing) };
    }
    const from = input[source];
    return { ...input, slug: slugify(typeof from === 'string' ? from : '') };
  };

export const RESOURCES = {
  experiences: {
    table: experiences,
    schema: experienceSchema,
    label: 'Experience',
    orderBy: [desc(experiences.isCurrent), desc(experiences.startDate)],
    transform: withRenderedMarkdown('descriptionMd'),
  },
  projects: {
    table: projects,
    schema: projectSchema,
    label: 'Project',
    orderBy: [desc(projects.startDate), asc(projects.sortOrder)],
    transform: withRenderedMarkdown('descriptionMd'),
  },
  theses: {
    table: supervisedTheses,
    schema: thesisSchema,
    label: 'Thesis',
    orderBy: [desc(supervisedTheses.year), asc(supervisedTheses.sortOrder)],
  },
  skills: {
    table: skills,
    schema: skillSchema,
    label: 'Skill',
    orderBy: [asc(skills.sortOrder), asc(skills.name)],
  },
  'skill-categories': {
    table: skillCategories,
    schema: skillCategorySchema,
    label: 'Skill category',
    orderBy: [asc(skillCategories.sortOrder)],
    transform: withSlug('name'),
  },
  'blog-categories': {
    table: blogCategories,
    schema: blogCategorySchema,
    label: 'Blog category',
    orderBy: [asc(blogCategories.sortOrder)],
    transform: withSlug('name'),
  },
  'activity-categories': {
    table: activityCategories,
    schema: activityCategorySchema,
    label: 'Activity category',
    orderBy: [asc(activityCategories.sortOrder)],
    transform: withSlug('name'),
  },
  education: {
    table: education,
    schema: educationSchema,
    label: 'Education entry',
    orderBy: [asc(education.sortOrder)],
  },
  awards: {
    table: awards,
    schema: awardSchema,
    label: 'Award',
    orderBy: [asc(awards.sortOrder), desc(awards.year)],
  },
  memberships: {
    table: memberships,
    schema: membershipSchema,
    label: 'Membership',
    orderBy: [asc(memberships.sortOrder)],
  },
  'research-interests': {
    table: researchInterests,
    schema: researchInterestSchema,
    label: 'Research interest',
    orderBy: [asc(researchInterests.sortOrder)],
  },
} as const satisfies Record<string, ResourceDefinition>;

export type ResourceName = keyof typeof RESOURCES;

export function isResourceName(value: string | undefined): value is ResourceName {
  return typeof value === 'string' && value in RESOURCES;
}

export function getResource(name: ResourceName): ResourceDefinition {
  return RESOURCES[name];
}
