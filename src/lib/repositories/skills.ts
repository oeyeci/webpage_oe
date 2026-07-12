/**
 * Skills repository — categories (Programming Languages, Cloud, Certificates …)
 * each rendering with its own display mode on the public page.
 */
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { skillCategories, skills, type Skill, type SkillCategory } from '../db/schema';

export interface SkillGroup extends SkillCategory {
  skills: Skill[];
}

/**
 * All categories with their skills, in one round trip plus one.
 *
 * The obvious implementation — fetch categories, then loop and fetch each
 * one's skills — is an N+1. Two queries and an in-memory group-by is both
 * faster and simpler to reason about.
 */
export async function listSkillGroups(db: Db): Promise<SkillGroup[]> {
  const [categories, allSkills] = await Promise.all([
    db.select().from(skillCategories).orderBy(asc(skillCategories.sortOrder)).all(),
    db.select().from(skills).orderBy(asc(skills.sortOrder), asc(skills.name)).all(),
  ]);

  const byCategory = new Map<number, Skill[]>();
  for (const skill of allSkills) {
    const list = byCategory.get(skill.categoryId) ?? [];
    list.push(skill);
    byCategory.set(skill.categoryId, list);
  }

  return categories.map((category) => ({
    ...category,
    skills: byCategory.get(category.id) ?? [],
  }));
}

export async function listFeaturedSkills(db: Db, limit = 8): Promise<Skill[]> {
  const featured = await db
    .select()
    .from(skills)
    .where(eq(skills.isFeatured, true))
    .orderBy(asc(skills.sortOrder))
    .limit(limit)
    .all();

  if (featured.length > 0) return featured;

  // Fall back to the highest-rated skills so the home page is never empty.
  return db.select().from(skills).orderBy(asc(skills.sortOrder)).limit(limit).all();
}

export function listSkillCategories(db: Db) {
  return db.select().from(skillCategories).orderBy(asc(skillCategories.sortOrder)).all();
}

export function getSkill(db: Db, id: number) {
  return db.select().from(skills).where(eq(skills.id, id)).get();
}

export async function deleteSkill(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(skills).where(eq(skills.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteSkillCategory(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(skillCategories).where(eq(skillCategories.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}
