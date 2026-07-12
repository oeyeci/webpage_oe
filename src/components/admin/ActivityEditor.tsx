import { useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Field, Modal, Toaster, Toggle, useToasts } from './ui';
import MediaManager, { type MediaItem } from './MediaManager';

export interface ActivityFormValues {
  id?: number;
  title: string;
  slug: string;
  activityDate: string;
  endDate: string;
  location: string;
  categoryId: number | null;
  excerpt: string;
  descriptionMd: string;
  coverMediaId: number | null;
  galleryMediaIds: number[];
  url: string;
  isFeatured: boolean;
  isPublished: boolean;
}

interface Props {
  initial: ActivityFormValues;
  categories: Array<{ id: number; name: string }>;
  media: MediaItem[];
  mediaBase: string;
}

export default function ActivityEditor({ initial, categories, media, mediaBase }: Props) {
  const toast = useToasts();

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState<'cover' | 'gallery' | null>(null);

  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) setErrors((prev) => ({ ...prev, [key as string]: [] }));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});

    try {
      const body = {
        ...form,
        slug: form.slug || null,
        endDate: form.endDate || null,
        location: form.location || null,
        excerpt: form.excerpt || null,
        url: form.url || null,
      };

      const saved = form.id
        ? await api.put<{ id: number }>(`/api/admin/activities/${form.id}`, body)
        : await api.post<{ id: number }>('/api/admin/activities', body);

      toast.success(form.id ? 'Saved.' : 'Activity created.');

      if (!form.id) {
        window.location.href = `/admin/activities/${saved.id}`;
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.details);
        toast.error(
          Object.keys(cause.details).length > 0 ? 'Some fields need attention.' : cause.message,
        );
      } else {
        toast.error('Could not save.');
      }
    } finally {
      setSaving(false);
    }
  };

  const mediaUrl = (item: MediaItem, thumb = true) =>
    `${mediaBase}/${thumb && item.thumbKey ? item.thumbKey : item.r2Key}`;

  const cover = media.find((item) => item.id === form.coverMediaId);
  const gallery = form.galleryMediaIds
    .map((id) => media.find((item) => item.id === id))
    .filter((item): item is MediaItem => Boolean(item));

  const onPick = (item: MediaItem) => {
    if (pickerFor === 'cover') {
      set('coverMediaId', item.id);
    } else if (pickerFor === 'gallery' && !form.galleryMediaIds.includes(item.id)) {
      set('galleryMediaIds', [...form.galleryMediaIds, item.id]);
    }
    setPickerFor(null);
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <Field label="Title" htmlFor="title" error={errors.title?.[0]} required>
            <input
              id="title"
              type="text"
              className="input !text-lg"
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Date"
              htmlFor="activityDate"
              error={errors.activityDate?.[0]}
              required
              hint="YYYY-MM-DD"
            >
              <input
                id="activityDate"
                type="date"
                className="input"
                value={form.activityDate}
                onChange={(event) => set('activityDate', event.target.value)}
              />
            </Field>

            <Field
              label="End date"
              htmlFor="endDate"
              error={errors.endDate?.[0]}
              hint="For multi-day events."
            >
              <input
                id="endDate"
                type="date"
                className="input"
                value={form.endDate}
                onChange={(event) => set('endDate', event.target.value)}
              />
            </Field>

            <Field label="Location" htmlFor="location" error={errors.location?.[0]}>
              <input
                id="location"
                type="text"
                className="input"
                placeholder="Bologna, Italy"
                value={form.location}
                onChange={(event) => set('location', event.target.value)}
              />
            </Field>

            <Field label="Category" htmlFor="categoryId">
              <select
                id="categoryId"
                className="input"
                value={form.categoryId ?? ''}
                onChange={(event) =>
                  set('categoryId', event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Description"
            htmlFor="descriptionMd"
            error={errors.descriptionMd?.[0]}
            hint="Markdown — rendered to HTML on save."
          >
            <textarea
              id="descriptionMd"
              rows={14}
              className="input resize-y font-mono !text-sm"
              value={form.descriptionMd}
              onChange={(event) => set('descriptionMd', event.target.value)}
            />
          </Field>

          <Field
            label="Excerpt"
            htmlFor="excerpt"
            error={errors.excerpt?.[0]}
            hint="Shown on cards. Derived from the description if left empty."
          >
            <textarea
              id="excerpt"
              rows={2}
              className="input resize-y"
              value={form.excerpt}
              onChange={(event) => set('excerpt', event.target.value)}
            />
          </Field>

          <Field
            label="Event link"
            htmlFor="url"
            error={errors.url?.[0]}
            hint="The conference or event page."
          >
            <input
              id="url"
              type="url"
              className="input"
              value={form.url}
              onChange={(event) => set('url', event.target.value)}
            />
          </Field>
        </div>

        {/* ═══ Sidebar ══════════════════════════════════════════════════ */}
        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold">Publish</h2>

            <div className="mt-4 space-y-3">
              <Toggle
                checked={form.isPublished}
                onChange={(value) => set('isPublished', value)}
                label="Visible on the site"
              />
              <Toggle
                checked={form.isFeatured}
                onChange={(value) => set('isFeatured', value)}
                label="Featured"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary mt-5 w-full"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create activity'}
            </button>

            {form.id && form.slug && (
              <a
                href={`/activities/${form.slug}`}
                target="_blank"
                rel="noopener"
                className="btn btn-ghost mt-2 w-full"
              >
                View activity
              </a>
            )}
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold">Cover image</h2>

            {cover ? (
              <div className="mt-3">
                <img
                  src={mediaUrl(cover)}
                  alt={cover.alt}
                  className="aspect-video w-full rounded-lg border border-line object-cover"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary flex-1 !text-xs"
                    onClick={() => setPickerFor('cover')}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !text-xs text-danger"
                    onClick={() => set('coverMediaId', null)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary mt-3 w-full"
                onClick={() => setPickerFor('cover')}
              >
                Choose an image
              </button>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Gallery</h2>
              <button
                type="button"
                className="btn btn-ghost !px-2 !py-1 !text-xs"
                onClick={() => setPickerFor('gallery')}
              >
                Add
              </button>
            </div>

            {gallery.length === 0 ? (
              <p className="mt-3 text-xs text-ink-subtle">Optional photo gallery.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-3 gap-2">
                {gallery.map((item) => (
                  <li key={item.id} className="group relative">
                    <img
                      src={mediaUrl(item)}
                      alt={item.alt}
                      className="aspect-square w-full rounded-md border border-line object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          'galleryMediaIds',
                          form.galleryMediaIds.filter((id) => id !== item.id),
                        )
                      }
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-danger text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove ${item.filename}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <Modal
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title="Choose media"
        size="xl"
      >
        <MediaManager initial={media} onPick={onPick} mediaBase={mediaBase} />
      </Modal>

      <Toaster toasts={toast.toasts} />
    </>
  );
}
