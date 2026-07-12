/**
 * Typed site settings.
 *
 * The store is a key/value table, but every key has a Zod schema and a default,
 * so callers get a fully-typed object and a missing or corrupted row degrades to
 * the default instead of crashing a page render.
 */
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db';
import { settings } from '../db/schema';

export const SITE_SETTINGS = {
  'site.title': {
    schema: z.string().min(1).max(120),
    default: 'Önder Eyecioğlu',
    group: 'general',
    label: 'Site title',
  },
  'site.description': {
    schema: z.string().min(1).max(300),
    default:
      'Associate Professor of Computer Engineering researching quantum machine learning, smart grids and computational materials.',
    group: 'seo',
    label: 'Meta description',
  },
  'site.keywords': {
    schema: z.array(z.string()).max(30),
    default: [
      'quantum machine learning',
      'smart grid',
      'computer engineering',
      'carbon nanotubes',
      'artificial intelligence',
    ],
    group: 'seo',
    label: 'SEO keywords',
  },
  'site.locale': {
    schema: z.string().min(2).max(10),
    default: 'en',
    group: 'general',
    label: 'Locale',
  },
  /** Author-name aliases that should be bold in every publication byline. */
  'publications.selfAliases': {
    schema: z.array(z.string()).max(20),
    default: ['Eyecioğlu, Önder', 'Eyecioglu, Onder', 'Eyecioğlu, Ö.'],
    group: 'publications',
    label: 'Author highlighting aliases',
  },
  'publications.showCitationCounts': {
    schema: z.boolean(),
    default: true,
    group: 'publications',
    label: 'Show citation counters',
  },
  'contact.enabled': {
    schema: z.boolean(),
    default: true,
    group: 'contact',
    label: 'Contact form enabled',
  },
  'contact.notifyEmail': {
    schema: z.boolean(),
    default: true,
    group: 'contact',
    label: 'Email me on new messages',
  },
  'blog.postsPerPage': {
    schema: z.number().int().min(3).max(48),
    default: 9,
    group: 'blog',
    label: 'Posts per page',
  },
  'home.showBlog': {
    schema: z.boolean(),
    default: true,
    group: 'home',
    label: 'Show latest posts on the home page',
  },
  'home.showActivities': {
    schema: z.boolean(),
    default: true,
    group: 'home',
    label: 'Show recent activities on the home page',
  },
} as const;

export type SettingKey = keyof typeof SITE_SETTINGS;

export type SettingsMap = {
  [K in SettingKey]: z.infer<(typeof SITE_SETTINGS)[K]['schema']>;
};

/** The defaults, used before anything has been saved and as a fallback. */
export function defaultSettings(): SettingsMap {
  const out = {} as SettingsMap;
  for (const key of Object.keys(SITE_SETTINGS) as SettingKey[]) {
    // Each default is declared alongside its schema, so this cast is safe.
    (out as Record<string, unknown>)[key] = SITE_SETTINGS[key].default;
  }
  return out;
}

/**
 * Loads all settings, merged over the defaults.
 * A row whose stored JSON no longer matches its schema (because the schema was
 * tightened in a later release) falls back to the default rather than throwing.
 */
export async function getSettings(db: Db): Promise<SettingsMap> {
  const merged = defaultSettings();

  let rows: Array<{ key: string; value: unknown }>;
  try {
    rows = await db.select({ key: settings.key, value: settings.value }).from(settings).all();
  } catch {
    return merged;
  }

  for (const row of rows) {
    const definition = SITE_SETTINGS[row.key as SettingKey];
    if (!definition) continue;

    const parsed = definition.schema.safeParse(row.value);
    if (parsed.success) {
      (merged as Record<string, unknown>)[row.key] = parsed.data;
    }
  }

  return merged;
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingsMap[K]> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return SITE_SETTINGS[key].default as SettingsMap[K];

  const parsed = SITE_SETTINGS[key].schema.safeParse(row.value);
  return (parsed.success ? parsed.data : SITE_SETTINGS[key].default) as SettingsMap[K];
}

/** Validates and upserts a batch of settings. Unknown keys are rejected. */
export async function updateSettings(
  db: Db,
  patch: Partial<Record<SettingKey, unknown>>,
): Promise<{ updated: SettingKey[]; errors: Record<string, string> }> {
  const updated: SettingKey[] = [];
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(patch)) {
    const definition = SITE_SETTINGS[key as SettingKey];
    if (!definition) {
      errors[key] = 'Unknown setting.';
      continue;
    }

    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      errors[key] = parsed.error.issues[0]?.message ?? 'Invalid value.';
      continue;
    }

    await db
      .insert(settings)
      .values({ key, value: parsed.data, group: definition.group, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: parsed.data, updatedAt: new Date() },
      });

    updated.push(key as SettingKey);
  }

  return { updated, errors };
}

/** Removes stored overrides, restoring the defaults. */
export async function resetSettings(db: Db, keys: SettingKey[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(settings).where(inArray(settings.key, keys));
}
