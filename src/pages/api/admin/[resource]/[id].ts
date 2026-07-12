import type { APIRoute } from 'astro';
import { eq, sql } from 'drizzle-orm';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { badRequest, handle, json, noContent, notFound, parseJson } from '../../../../lib/api/response';
import { getResource, isResourceName } from '../../../../lib/api/resources';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

/** Every registered resource has an integer `id` primary key. */
function idColumn(table: unknown) {
  return (table as { id: never }).id;
}

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);

    const name = context.params.resource;
    if (!isResourceName(name)) return notFound('Unknown resource.');

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const { table } = getResource(name);
    const db = getDb();

    const row = await db.select().from(table).where(eq(idColumn(table), id)).get();
    if (!row) return notFound();

    return json(row);
  });

/**
 * PATCH — partial update.
 *
 * The resource's schema is parsed with `.partial()` so a client can send one
 * field without having to echo back the whole record. Zod refinements that span
 * fields are dropped by `.partial()`, so cross-field rules (like "end date must
 * follow start date") are re-checked against the *merged* row below.
 */
export const PATCH: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);

    const name = context.params.resource;
    if (!isResourceName(name)) return notFound('Unknown resource.');

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const { table, schema, transform, label } = getResource(name);
    const db = getDb();
    const env = getEnv();

    const existing = await db.select().from(table).where(eq(idColumn(table), id)).get();
    if (!existing) return notFound();

    // `schema` may be a ZodEffects (a refined object); unwrap to reach `.partial()`.
    const base =
      'innerType' in schema && typeof (schema as { innerType?: unknown }).innerType === 'function'
        ? (schema as unknown as { innerType: () => { partial: () => typeof schema } }).innerType()
        : (schema as unknown as { partial: () => typeof schema });

    const patch = (await parseJson(
      context.request,
      (base as { partial: () => typeof schema }).partial(),
    )) as Record<string, unknown>;

    if (Object.keys(patch).length === 0) return badRequest('No fields to update.');

    // Re-validate the whole record so cross-field rules still hold after merge.
    const merged = { ...(existing as Record<string, unknown>), ...patch };
    const check = schema.safeParse(merged);
    if (!check.success) {
      const details: Record<string, string[]> = {};
      for (const issue of check.error.issues) {
        (details[issue.path.join('.') || '_'] ??= []).push(issue.message);
      }
      return badRequest('Some fields need attention.', details);
    }

    const values = transform ? await transform(patch) : patch;

    const row = await db
      .update(table)
      .set({
        ...(values as object),
        // Not every registered table has `updated_at`; set it only where it exists.
        ...('updatedAt' in (existing as object) ? { updatedAt: sql`(unixepoch())` } : {}),
      } as never)
      .where(eq(idColumn(table), id))
      .returning()
      .get();

    await audit(db, {
      userId: user.id,
      action: `${name}.update`,
      entity: name,
      entityId: id,
      meta: { label, fields: Object.keys(patch) },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(row);
  });

export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);

    const name = context.params.resource;
    if (!isResourceName(name)) return notFound('Unknown resource.');

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const { table, label } = getResource(name);
    const db = getDb();
    const env = getEnv();

    const result = await db.delete(table).where(eq(idColumn(table), id)).run();
    if ((result.meta.changes ?? 0) === 0) return notFound();

    await audit(db, {
      userId: user.id,
      action: `${name}.delete`,
      entity: name,
      entityId: id,
      meta: { label },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return noContent();
  });
