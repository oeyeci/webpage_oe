import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../../lib/context';
import { badRequest, handle, json, parseJson } from '../../../../lib/api/response';
import { bibtexImportSchema } from '../../../../lib/validation/schemas';
import { parseBibtexToDrafts } from '../../../../lib/bibtex';
import {
  importPublications,
  listPublications,
  markSelfAuthors,
} from '../../../../lib/repositories/publications';
import { getSetting } from '../../../../lib/repositories/settings';
import { audit } from '../../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../../lib/cache';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();
    return json(await listPublications(db, { includeUnpublished: true }));
  });

/**
 * POST /api/admin/publications — import BibTeX.
 *
 * This is the whole publication workflow: the admin pastes BibTeX (one entry or
 * a hundred, from IEEE Xplore, Scopus or Google Scholar) and everything else —
 * parsing, LaTeX decoding, author deduplication, IEEE citation generation,
 * category classification — happens here.
 *
 * Parse errors do not abort the import. A paste of 50 entries with one bad
 * entry imports 49 and reports the one, which is what you want when you are
 * bulk-loading a career's worth of references.
 */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const { bibtex, overwrite } = await parseJson(context.request, bibtexImportSchema);

    const { drafts, errors, warnings } = parseBibtexToDrafts(bibtex);

    if (drafts.length === 0) {
      return badRequest(
        errors[0] ?? 'No valid BibTeX entries were found.',
        { bibtex: errors.length > 0 ? errors : ['No valid BibTeX entries were found.'] },
      );
    }

    const outcomes = await importPublications(db, drafts, { overwrite });

    // Re-mark the owner's author rows: an import can create a *new* author row
    // for the owner under a spelling not seen before (e.g. "Eyecioglu, O.").
    const aliases = await getSetting(db, 'publications.selfAliases');
    await markSelfAuthors(db, aliases);

    const summary = {
      created: outcomes.filter((o) => o.status === 'created').length,
      updated: outcomes.filter((o) => o.status === 'updated').length,
      skipped: outcomes.filter((o) => o.status === 'skipped').length,
    };

    await audit(db, {
      userId: user.id,
      action: 'publications.import',
      entity: 'publications',
      meta: { ...summary, errors: errors.length },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json({ ...summary, outcomes, errors, warnings });
  });
