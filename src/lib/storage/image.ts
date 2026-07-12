/**
 * Image introspection from raw bytes.
 *
 * The brief requires that uploaded images be dimension-validated. The browser
 * *does* send width/height alongside the upload, but a client can send anything
 * — so the server reads the dimensions out of the file header itself and uses
 * that. This is a few dozen lines of header parsing and removes a whole class
 * of "I said it was 1200×630" bugs.
 *
 * Supported: PNG, JPEG, GIF, WebP (VP8 / VP8L / VP8X), AVIF/HEIF, SVG.
 */

export interface ImageSize {
  width: number;
  height: number;
}

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * PDF is the one non-image type the media library accepts, and only where a
 * document is explicitly expected (the CV). It is never accepted for an image
 * slot, and it is served with `Content-Disposition: inline` from the same
 * sniffing-based route, so it cannot be used to smuggle HTML.
 */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf'] as const;
export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

export type AllowedUploadType = AllowedImageType | AllowedDocumentType;

/** 10 MB — generous for a photo, small enough to bound a Worker's memory. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function isJpeg(b: Uint8Array): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isGif(b: Uint8Array): boolean {
  return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
}

function isWebp(b: Uint8Array): boolean {
  return (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  );
}

function isAvif(b: Uint8Array): boolean {
  // ISO-BMFF: 4-byte size, then "ftyp", then a brand.
  if (!(b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return false;
  const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
  return ['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(brand);
}

/** PNG: IHDR is always the first chunk — width/height are big-endian at 16..24. */
function pngSize(view: DataView): ImageSize {
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/** GIF: logical screen descriptor, little-endian, at bytes 6..10. */
function gifSize(view: DataView): ImageSize {
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/**
 * JPEG: walk the marker segments until a Start-Of-Frame (SOFn) is found.
 * SOF0/1/2/3/5/6/7/9/10/11/13/14/15 carry the dimensions; DHT/DAC/RST do not.
 */
function jpegSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  let offset = 2; // skip SOI

  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1]!;

    // Standalone markers with no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan

    const length = view.getUint16(offset + 2, false);
    if (length < 2) break;

    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC

    if (isSof) {
      // SOF payload: [length:2][precision:1][height:2][width:2]
      return {
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }

    offset += 2 + length;
  }

  return null;
}

/** WebP has three sub-formats, each storing its size differently. */
function webpSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);

  // Simple lossy: 'VP8 ' — dimensions are 14 bytes into the frame header.
  if (chunk === 'VP8 ') {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  // Lossless: 'VP8L' — 14 bits each, bit-packed after the 0x2f signature.
  if (chunk === 'VP8L') {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  // Extended: 'VP8X' — 24-bit little-endian canvas size, minus one.
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height };
  }

  return null;
}

/**
 * AVIF/HEIF: scan for the `ispe` (image spatial extents) box, which holds the
 * canvas size as two big-endian uint32s after a 4-byte version/flags field.
 */
function avifSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  for (let i = 0; i < bytes.length - 12; i += 1) {
    if (
      bytes[i] === 0x69 && // i
      bytes[i + 1] === 0x73 && // s
      bytes[i + 2] === 0x70 && // p
      bytes[i + 3] === 0x65 // e
    ) {
      return {
        width: view.getUint32(i + 8, false),
        height: view.getUint32(i + 12, false),
      };
    }
  }
  return null;
}

/** SVG: read width/height, falling back to the viewBox. */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const head = new TextDecoder().decode(bytes.slice(0, 2048));

  const width = /\bwidth\s*=\s*["']?\s*([\d.]+)/i.exec(head);
  const height = /\bheight\s*=\s*["']?\s*([\d.]+)/i.exec(head);
  if (width && height) {
    return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
  }

  const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
  if (viewBox) {
    return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  }

  return null;
}

/**
 * Reads an image's intrinsic dimensions from its bytes.
 * Returns `null` when the format is unknown or the header is truncated.
 */
export function readImageSize(buffer: ArrayBuffer): ImageSize | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 32) return null;

  const view = new DataView(buffer);

  try {
    if (isPng(bytes)) return pngSize(view);
    if (isGif(bytes)) return gifSize(view);
    if (isJpeg(bytes)) return jpegSize(view, bytes);
    if (isWebp(bytes)) return webpSize(view, bytes);
    if (isAvif(bytes)) return avifSize(view, bytes);
    if (bytes[0] === 0x3c) return svgSize(bytes); // '<'
  } catch {
    return null;
  }

  return null;
}

/**
 * Sniffs the true MIME type from magic bytes.
 *
 * The `Content-Type` on a multipart part is attacker-controlled, so a file
 * claiming `image/png` while actually being an HTML document would otherwise be
 * stored and later served as HTML. We serve from a Worker route with an
 * explicit Content-Type taken from *this* function, never from the client.
 */
export function sniffImageType(buffer: ArrayBuffer): AllowedImageType | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) return null;

  if (isPng(bytes)) return 'image/png';
  if (isJpeg(bytes)) return 'image/jpeg';
  if (isGif(bytes)) return 'image/gif';
  if (isWebp(bytes)) return 'image/webp';
  if (isAvif(bytes)) return 'image/avif';

  // SVG is text; require an <svg> root within the first chunk.
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    if (/<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 2048)))) {
      return 'image/svg+xml';
    }
  }

  return null;
}

/** `%PDF-` magic bytes. */
export function sniffPdf(buffer: ArrayBuffer): AllowedDocumentType | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 5) return null;

  const isPdf =
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d; // -

  return isPdf ? 'application/pdf' : null;
}

/**
 * Sniffs any type the media library accepts.
 * `allowDocuments` must be opted into — an image slot must never take a PDF.
 */
export function sniffUploadType(
  buffer: ArrayBuffer,
  options: { allowDocuments?: boolean } = {},
): AllowedUploadType | null {
  const image = sniffImageType(buffer);
  if (image) return image;
  if (options.allowDocuments) return sniffPdf(buffer);
  return null;
}

export interface DimensionRule {
  requiredWidth?: number | null;
  requiredHeight?: number | null;
  aspectRatio?: number | null;
  tolerance?: number;
}

/**
 * Validates an image against a slot's dimension rule.
 * Returns a human-readable reason on failure — it is shown directly in the
 * admin UI, so it must say what to do, not just that something is wrong.
 */
export function validateDimensions(
  size: ImageSize,
  rule: DimensionRule,
): { ok: true } | { ok: false; reason: string } {
  const tolerance = rule.tolerance ?? 0;

  if (rule.requiredWidth != null && Math.abs(size.width - rule.requiredWidth) > tolerance) {
    return {
      ok: false,
      reason: `This slot expects a width of ${rule.requiredWidth}px${
        tolerance ? ` (±${tolerance}px)` : ''
      }, but the image is ${size.width}px wide.`,
    };
  }

  if (rule.requiredHeight != null && Math.abs(size.height - rule.requiredHeight) > tolerance) {
    return {
      ok: false,
      reason: `This slot expects a height of ${rule.requiredHeight}px${
        tolerance ? ` (±${tolerance}px)` : ''
      }, but the image is ${size.height}px tall.`,
    };
  }

  if (rule.aspectRatio != null && size.height > 0) {
    const actual = size.width / size.height;
    // 2% tolerance: a 1200×630 OG image is 1.905, and 1200×628 is 1.911 —
    // both are fine, and rejecting the second would be pedantic.
    if (Math.abs(actual - rule.aspectRatio) / rule.aspectRatio > 0.02) {
      return {
        ok: false,
        reason: `This slot expects a ${rule.aspectRatio.toFixed(2)}:1 aspect ratio, but the image is ${actual.toFixed(2)}:1 (${size.width}×${size.height}).`,
      };
    }
  }

  return { ok: true };
}
