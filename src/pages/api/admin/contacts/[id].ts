import type { APIRoute } from 'astro';
import { getDb, getRequestMeta, requireAdmin } from '../../../../lib/context';
import {
  badRequest,
  handle,
  json,
  noContent,
  notFound,
  parseJson,
} from '../../../../lib/api/response';
import { contactStatusSchema } from '../../../../lib/validation/schemas';
import {
  deleteContact,
  getContact,
  setContactStatus,
} from '../../../../lib/repositories/contacts';
import { audit } from '../../../../lib/repositories/contacts';

export const prerender = false;

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const PATCH: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getContact(db, id);
    if (!existing) return notFound();

    const { status } = await parseJson(context.request, contactStatusSchema);
    await setContactStatus(db, id, status);

    await audit(db, {
      userId: user.id,
      action: 'contacts.status',
      entity: 'contacts',
      entityId: id,
      meta: { from: existing.status, to: status },
      ipAddress: getRequestMeta(context).ip,
    });

    return json(await getContact(db, id));
  });

export const DELETE: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();

    const id = parseId(context.params.id);
    if (id === null) return badRequest('Invalid id.');

    const existing = await getContact(db, id);
    if (!existing) return notFound();

    await deleteContact(db, id);

    await audit(db, {
      userId: user.id,
      action: 'contacts.delete',
      entity: 'contacts',
      entityId: id,
      // Never copy the message body into the audit log — deleting a message
      // must actually delete it, not move it somewhere less visible.
      meta: { from: existing.email },
      ipAddress: getRequestMeta(context).ip,
    });

    return noContent();
  });
