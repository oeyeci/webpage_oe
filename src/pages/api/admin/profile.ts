import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../lib/context';
import { handle, json, parseJson } from '../../../lib/api/response';
import { profileSchema } from '../../../lib/validation/schemas';
import { getProfile, updateProfile } from '../../../lib/repositories/about';
import { renderRichText } from '../../../lib/content/markdown';
import { audit } from '../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../lib/cache';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    return json(await getProfile(getDb()));
  });

/** PUT /api/admin/profile — the profile is a singleton, so there is no id. */
export const PUT: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const input = await parseJson(context.request, profileSchema);

    // Both biographies are authored in markdown and rendered once, on save.
    const [professionalBioHtml, academicBioHtml] = await Promise.all([
      input.professionalBioMd.trim() ? renderRichText(input.professionalBioMd) : null,
      input.academicBioMd.trim() ? renderRichText(input.academicBioMd) : null,
    ]);

    await updateProfile(db, {
      ...input,
      professionalBioHtml,
      academicBioHtml,
    });

    await audit(db, {
      userId: user.id,
      action: 'profile.update',
      entity: 'profile',
      entityId: 1,
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json(await getProfile(db));
  });
