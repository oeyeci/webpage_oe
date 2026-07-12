import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Field, Modal, Pill, Toaster, Toggle, useToasts } from './ui';
import MediaManager, { type MediaItem } from './MediaManager';

/**
 * Blog post editor.
 *
 * The preview is rendered by the **server**, through the same
 * unified/remark/rehype pipeline that runs on save. That costs a round trip per
 * keystroke-burst, and it is worth it: a preview rendered by a *different*
 * markdown engine is a preview that lies — different footnote handling,
 * different LaTeX, different syntax highlighting. It would also mean shipping
 * remark, KaTeX and Shiki to the browser.
 */

export interface PostFormValues {
  id?: number;
  title: string;
  slug: string;
  excerpt: string;
  contentMd: string;
  coverMediaId: number | null;
  categoryId: number | null;
  status: 'draft' | 'scheduled' | 'published';
  scheduledFor: string | null;
  isFeatured: boolean;
  showToc: boolean;
  tags: string[];
  galleryMediaIds: number[];
  seoTitle: string;
  seoDescription: string;
}

interface Category {
  id: number;
  name: string;
}

interface Props {
  initial: PostFormValues;
  categories: Category[];
  media: MediaItem[];
  mediaBase: string;
}

interface Preview {
  html: string;
  toc: Array<{ depth: number; id: string; text: string }>;
  readingMinutes: number;
}

const EDITOR_HELP = `# Heading

**Bold**, *italic*, [a link](https://example.com), \`inline code\`.

Inline maths: $E = mc^2$ — display maths:

$$
\\hat{H}\\,\\psi = E\\,\\psi
$$

\`\`\`python
def hello():
    return "syntax highlighted"
\`\`\`

| Column | Column |
| ------ | ------ |
| Cell   | Cell   |

A footnote[^1].

[^1]: The footnote text.

<iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
        title="A video" allowfullscreen></iframe>
`;

export default function PostEditor({ initial, categories, media, mediaBase }: Props) {
  const toast = useToasts();

  const [form, setForm] = useState<PostFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const [pickerFor, setPickerFor] = useState<'cover' | 'gallery' | 'inline' | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const set = <K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    if (errors[key as string]) {
      setErrors((prev) => ({ ...prev, [key as string]: [] }));
    }
  };

  /* ── Live preview (debounced) ─────────────────────────────────────────── */

  const renderPreview = useCallback(async (markdown: string) => {
    if (!markdown.trim()) {
      setPreview({ html: '', toc: [], readingMinutes: 0 });
      return;
    }

    setPreviewing(true);
    try {
      setPreview(await api.post<Preview>('/api/admin/preview', { markdown }));
    } catch {
      // A failed preview must not interrupt writing.
    } finally {
      setPreviewing(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'preview') return;

    const timer = setTimeout(() => void renderPreview(form.contentMd), 400);
    return () => clearTimeout(timer);
  }, [form.contentMd, tab, renderPreview]);

  /* ── Warn before losing unsaved work ──────────────────────────────────── */

  useEffect(() => {
    if (!dirty) return;

    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ── Save ─────────────────────────────────────────────────────────────── */

  const save = async (status?: PostFormValues['status']) => {
    const payload = { ...form, status: status ?? form.status };

    setSaving(true);
    setErrors({});

    try {
      const body = {
        ...payload,
        slug: payload.slug || null,
        excerpt: payload.excerpt || null,
        seoTitle: payload.seoTitle || null,
        seoDescription: payload.seoDescription || null,
        scheduledFor: payload.status === 'scheduled' ? payload.scheduledFor : null,
      };

      const saved = form.id
        ? await api.put<{ id: number; slug: string }>(`/api/admin/blog/${form.id}`, body)
        : await api.post<{ id: number; slug: string }>('/api/admin/blog', body);

      setDirty(false);
      toast.success(
        payload.status === 'published'
          ? 'Published.'
          : payload.status === 'scheduled'
            ? 'Scheduled.'
            : 'Draft saved.',
      );

      if (!form.id) {
        // Move to the post's own URL so a refresh does not create a duplicate.
        window.location.href = `/admin/blog/${saved.id}`;
        return;
      }

      setForm((prev) => ({ ...prev, status: payload.status, slug: saved.slug }));
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.details);
        toast.error(
          Object.keys(cause.details).length > 0
            ? 'Some fields need attention.'
            : cause.message,
        );
      } else {
        toast.error('Could not save.');
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Markdown helpers ─────────────────────────────────────────────────── */

  /** Inserts text at the caret, preserving undo history where the browser allows. */
  const insertAtCaret = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      set('contentMd', form.contentMd + snippet);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = form.contentMd.slice(0, start) + snippet + form.contentMd.slice(end);

    set('contentMd', next);

    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + snippet.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '');
    if (!tag || form.tags.includes(tag) || form.tags.length >= 20) return;
    set('tags', [...form.tags, tag]);
    setTagInput('');
  };

  const cover = media.find((item) => item.id === form.coverMediaId);
  const gallery = form.galleryMediaIds
    .map((id) => media.find((item) => item.id === id))
    .filter((item): item is MediaItem => Boolean(item));

  const mediaUrl = (item: MediaItem, thumb = true) =>
    `${mediaBase}/${thumb && item.thumbKey ? item.thumbKey : item.r2Key}`;

  /* ── Picker ───────────────────────────────────────────────────────────── */

  const onPick = (item: MediaItem) => {
    if (pickerFor === 'cover') {
      set('coverMediaId', item.id);
    } else if (pickerFor === 'gallery') {
      if (!form.galleryMediaIds.includes(item.id)) {
        set('galleryMediaIds', [...form.galleryMediaIds, item.id]);
      }
    } else if (pickerFor === 'inline') {
      insertAtCaret(`\n![${item.alt || item.filename}](${mediaUrl(item, false)})\n`);
    }
    setPickerFor(null);
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        {/* ═══ Main column ══════════════════════════════════════════════ */}
        <div className="min-w-0 space-y-4">
          <Field label="Title" htmlFor="title" error={errors.title?.[0]} required>
            <input
              id="title"
              type="text"
              className="input !text-lg"
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              placeholder="A clear, specific title"
            />
          </Field>

          {/* ── Editor tabs ─────────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2">
              <div role="tablist" className="flex gap-1">
                {(['write', 'preview'] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    onClick={() => setTab(name)}
                    className="rounded-md px-3 py-1.5 text-sm capitalize transition-colors aria-selected:bg-surface aria-selected:font-medium aria-selected:shadow-soft"
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {previewing && <span className="text-xs text-ink-subtle">Rendering…</span>}
                <button
                  type="button"
                  onClick={() => setPickerFor('inline')}
                  className="btn btn-ghost !px-2 !py-1 !text-xs"
                >
                  Insert image
                </button>
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="btn btn-ghost !px-2 !py-1 !text-xs"
                >
                  Syntax
                </button>
              </div>
            </div>

            {tab === 'write' ? (
              <textarea
                ref={textareaRef}
                value={form.contentMd}
                onChange={(event) => set('contentMd', event.target.value)}
                onKeyDown={(event) => {
                  // Tab should indent code, not escape the editor.
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    insertAtCaret('  ');
                  }
                }}
                rows={26}
                spellCheck
                placeholder="Write in Markdown. LaTeX ($…$), code fences, tables, footnotes and raw HTML all work."
                className="w-full resize-y border-0 bg-transparent p-5 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-ink-subtle"
              />
            ) : (
              <div className="p-5">
                {preview?.html ? (
                  <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
                ) : (
                  <p className="py-16 text-center text-sm text-ink-subtle">
                    Nothing to preview yet.
                  </p>
                )}
              </div>
            )}
          </div>

          {preview && tab === 'preview' && (
            <p className="text-xs text-ink-subtle">
              {preview.readingMinutes} min read · {preview.toc.length} headings
            </p>
          )}

          <Field
            label="Excerpt"
            htmlFor="excerpt"
            error={errors.excerpt?.[0]}
            hint="Shown on cards and in search results. Left empty, it is derived from the first paragraph."
          >
            <textarea
              id="excerpt"
              rows={2}
              className="input resize-y"
              value={form.excerpt}
              onChange={(event) => set('excerpt', event.target.value)}
            />
          </Field>

          {/* ── SEO ─────────────────────────────────────────────────── */}
          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-medium">SEO overrides</summary>
            <div className="mt-4 space-y-4">
              <Field
                label="SEO title"
                htmlFor="seoTitle"
                hint="Defaults to the post title."
                error={errors.seoTitle?.[0]}
              >
                <input
                  id="seoTitle"
                  type="text"
                  className="input"
                  value={form.seoTitle}
                  onChange={(event) => set('seoTitle', event.target.value)}
                />
              </Field>

              <Field
                label="Meta description"
                htmlFor="seoDescription"
                hint="Defaults to the excerpt. Aim for under 158 characters."
                error={errors.seoDescription?.[0]}
              >
                <textarea
                  id="seoDescription"
                  rows={2}
                  className="input resize-y"
                  value={form.seoDescription}
                  onChange={(event) => set('seoDescription', event.target.value)}
                />
              </Field>

              <Field
                label="Slug"
                htmlFor="slug"
                hint="Derived from the title if left empty. Changing it breaks existing links."
                error={errors.slug?.[0]}
              >
                <input
                  id="slug"
                  type="text"
                  className="input font-mono !text-sm"
                  value={form.slug}
                  onChange={(event) => set('slug', event.target.value)}
                />
              </Field>
            </div>
          </details>
        </div>

        {/* ═══ Sidebar ══════════════════════════════════════════════════ */}
        <aside className="space-y-4">
          {/* ── Publish ─────────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Publish</h2>
              <Pill
                tone={
                  form.status === 'published'
                    ? 'success'
                    : form.status === 'scheduled'
                      ? 'accent'
                      : 'neutral'
                }
              >
                {form.status}
              </Pill>
            </div>

            <Field label="Status" htmlFor="status" className="mt-4">
              <select
                id="status"
                className="input"
                value={form.status}
                onChange={(event) =>
                  set('status', event.target.value as PostFormValues['status'])
                }
              >
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
              </select>
            </Field>

            {form.status === 'scheduled' && (
              <Field
                label="Publish at"
                htmlFor="scheduledFor"
                className="mt-4"
                error={errors.scheduledFor?.[0]}
                hint="The post goes live on its own at this time — no background job required."
                required
              >
                <input
                  id="scheduledFor"
                  type="datetime-local"
                  className="input"
                  value={form.scheduledFor ? form.scheduledFor.slice(0, 16) : ''}
                  onChange={(event) =>
                    set(
                      'scheduledFor',
                      event.target.value ? new Date(event.target.value).toISOString() : null,
                    )
                  }
                />
              </Field>
            )}

            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <Toggle
                checked={form.isFeatured}
                onChange={(value) => set('isFeatured', value)}
                label="Featured"
              />
              <Toggle
                checked={form.showToc}
                onChange={(value) => set('showToc', value)}
                label="Table of contents"
              />
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => save()}
                disabled={saving}
              >
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create post'}
              </button>

              {form.status !== 'published' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => save('published')}
                  disabled={saving}
                >
                  Publish now
                </button>
              )}

              {form.id && (
                <a
                  href={`/blog/${form.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="btn btn-ghost"
                >
                  {form.status === 'published' ? 'View post' : 'Preview draft'}
                </a>
              )}
            </div>
          </div>

          {/* ── Category & tags ─────────────────────────────────────── */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold">Organisation</h2>

            <Field label="Category" htmlFor="categoryId" className="mt-4">
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

            <Field label="Tags" htmlFor="tags" className="mt-4" hint="Press Enter to add.">
              <input
                id="tags"
                type="text"
                className="input"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addTag(tagInput);
                  }
                  if (event.key === 'Backspace' && !tagInput && form.tags.length > 0) {
                    set('tags', form.tags.slice(0, -1));
                  }
                }}
                onBlur={() => addTag(tagInput)}
              />
            </Field>

            {form.tags.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {form.tags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      onClick={() => set('tags', form.tags.filter((t) => t !== tag))}
                      className="chip transition-colors hover:border-danger hover:text-danger"
                    >
                      {tag}
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove tag {tag}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Cover ───────────────────────────────────────────────── */}
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

          {/* ── Gallery ─────────────────────────────────────────────── */}
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
              <p className="mt-3 text-xs text-ink-subtle">Optional. Shown below the article.</p>
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
                      aria-label={`Remove ${item.filename} from the gallery`}
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

      {/* ═══ Media picker ═════════════════════════════════════════════ */}
      <Modal
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        title="Choose media"
        description="Click a file to select it. New uploads appear here immediately."
        size="xl"
      >
        <MediaManager initial={media} onPick={onPick} mediaBase={mediaBase} />
      </Modal>

      {/* ═══ Syntax help ══════════════════════════════════════════════ */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Markdown syntax"
        description="Markdown, GitHub extensions, LaTeX, code fences and raw HTML are all supported."
      >
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-relaxed">
          {EDITOR_HELP}
        </pre>
        <p className="mt-4 text-sm text-ink-muted">
          Equations are rendered with KaTeX, code with Shiki, both at save time — so the published
          page ships zero JavaScript for either.
        </p>
      </Modal>

      <Toaster toasts={toast.toasts} />
    </>
  );
}
