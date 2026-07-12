import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { badRequest, handle, json, noContent, notFound, parseJson } from '../../../../lib/api/response';
import { publicationPatchSchema } from '../../../../lib/validation/schemas';
import {
  deletePublication,
  getPublication,
  updatePublicationMeta,
} from '../../../../lib/repositories/publications';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * PATCH — edit the metadata a BibTeX entry cannot carry.
 *
 * The bibliographic fields themselves are deliberately NOT editable here: they
 * are derived from `bibtex_raw`, which is the source of truth. Changing a title
 * means re-importing the corrected BibTeX, so the stored entry and the citation
 * can never disagree. What *is* editable is everything BibTeX has no field for:
 * whether the entry is featured, its citation count, and the PDF/code/slides links.
 */
export const PATCH: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getPublication(db, id);
    if (!existing) return notFound();

    const patch = await parseJson(context.request, publicationPatchSchema);
    if (Object.keys(patch).length === 0) return badRequest('No fields to update.');

    await updatePublicationMeta(db, id, patch);

    await audit(db, {
      userId: user.id,
      action: 'publications.update',
      entity: 'publications',
      entityId: id,
      meta: { citeKey: existing.citeKey, fields: Object.keys(patch) },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(await getPublication(db, id));
  });

export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getPublication(db, id);
    if (!existing) return notFound();

    await deletePublication(db, id);

    await audit(db, {
      userId: user.id,
      action: 'publications.delete',
      entity: 'publications',
      entityId: id,
      meta: { citeKey: existing.citeKey, title: existing.title },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return noContent();
  });
