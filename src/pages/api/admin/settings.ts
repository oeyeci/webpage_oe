import type { APIRoute } from 'astro';
import { getDb, getEnv, getRequestMeta, requireAdmin } from '../../../lib/context';
import { badRequest, handle, json, parseJson } from '../../../lib/api/response';
import { settingsSchema } from '../../../lib/validation/schemas';
import { SITE_SETTINGS, getSettings, updateSettings } from '../../../lib/repositories/settings';
import { markSelfAuthors } from '../../../lib/repositories/publications';
import { audit } from '../../../lib/repositories/contacts';
import { bumpContentVersion } from '../../../lib/cache';

export const prerender = false;

export const GET: APIRoute = async (context) =>
  handle(async () => {
    requireAdmin(context);
    const db = getDb();

    // Ship the definitions alongside the values so the admin UI can render the
    // form (labels, groups) without duplicating the schema on the client.
    const definitions = Object.entries(SITE_SETTINGS).map(([key, definition]) => ({
      key,
      label: definition.label,
      group: definition.group,
    }));

    return json({ values: await getSettings(db), definitions });
  });

export const PATCH: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();
    const env = getEnv();

    const patch = await parseJson(context.request, settingsSchema);
    const { updated, errors } = await updateSettings(db, patch);

    if (Object.keys(errors).length > 0) {
      return badRequest(
        'Some settings could not be saved.',
        Object.fromEntries(Object.entries(errors).map(([key, message]) => [key, [message]])),
      );
    }

    // Changing the author-highlight aliases has to re-mark the author rows, or
    // the setting would only take effect on the next publication import.
    if (updated.includes('publications.selfAliases')) {
      const aliases = patch['publications.selfAliases'];
      if (Array.isArray(aliases)) {
        await markSelfAuthors(db, aliases as string[]);
      }
    }

    await audit(db, {
      userId: user.id,
      action: 'settings.update',
      entity: 'settings',
      meta: { keys: updated },
      ipAddress: getRequestMeta(context).ip,
    });

    await bumpContentVersion(env.KV);

    return json({ updated, values: await getSettings(db) });
  });
