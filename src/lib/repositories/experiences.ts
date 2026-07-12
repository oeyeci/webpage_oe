/**
 * Experiences repository — academic and industry positions, research projects,
 * and supervised theses. All three feed the Experiences page timeline.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import {
  experiences,
  projects,
  supervisedTheses,
  type Experience,
  type ExperienceType,
  type Project,
  type SupervisedThesis,
} from '../db/schema';

export interface ExperiencePageData {
  positions: Experience[];
  projects: Project[];
  theses: SupervisedThesis[];
}

/**
 * Positions, most recent first.
 *
 * Ordering is by `is_current` then `start_date` descending: a role you still
 * hold belongs at the top of a CV even if it started before one that has ended.
 */
export function listExperiences(
  db: Db,
  options: { includeUnpublished?: boolean; type?: ExperienceType } = {},
) {
  // Drizzle's `.where()` *replaces* the predicate rather than appending to it,
  // so the filters are combined up front and applied once.
  const filters = [];
  if (!options.includeUnpublished) filters.push(eq(experiences.isPublished, true));
  if (options.type) filters.push(eq(experiences.type, options.type));

  const query = db.select().from(experiences).$dynamic();
  if (filters.length) query.where(and(...filters));

  return query
    .orderBy(desc(experiences.isCurrent), desc(experiences.startDate), asc(experiences.sortOrder))
    .all();
}

export function listProjects(db: Db, options: { includeUnpublished?: boolean } = {}) {
  const query = db.select().from(projects).$dynamic();
  if (!options.includeUnpublished) query.where(eq(projects.isPublished, true));

  return query.orderBy(desc(projects.startDate), asc(projects.sortOrder)).all();
}

export function listTheses(db: Db, options: { includeUnpublished?: boolean } = {}) {
  const query = db.select().from(supervisedTheses).$dynamic();
  if (!options.includeUnpublished) query.where(eq(supervisedTheses.isPublished, true));

  return query.orderBy(desc(supervisedTheses.year), asc(supervisedTheses.sortOrder)).all();
}

/** Everything the Experiences page needs, in one call. */
export async function getExperiencePageData(
  db: Db,
  options: { includeUnpublished?: boolean } = {},
): Promise<ExperiencePageData> {
  const [positions, projectRows, theses] = await Promise.all([
    listExperiences(db, options),
    listProjects(db, options),
    listTheses(db, options),
  ]);

  return { positions, projects: projectRows, theses };
}

export function getExperience(db: Db, id: number) {
  return db.select().from(experiences).where(eq(experiences.id, id)).get();
}

export async function deleteExperience(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(experiences).where(eq(experiences.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

export function getProject(db: Db, id: number) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export async function deleteProject(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(projects).where(eq(projects.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteThesis(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(supervisedTheses).where(eq(supervisedTheses.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Years of experience, derived from the earliest position's start date. */
export function yearsSince(positions: Experience[]): number {
  const earliest = positions
    .map((p) => Number(p.startDate.slice(0, 4)))
    .filter((y) => Number.isFinite(y) && y > 1900)
    .sort((a, b) => a - b)[0];

  return earliest ? new Date().getUTCFullYear() - earliest : 0;
}
