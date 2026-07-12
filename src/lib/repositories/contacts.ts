/**
 * Contact-form submissions and the admin audit log.
 */
import { count, desc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db';
import {
  auditLogs,
  contacts,
  users,
  type Contact,
  type ContactStatus,
} from '../db/schema';

export async function createContact(
  db: Db,
  input: {
    name: string;
    email: string;
    subject: string;
    message: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    country?: string | null;
  },
): Promise<Contact> {
  return db
    .insert(contacts)
    .values({
      name: input.name.slice(0, 200),
      email: input.email.slice(0, 320),
      subject: input.subject.slice(0, 300),
      message: input.message.slice(0, 10_000),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      country: input.country ?? null,
    })
    .returning()
    .get();
}

export async function listContacts(
  db: Db,
  options: { status?: ContactStatus; limit?: number; offset?: number } = {},
): Promise<{ items: Contact[]; total: number; unread: number }> {
  const { limit = 25, offset = 0 } = options;
  const where = options.status ? eq(contacts.status, options.status) : undefined;

  const [items, totalRow, unreadRow] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt))
      .limit(limit)
      .offset(offset)
      .all(),
    db.select({ n: count() }).from(contacts).where(where).get(),
    db.select({ n: count() }).from(contacts).where(eq(contacts.status, 'new')).get(),
  ]);

  return { items, total: totalRow?.n ?? 0, unread: unreadRow?.n ?? 0 };
}

export function getContact(db: Db, id: number) {
  return db.select().from(contacts).where(eq(contacts.id, id)).get();
}

export async function setContactStatus(
  db: Db,
  id: number,
  status: ContactStatus,
): Promise<boolean> {
  const result = await db
    .update(contacts)
    .set({ status, readAt: status === 'new' ? null : new Date() })
    .where(eq(contacts.id, id))
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function deleteContact(db: Db, id: number): Promise<boolean> {
  const result = await db.delete(contacts).where(eq(contacts.id, id)).run();
  return (result.meta.changes ?? 0) > 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Audit log
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Records an admin action.
 *
 * Never throws: an audit write that fails must not take down the operation it
 * was recording. The failure is logged to the Workers console (and so to
 * Logpush / `wrangler tail`), which is the backstop.
 */
export async function audit(
  db: Db,
  entry: {
    userId?: number | null;
    action: string;
    entity?: string;
    entityId?: string | number;
    meta?: Record<string, unknown>;
    ipAddress?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      meta: entry.meta ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (cause) {
    console.error('audit write failed', entry.action, cause);
  }
}

export async function listAuditLogs(
  db: Db,
  options: { limit?: number; offset?: number; action?: string } = {},
) {
  const { limit = 50, offset = 0 } = options;
  const where = options.action ? eq(auditLogs.action, options.action) : undefined;

  const rows = await db
    .select({
      log: auditLogs,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit)
    .offset(offset)
    .all();

  const total = await db.select({ n: count() }).from(auditLogs).where(where).get();

  return {
    items: rows.map((r) => ({ ...r.log, userName: r.userName })),
    total: total?.n ?? 0,
  };
}

/**
 * Trims the audit log to its most recent `keep` rows. Run from cron.
 *
 * Finds the id of the `keep`-th newest row and deletes everything older, which
 * is one indexed range delete rather than a row-by-row sweep.
 */
export async function pruneAuditLogs(db: Db, keep = 5000): Promise<number> {
  const cutoff = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1)
    .offset(keep)
    .get();

  // Fewer than `keep` rows exist — nothing to prune.
  if (!cutoff) return 0;

  const result = await db.delete(auditLogs).where(lte(auditLogs.id, cutoff.id)).run();
  return result.meta.changes ?? 0;
}
