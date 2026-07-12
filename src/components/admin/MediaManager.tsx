import { useCallback, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import {
  centerCrop,
  formatBytes,
  makeThumbnail,
  processImage,
  readDimensions,
} from '../../lib/admin/image-processing';
import { Confirm, Field, Modal, Pill, Toaster, useToasts } from './ui';

export interface MediaItem {
  id: number;
  r2Key: string;
  thumbKey: string | null;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string | null;
  folder: string;
}

export interface ImageSlot {
  slug: string;
  label: string;
  description: string | null;
  requiredWidth: number | null;
  requiredHeight: number | null;
  aspectRatio: number | null;
  mediaId: number | null;
}

interface Props {
  initial: MediaItem[];
  slots?: ImageSlot[];
  /** Picker mode: chosen media is returned instead of managed. */
  onPick?: (item: MediaItem) => void;
  mediaBase?: string;
}

const FOLDERS = ['uploads', 'blog', 'activities', 'about', 'cv'];

export default function MediaManager({
  initial,
  slots = [],
  onPick,
  mediaBase = '/media',
}: Props) {
  const toast = useToasts();
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState(initial);
  const [folder, setFolder] = useState('all');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  /** When set, the next upload goes into this slot and must satisfy its rule. */
  const [targetSlot, setTargetSlot] = useState<ImageSlot | null>(null);

  const url = (item: MediaItem, thumb = false) =>
    `${mediaBase}/${thumb && item.thumbKey ? item.thumbKey : item.r2Key}`;

  const visible = folder === 'all' ? items : items.filter((item) => item.folder === folder);

  /* ── Upload ───────────────────────────────────────────────────────────── */

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const slot = targetSlot;

      for (const file of Array.from(files)) {
        setUploading(file.name);

        try {
          let prepared = file;

          if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
            const dimensions = await readDimensions(file);

            /**
             * When uploading into a slot with a fixed aspect ratio, centre-crop
             * to it *before* sending. Otherwise the server would reject the
             * upload for failing the dimension rule and the admin would have to
             * go and crop it themselves in another program — which is exactly
             * the friction this panel exists to remove.
             */
            const crop =
              slot?.aspectRatio && dimensions
                ? centerCrop(dimensions.width, dimensions.height, slot.aspectRatio)
                : undefined;

            const maxDimension = slot?.requiredWidth ?? 2000;

            prepared = await processImage(
              file,
              { maxDimension, quality: 0.86, mimeType: 'image/webp' },
              crop,
            );

            // An exact-size slot (like the 1200×630 OG card) needs the final
            // image to land on those pixels, not merely fit within them.
            if (slot?.requiredWidth && slot.requiredHeight) {
              prepared = await resizeExact(prepared, slot.requiredWidth, slot.requiredHeight);
            }
          }

          const form = new FormData();
          form.append('file', prepared);
          form.append('folder', slot ? slot.slug.split('.')[0]! : folder === 'all' ? 'uploads' : folder);
          form.append('alt', '');

          if (file.type === 'application/pdf') form.append('allowDocuments', '1');
          if (slot) form.append('slot', slot.slug);

          const thumbnail = await makeThumbnail(prepared);
          if (thumbnail) form.append('thumbnail', thumbnail);

          const created = await api.upload<MediaItem>('/api/admin/media', form);

          setItems((prev) => [created, ...prev]);
          toast.success(`Uploaded ${created.filename}.`);

          // Alt text is required for WCAG AA — prompt for it immediately rather
          // than letting an image ship without it.
          setEditing(created);
        } catch (cause) {
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : 'Upload failed.',
          );
        } finally {
          setUploading(null);
        }
      }

      setTargetSlot(null);
    },
    [folder, targetSlot, toast],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    try {
      await api.delete(`/api/admin/media/${target.id}`);
      setItems((prev) => prev.filter((item) => item.id !== target.id));
      toast.success('Deleted.');
    } catch {
      toast.error('Could not delete that file.');
    }
  };

  return (
    <>
      {/* ═══ Image slots ══════════════════════════════════════════════════ */}
      {slots.length > 0 && !onPick && (
        <section className="mb-8">
          <h2 className="font-serif text-lg font-semibold">Image slots</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Fixed positions on the site. Uploads are cropped to fit and validated against the
            required dimensions.
          </p>

          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {slots.map((slot) => {
              const assigned = items.find((item) => item.id === slot.mediaId);

              return (
                <li key={slot.slug} className="card overflow-hidden">
                  {assigned ? (
                    <img
                      src={url(assigned, true)}
                      alt={assigned.alt}
                      className="aspect-video w-full bg-surface-2 object-cover"
                    />
                  ) : (
                    <div className="grid aspect-video w-full place-items-center bg-surface-2 text-xs text-ink-subtle">
                      Empty
                    </div>
                  )}

                  <div className="p-4">
                    <p className="text-sm font-medium">{slot.label}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-subtle">{slot.slug}</p>
                    {slot.description && (
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                        {slot.description}
                      </p>
                    )}

                    <button
                      type="button"
                      className="btn btn-secondary mt-3 w-full !text-xs"
                      onClick={() => {
                        setTargetSlot(slot);
                        inputRef.current?.click();
                      }}
                    >
                      {assigned ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ═══ Toolbar ══════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {['all', ...FOLDERS].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFolder(name)}
              aria-pressed={folder === name}
              className="chip transition-colors hover:border-accent hover:text-accent aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-white dark:aria-pressed:text-[#0b0c0f]"
            >
              {name}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setTargetSlot(null);
            inputRef.current?.click();
          }}
          disabled={uploading !== null}
        >
          {uploading ? `Uploading ${uploading}…` : 'Upload files'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
          event.target.value = '';
        }}
      />

      {/* ═══ Drop zone + grid ═════════════════════════════════════════════ */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-5 rounded-2xl border-2 border-dashed p-4 transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-line'
        }`}
      >
        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            Drop files here, or use the upload button.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((item) => (
              <li key={item.id} className="card group overflow-hidden">
                <button
                  type="button"
                  onClick={() => (onPick ? onPick(item) : setEditing(item))}
                  className="block w-full text-left"
                >
                  {item.mimeType === 'application/pdf' ? (
                    <div className="grid aspect-square w-full place-items-center bg-surface-2 text-xs font-medium text-ink-subtle">
                      PDF
                    </div>
                  ) : (
                    <img
                      src={url(item, true)}
                      alt={item.alt}
                      loading="lazy"
                      className="aspect-square w-full bg-surface-2 object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  )}
                </button>

                <div className="p-3">
                  <p className="truncate text-xs font-medium">{item.filename}</p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                    {formatBytes(item.size)}
                  </p>

                  {!item.alt && item.mimeType !== 'application/pdf' && (
                    <div className="mt-1.5">
                      <Pill tone="warning">No alt text</Pill>
                    </div>
                  )}

                  {!onPick && (
                    <div className="mt-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        className="btn btn-ghost flex-1 !px-2 !py-1 !text-xs"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(item)}
                        className="btn btn-ghost !px-2 !py-1 !text-xs text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ═══ Edit modal ═══════════════════════════════════════════════════ */}
      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title="Edit media"
          description="Alt text is required for accessibility."
        >
          <MediaEditor
            item={editing}
            url={url(editing)}
            onSaved={(updated) => {
              setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
              setEditing(null);
              toast.success('Saved.');
            }}
            onError={(message) => toast.error(message)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      <Confirm
        open={deleting !== null}
        title="Delete file"
        message={`“${deleting?.filename}” will be removed from storage. Anything using it (a post cover, an image slot) will simply lose the image — it will not break.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <Toaster toasts={toast.toasts} />
    </>
  );
}

/* ── Exact-size resize for fixed-dimension slots ──────────────────────────── */

async function resizeExact(file: File, width: number, height: number): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Could not read the resized image.'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return file;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  );
  if (!blob) return file;

  return new File([blob], file.name, { type: 'image/webp' });
}

/* ── Alt-text / caption editor ────────────────────────────────────────────── */

function MediaEditor({
  item,
  url,
  onSaved,
  onError,
  onCancel,
}: {
  item: MediaItem;
  url: string;
  onSaved: (item: MediaItem) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const [alt, setAlt] = useState(item.alt);
  const [caption, setCaption] = useState(item.caption ?? '');
  const [folder, setFolder] = useState(item.folder);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.patch<MediaItem>(`/api/admin/media/${item.id}`, {
        alt,
        caption: caption || null,
        folder,
      });
      onSaved(updated);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {item.mimeType !== 'application/pdf' && (
        <img
          src={url}
          alt={alt}
          className="max-h-64 w-full rounded-lg border border-line bg-surface-2 object-contain"
        />
      )}

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Dimensions</dt>
          <dd className="mt-0.5 font-mono">
            {item.width && item.height ? `${item.width}×${item.height}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Size</dt>
          <dd className="mt-0.5 font-mono">{formatBytes(item.size)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Type</dt>
          <dd className="mt-0.5 font-mono">{item.mimeType}</dd>
        </div>
      </dl>

      <Field
        label="Alt text"
        htmlFor="media-alt"
        required={item.mimeType !== 'application/pdf'}
        hint="Describe what the image shows. Leave empty only if it is purely decorative."
      >
        <input
          id="media-alt"
          type="text"
          className="input"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          autoFocus
        />
      </Field>

      <Field label="Caption" htmlFor="media-caption" hint="Shown below the image where supported.">
        <input
          id="media-caption"
          type="text"
          className="input"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
      </Field>

      <Field label="Folder" htmlFor="media-folder">
        <select
          id="media-folder"
          className="input"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        >
          {FOLDERS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
