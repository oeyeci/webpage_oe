import type { APIRoute } from 'astro';
import { getDb, getRequestMeta, requireAdmin } from '../../../lib/context';
import { handle } from '../../../lib/api/response';
import * as schema from '../../../lib/db/schema';
import { audit } from '../../../lib/repositories/contacts';

export const prerender = false;

/**
 * GET /api/admin/backup — full content export as JSON.
 *
 * This is the "get my data out" escape hatch, and it is deliberately a plain
 * JSON dump of every content table rather than a proprietary format: it can be
 * read by anything, diffed in git, and restored with `scripts/restore.mjs`.
 *
 * Two things are *not* included, on purpose:
 *   • `users` — password hashes and session data never leave the database.
 *   • R2 objects — media bytes are backed up by `wrangler r2` (see
 *     docs/OPERATIONS.md); this export carries their metadata and keys so a
 *     restore can re-link them.
 *
 * Contact messages are included but can be excluded with `?contacts=0`, since
 * they contain third-party personal data that you may not want in a file you
 * are about to email to yourself.
 */
export const GET: APIRoute = async (context) =>
  handle(async () => {
    const user = requireAdmin(context);
    const db = getDb();

    const url = new URL(context.request.url);
    const includeContacts = url.searchParams.get('contacts') !== '0';

    const [
      profile,
      researchInterests,
      education,
      awards,
      memberships,
      experiences,
      projects,
      supervisedTheses,
      authors,
      publications,
      publicationAuthors,
      blogCategories,
      blogTags,
      blogPosts,
      blogPostTags,
      blogPostGallery,
      activityCategories,
      activities,
      activityImages,
      skillCategories,
      skills,
      media,
      imageSlots,
      settings,
      contacts,
    ] = await Promise.all([
      db.select().from(schema.profile).all(),
      db.select().from(schema.researchInterests).all(),
      db.select().from(schema.education).all(),
      db.select().from(schema.awards).all(),
      db.select().from(schema.memberships).all(),
      db.select().from(schema.experiences).all(),
      db.select().from(schema.projects).all(),
      db.select().from(schema.supervisedTheses).all(),
      db.select().from(schema.authors).all(),
      db.select().from(schema.publications).all(),
      db.select().from(schema.publicationAuthors).all(),
      db.select().from(schema.blogCategories).all(),
      db.select().from(schema.blogTags).all(),
      db.select().from(schema.blogPosts).all(),
      db.select().from(schema.blogPostTags).all(),
      db.select().from(schema.blogPostGallery).all(),
      db.select().from(schema.activityCategories).all(),
      db.select().from(schema.activities).all(),
      db.select().from(schema.activityImages).all(),
      db.select().from(schema.skillCategories).all(),
      db.select().from(schema.skills).all(),
      db.select().from(schema.media).all(),
      db.select().from(schema.imageSlots).all(),
      db.select().from(schema.settings).all(),
      includeContacts ? db.select().from(schema.contacts).all() : Promise.resolve([]),
    ]);

    const backup = {
      meta: {
        version: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: user.email,
        includesContacts: includeContacts,
        note: 'Media bytes live in R2 and are not included; see docs/OPERATIONS.md.',
      },
      data: {
        profile,
        researchInterests,
        education,
        awards,
        memberships,
        experiences,
        projects,
        supervisedTheses,
        authors,
        publications,
        publicationAuthors,
        blogCategories,
        blogTags,
        blogPosts,
        blogPostTags,
        blogPostGallery,
        activityCategories,
        activities,
        activityImages,
        skillCategories,
        skills,
        media,
        imageSlots,
        settings,
        contacts,
      },
    };

    await audit(db, {
      userId: user.id,
      action: 'backup.export',
      meta: { includeContacts },
      ipAddress: getRequestMeta(context).ip,
    });

    const stamp = new Date().toISOString().slice(0, 10);

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ondereyecioglu-backup-${stamp}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
