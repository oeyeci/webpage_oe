/**
 * About / profile repository — the singleton profile row plus the collections
 * that make up the About page (education, awards, memberships, interests) and
 * the predefined image slots.
 */
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import {
  awards,
  education,
  imageSlots,
  media,
  memberships,
  profile,
  researchInterests,
  type Award,
  type Education,
  type ImageSlot,
  type Media,
  type Membership,
  type Profile,
  type ResearchInterest,
} from '../db/schema';

/** The profile is a singleton: exactly one row, id = 1. */
export const PROFILE_ID = 1;

export interface AboutPageData {
  profile: Profile | null;
  education: Education[];
  awards: Award[];
  memberships: Membership[];
  interests: ResearchInterest[];
  slots: Map<string, ImageSlot & { media: Media | null }>;
}

export async function getProfile(db: Db): Promise<Profile | null> {
  const row = await db.select().from(profile).where(eq(profile.id, PROFILE_ID)).get();
  return row ?? null;
}

export async function updateProfile(db: Db, patch: Partial<Profile>): Promise<void> {
  const existing = await getProfile(db);

  if (existing) {
    await db
      .update(profile)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(profile.id, PROFILE_ID));
    return;
  }

  await db.insert(profile).values({
    id: PROFILE_ID,
    fullName: patch.fullName ?? 'Unnamed',
    title: patch.title ?? '',
    ...patch,
  });
}

/**
 * Image slots, keyed by their machine slug, with the assigned media resolved.
 * Returned as a Map so templates can do `slots.get('about.portrait')` without
 * a linear scan.
 */
export async function getImageSlots(
  db: Db,
): Promise<Map<string, ImageSlot & { media: Media | null }>> {
  const rows = await db
    .select({ slot: imageSlots, media })
    .from(imageSlots)
    .leftJoin(media, eq(media.id, imageSlots.mediaId))
    .all();

  return new Map(rows.map((r) => [r.slot.slug, { ...r.slot, media: r.media }]));
}

export async function getImageSlot(
  db: Db,
  slug: string,
): Promise<(ImageSlot & { media: Media | null }) | null> {
  const row = await db
    .select({ slot: imageSlots, media })
    .from(imageSlots)
    .leftJoin(media, eq(media.id, imageSlots.mediaId))
    .where(eq(imageSlots.slug, slug))
    .get();

  return row ? { ...row.slot, media: row.media } : null;
}

export async function assignImageSlot(
  db: Db,
  slug: string,
  mediaId: number | null,
): Promise<void> {
  await db
    .update(imageSlots)
    .set({ mediaId, updatedAt: new Date() })
    .where(eq(imageSlots.slug, slug));
}

/** Everything the About page needs, in one call. */
export async function getAboutPageData(db: Db): Promise<AboutPageData> {
  const [profileRow, educationRows, awardRows, membershipRows, interestRows, slots] =
    await Promise.all([
      getProfile(db),
      db.select().from(education).orderBy(asc(education.sortOrder)).all(),
      db.select().from(awards).orderBy(asc(awards.sortOrder)).all(),
      db.select().from(memberships).orderBy(asc(memberships.sortOrder)).all(),
      db.select().from(researchInterests).orderBy(asc(researchInterests.sortOrder)).all(),
      getImageSlots(db),
    ]);

  return {
    profile: profileRow,
    education: educationRows,
    awards: awardRows,
    memberships: membershipRows,
    interests: interestRows,
    slots,
  };
}

export function listResearchInterests(db: Db) {
  return db.select().from(researchInterests).orderBy(asc(researchInterests.sortOrder)).all();
}

export function listEducation(db: Db) {
  return db.select().from(education).orderBy(asc(education.sortOrder)).all();
}

export function listAwards(db: Db) {
  return db.select().from(awards).orderBy(asc(awards.sortOrder)).all();
}

export function listMemberships(db: Db) {
  return db.select().from(memberships).orderBy(asc(memberships.sortOrder)).all();
}
