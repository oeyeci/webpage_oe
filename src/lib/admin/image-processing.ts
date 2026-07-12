/**
 * Client-side image processing: resize, crop and thumbnail generation.
 *
 * This runs in the browser, on a canvas, *before* the upload — not in the
 * Worker. That is a deliberate architectural choice:
 *
 *   • The Workers runtime has no native image pipeline. Doing this server-side
 *     would mean shipping a WASM encoder (photon, squoosh) into the request
 *     path — hundreds of kilobytes and tens of milliseconds of CPU on a
 *     platform billed by CPU time.
 *   • The bytes are already on the user's machine. Re-encoding a 6 MB photo
 *     down to 1.2 MB before it crosses the network makes the upload faster for
 *     them and cheaper for us.
 *   • Cloudflare Images can do this at the edge if you pay for it — see
 *     docs/ARCHITECTURE.md for how to switch.
 *
 * The server still validates everything it receives (magic bytes, real
 * dimensions read from the file header). Nothing here is trusted.
 */

export interface ProcessOptions {
  /** Longest edge of the output, in pixels. Larger images are scaled down. */
  maxDimension?: number;
  /** JPEG/WebP quality, 0–1. */
  quality?: number;
  /** Output type. WebP is ~30% smaller than JPEG at the same visual quality. */
  mimeType?: 'image/webp' | 'image/jpeg' | 'image/png';
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reads a File into an HTMLImageElement. */
export function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };

    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
      mimeType,
      quality,
    );
  });
}

/**
 * Resizes (and optionally crops) an image.
 *
 * Downscaling is done in halving steps rather than in one jump. A single
 * large-ratio `drawImage` uses bilinear sampling that skips most source pixels,
 * which is exactly what makes browser-resized photos look soft and aliased;
 * halving repeatedly averages them properly.
 */
export async function processImage(
  file: File,
  options: ProcessOptions = {},
  crop?: CropRect,
): Promise<File> {
  const { maxDimension = 2000, quality = 0.86, mimeType = 'image/webp' } = options;

  // SVG is vector — resampling it would be destructive and pointless.
  if (file.type === 'image/svg+xml') return file;

  const image = await loadImage(file);

  const source = crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };

  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const targetWidth = Math.max(1, Math.round(source.width * scale));
  const targetHeight = Math.max(1, Math.round(source.height * scale));

  // Step 1 — crop to an intermediate canvas at full resolution.
  let canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;

  let context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height,
  );

  // Step 2 — halve until within 2× of the target, then do the final step.
  let currentWidth = source.width;
  let currentHeight = source.height;

  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));

    const next = document.createElement('canvas');
    next.width = nextWidth;
    next.height = nextHeight;

    const nextContext = next.getContext('2d');
    if (!nextContext) break;

    nextContext.imageSmoothingEnabled = true;
    nextContext.imageSmoothingQuality = 'high';
    nextContext.drawImage(canvas, 0, 0, currentWidth, currentHeight, 0, 0, nextWidth, nextHeight);

    canvas = next;
    context = nextContext;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  if (currentWidth !== targetWidth || currentHeight !== targetHeight) {
    const final = document.createElement('canvas');
    final.width = targetWidth;
    final.height = targetHeight;

    const finalContext = final.getContext('2d');
    if (!finalContext) throw new Error('Canvas is unavailable in this browser.');

    finalContext.imageSmoothingEnabled = true;
    finalContext.imageSmoothingQuality = 'high';
    finalContext.drawImage(
      canvas,
      0,
      0,
      currentWidth,
      currentHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    canvas = final;
  }

  // PNG ignores the quality argument; passing it is harmless but meaningless.
  const blob = await toBlob(canvas, mimeType, quality);

  const extension = mimeType.split('/')[1]!.replace('jpeg', 'jpg');
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';

  return new File([blob], `${baseName}.${extension}`, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

/** Generates the 480px thumbnail stored alongside the original. */
export async function makeThumbnail(file: File): Promise<File | null> {
  if (file.type === 'image/svg+xml') return null;

  try {
    const thumb = await processImage(file, {
      maxDimension: 480,
      quality: 0.78,
      mimeType: 'image/webp',
    });

    return new File([thumb], `thumb-${thumb.name}`, { type: thumb.type });
  } catch {
    // A thumbnail is an optimisation, not a requirement — never block an upload
    // because we could not make one.
    return null;
  }
}

/** Intrinsic dimensions, read in the browser (the server re-reads them itself). */
export async function readDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    const image = await loadImage(file);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  }
}

/** Centre crop to a target aspect ratio (width ÷ height). */
export function centerCrop(
  width: number,
  height: number,
  aspectRatio: number,
): CropRect {
  const current = width / height;

  if (Math.abs(current - aspectRatio) < 0.001) {
    return { x: 0, y: 0, width, height };
  }

  if (current > aspectRatio) {
    // Too wide — trim the sides.
    const cropWidth = Math.round(height * aspectRatio);
    return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }

  // Too tall — trim top and bottom.
  const cropHeight = Math.round(width / aspectRatio);
  return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
