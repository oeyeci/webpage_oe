/**
 * Cloudflare R2 media storage.
 *
 * Objects are never made public on the bucket itself. They are served through
 * the `/media/[...key]` Worker route, which sets an immutable cache header and
 * a Content-Type derived from the file's magic bytes rather than from whatever
 * the uploader claimed. That keeps a "PNG" that is really an HTML document from
 * ever being served as HTML.
 */
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { media } from '../db/schema';
import { slugify } from '../utils/text';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  readImageSize,
  sniffImageType,
  sniffUploadType,
  validateDimensions,
  type AllowedUploadType,
  type DimensionRule,
} from './image';

export interface UploadInput {
  file: File;
  folder?: string;
  alt?: string;
  caption?: string;
  uploadedBy?: number | null;
  /** Optional dimension rule, supplied when uploading into an image slot. */
  rule?: DimensionRule;
  /** Pre-generated thumbnail (produced client-side by a canvas resize). */
  thumbnail?: File | null;
  /** Permits PDF uploads. Only the CV endpoint sets this. */
  allowDocuments?: boolean;
}

export type UploadResult =
  | { ok: true; media: typeof media.$inferSelect }
  | { ok: false; status: number; error: string };

/** `2026/07/portrait-a1b2c3d4.webp` — date-partitioned, collision-proof. */
function buildKey(filename: string, mimeType: AllowedUploadType, folder: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  const base = slugify(filename.replace(/\.[^.]+$/, '')) || 'file';
  const ext = extensionFor(mimeType);
  const unique = crypto.randomUUID().slice(0, 8);

  return `${slugify(folder) || 'uploads'}/${year}/${month}/${base}-${unique}.${ext}`;
}

function extensionFor(mimeType: AllowedUploadType): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    case 'image/svg+xml':
      return 'svg';
    case 'application/pdf':
      return 'pdf';
  }
}

/**
 * Validates, stores and records an upload.
 *
 * Validation order matters: cheap checks (size) before expensive ones
 * (reading the whole body), and the MIME type is *sniffed*, never trusted.
 */
export async function uploadMedia(
  db: Db,
  bucket: R2Bucket,
  input: UploadInput,
): Promise<UploadResult> {
  const { file } = input;

  if (!file || file.size === 0) {
    return { ok: false, status: 400, error: 'No file was provided.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${
        MAX_UPLOAD_BYTES / 1_048_576
      } MB.`,
    };
  }

  const buffer = await file.arrayBuffer();

  // The declared Content-Type is attacker-controlled; the magic bytes are not.
  const mimeType = sniffUploadType(buffer, { allowDocuments: input.allowDocuments });
  if (!mimeType) {
    const allowed = input.allowDocuments
      ? [...ALLOWED_IMAGE_TYPES, 'application/pdf']
      : [...ALLOWED_IMAGE_TYPES];
    return {
      ok: false,
      status: 415,
      error: `Unsupported file type. Allowed formats: ${allowed.join(', ')}.`,
    };
  }

  const isImage = mimeType !== 'application/pdf';
  const size = isImage ? readImageSize(buffer) : null;

  if (isImage && !size && mimeType !== 'image/svg+xml') {
    return {
      ok: false,
      status: 422,
      error: 'The image header could not be read; the file may be corrupt.',
    };
  }

  // A dimension rule belongs to an image slot, so a document can never satisfy it.
  if (input.rule) {
    if (!isImage || !size) {
      return { ok: false, status: 422, error: 'This slot requires an image, not a document.' };
    }
    const check = validateDimensions(size, input.rule);
    if (!check.ok) return { ok: false, status: 422, error: check.reason };
  }

  const folder = input.folder ?? 'uploads';
  const key = buildKey(file.name, mimeType, folder);

  await bucket.put(key, buffer, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      originalName: file.name.slice(0, 200),
      uploadedAt: new Date().toISOString(),
    },
  });

  // Thumbnails are produced client-side (canvas) and uploaded alongside the
  // original — Workers has no native image pipeline, and shipping a WASM
  // encoder into the request path would cost more than it saves.
  let thumbKey: string | null = null;
  if (input.thumbnail && input.thumbnail.size > 0) {
    const thumbBuffer = await input.thumbnail.arrayBuffer();
    const thumbType = sniffImageType(thumbBuffer);
    if (thumbType) {
      thumbKey = `${key.replace(/\.[^.]+$/, '')}-thumb.${extensionFor(thumbType)}`;
      await bucket.put(thumbKey, thumbBuffer, {
        httpMetadata: {
          contentType: thumbType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  const row = await db
    .insert(media)
    .values({
      r2Key: key,
      thumbKey,
      filename: file.name.slice(0, 200),
      mimeType,
      size: file.size,
      width: size?.width ?? null,
      height: size?.height ?? null,
      alt: input.alt?.slice(0, 500) ?? '',
      caption: input.caption?.slice(0, 1000) ?? null,
      folder,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning()
    .get();

  return { ok: true, media: row };
}

/**
 * Deletes a media row and its R2 objects.
 *
 * The database row goes first: if the R2 delete then fails we are left with an
 * orphaned object (invisible, costs a fraction of a cent, swept by the
 * `media:gc` cron) rather than a dangling row that renders a broken image on a
 * live page. Failing in the direction of "correct page, wasted byte" is the
 * right trade.
 */
export async function deleteMedia(db: Db, bucket: R2Bucket, id: number): Promise<boolean> {
  const row = await db.select().from(media).where(eq(media.id, id)).get();
  if (!row) return false;

  await db.delete(media).where(eq(media.id, id));

  await Promise.allSettled([
    bucket.delete(row.r2Key),
    row.thumbKey ? bucket.delete(row.thumbKey) : Promise.resolve(),
  ]);

  return true;
}

/** Streams an object out of R2 for the public `/media/[...key]` route. */
export async function getMediaObject(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  const object = await bucket.get(key);
  return object ?? null;
}

/** Public URL for a stored key. */
export function mediaUrl(key: string | null | undefined, base = '/media'): string {
  if (!key) return '';
  return `${base}/${key}`;
}

/** Finds a media row by its R2 key. */
export function findByKey(db: Db, key: string) {
  return db.select().from(media).where(eq(media.r2Key, key)).get();
}

/** Lists the media library, newest first, optionally filtered by folder. */
export function listMedia(
  db: Db,
  options: { folder?: string; limit?: number; offset?: number } = {},
) {
  const { folder, limit = 60, offset = 0 } = options;

  const query = db.select().from(media).$dynamic();
  if (folder) query.where(eq(media.folder, folder));

  return query.orderBy(desc(media.createdAt), desc(media.id)).limit(limit).offset(offset).all();
}
