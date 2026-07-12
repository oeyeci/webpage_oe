import { useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Confirm, Field, Modal, Pill, Toaster, Toggle, useToasts } from './ui';

/**
 * Publications manager.
 *
 * The entire "add a publication" workflow is: paste BibTeX, press import. There
 * is no form with 30 fields, because BibTeX *is* the form — and the publisher
 * already filled it in. Everything else on this screen edits the things BibTeX
 * has no field for: featured status, citation count, and links to the PDF, code
 * or slides.
 */

interface Publication {
  id: number;
  citeKey: string;
  category: string;
  entryType: string;
  title: string;
  authorsRaw: string;
  journal: string | null;
  booktitle: string | null;
  year: number;
  doi: string | null;
  pdfUrl: string | null;
  codeUrl: string | null;
  projectUrl: string | null;
  slidesUrl: string | null;
  citationCount: number;
  isFeatured: boolean;
  isPublished: boolean;
  ieeeCitation: string;
}

interface ImportOutcome {
  status: 'created' | 'updated' | 'skipped';
  citeKey: string;
  reason?: string;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  outcomes: ImportOutcome[];
  errors: string[];
  warnings: string[];
}

const CATEGORIES = [
  'all',
  'journal',
  'conference',
  'book',
  'chapter',
  'patent',
  'preprint',
  'thesis',
] as const;

interface Props {
  initial: Publication[];
}

export default function PublicationsManager({ initial }: Props) {
  const toast = useToasts();

  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');

  const [importOpen, setImportOpen] = useState(false);
  const [bibtex, setBibtex] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [editing, setEditing] = useState<Publication | null>(null);
  const [deleting, setDeleting] = useState<Publication | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      return `${item.title} ${item.authorsRaw} ${item.journal ?? ''} ${item.booktitle ?? ''} ${item.citeKey}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, category]);

  const refresh = async () => {
    setItems(await api.get<Publication[]>('/api/admin/publications'));
  };

  /* ── Import ───────────────────────────────────────────────────────────── */

  const runImport = async () => {
    setImporting(true);
    setResult(null);

    try {
      const outcome = await api.post<ImportResult>('/api/admin/publications', {
        bibtex,
        overwrite,
      });

      setResult(outcome);
      await refresh();

      if (outcome.created + outcome.updated > 0) {
        toast.success(
          `Imported ${outcome.created} new and updated ${outcome.updated} publication${
            outcome.updated === 1 ? '' : 's'
          }.`,
        );
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        // Parse errors come back as field details so they can be listed.
        setResult({
          created: 0,
          updated: 0,
          skipped: 0,
          outcomes: [],
          errors: cause.details.bibtex ?? [cause.message],
          warnings: [],
        });
      } else {
        toast.error('Import failed.');
      }
    } finally {
      setImporting(false);
    }
  };

  const closeImport = () => {
    setImportOpen(false);
    setBibtex('');
    setResult(null);
    setOverwrite(false);
  };

  /* ── Inline edits ─────────────────────────────────────────────────────── */

  const patch = async (item: Publication, changes: Partial<Publication>) => {
    // Optimistic: a toggle that waits for a round trip feels broken.
    const previous = items;
    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...changes } : p)));

    try {
      await api.patch(`/api/admin/publications/${item.id}`, changes);
    } catch (cause) {
      setItems(previous);
      toast.error(cause instanceof ApiError ? cause.message : 'Could not save.');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    try {
      await api.delete(`/api/admin/publications/${target.id}`);
      setItems((prev) => prev.filter((p) => p.id !== target.id));
      toast.success(`Deleted “${target.title}”.`);
    } catch {
      toast.error('Could not delete that publication.');
    }
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: items.length };
    for (const item of items) map[item.category] = (map[item.category] ?? 0) + 1;
    return map;
  }, [items]);

  return (
    <>
      {/* ═══ Toolbar ══════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, author, venue or key…"
            className="input !py-2 !text-sm lg:max-w-xs"
            aria-label="Search publications"
          />

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="input !w-auto !py-2 !text-sm"
            aria-label="Filter by type"
          >
            {CATEGORIES.filter((c) => c === 'all' || counts[c]).map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All types' : c[0]!.toUpperCase() + c.slice(1)} ({counts[c] ?? 0})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <a href="/publications.bib" download className="btn btn-secondary">
            Export .bib
          </a>
          <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>
            Import BibTeX
          </button>
        </div>
      </div>

      <p className="mt-3 text-sm text-ink-subtle">
        Showing {filtered.length} of {items.length} publications
      </p>

      {/* ═══ List ═════════════════════════════════════════════════════════ */}
      <ul className="mt-4 space-y-2">
        {filtered.map((item) => (
          <li key={item.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="accent">{item.category}</Pill>
                  <span className="font-mono text-xs text-ink-subtle">{item.year}</span>
                  {item.isFeatured && <Pill tone="success">Selected</Pill>}
                  {!item.isPublished && <Pill tone="warning">Hidden</Pill>}
                  {item.citationCount > 0 && (
                    <Pill>{item.citationCount} citations</Pill>
                  )}
                </div>

                <h3 className="mt-2 text-[0.9375rem] font-semibold leading-snug">{item.title}</h3>
                <p className="mt-1 truncate text-sm text-ink-muted">{item.authorsRaw}</p>
                <p className="truncate text-xs italic text-ink-subtle">
                  {item.journal ?? item.booktitle ?? '—'}
                </p>
                <p className="mt-1 font-mono text-xs text-ink-subtle">{item.citeKey}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => patch(item, { isFeatured: !item.isFeatured })}
                  className="btn btn-ghost !px-2 !text-xs"
                  aria-pressed={item.isFeatured}
                >
                  {item.isFeatured ? 'Unfeature' : 'Feature'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  className="btn btn-secondary !px-3 !text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(item)}
                  className="btn btn-danger !px-3 !text-xs"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}

        {filtered.length === 0 && (
          <li className="card py-16 text-center text-sm text-ink-muted">
            No publications match your filters.
          </li>
        )}
      </ul>

      {/* ═══ Import modal ═════════════════════════════════════════════════ */}
      <Modal
        open={importOpen}
        onClose={closeImport}
        title="Import BibTeX"
        description="Paste one entry or a hundred. Everything else is derived automatically."
        size="xl"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeImport}>
              {result ? 'Done' : 'Cancel'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runImport}
              disabled={importing || bibtex.trim().length < 10}
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-muted">
            The importer parses the BibTeX, decodes LaTeX escapes (
            <code className="font-mono">{'Eyecio{\\u{g}}lu'}</code> → Eyecioğlu), deduplicates
            authors, classifies the entry type, and generates the IEEE citation. The original
            BibTeX is stored verbatim so downloads round-trip exactly.
          </div>

          <Field label="BibTeX" htmlFor="bibtex-input" required>
            <textarea
              id="bibtex-input"
              value={bibtex}
              onChange={(event) => setBibtex(event.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={
                '@article{eyecioglu2026qlid,\n  author  = {Eyecio{\\u{g}}lu, {\\"O}nder},\n  title   = {A Hybrid Quantum-Classical Network},\n  journal = {IEEE Access},\n  year    = {2026},\n  doi     = {10.1109/ACCESS.2026.3668295}\n}'
              }
              className="input resize-y font-mono !text-xs"
            />
          </Field>

          <Toggle
            checked={overwrite}
            onChange={setOverwrite}
            label="Overwrite existing entries"
            hint="When a citation key already exists, replace it instead of skipping it."
          />

          {/* ── Result ─────────────────────────────────────────────────── */}
          {result && (
            <div className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap gap-2">
                {result.created > 0 && <Pill tone="success">{result.created} created</Pill>}
                {result.updated > 0 && <Pill tone="accent">{result.updated} updated</Pill>}
                {result.skipped > 0 && <Pill tone="warning">{result.skipped} skipped</Pill>}
                {result.errors.length > 0 && (
                  <Pill tone="danger">{result.errors.length} failed</Pill>
                )}
              </div>

              {result.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-danger">
                  {result.errors.map((error) => (
                    <li key={error}>• {error}</li>
                  ))}
                </ul>
              )}

              {result.warnings.length > 0 && (
                <ul className="space-y-1 text-xs text-warning">
                  {result.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              )}

              {result.skipped > 0 && (
                <p className="text-xs text-ink-subtle">
                  Skipped entries already exist. Tick “Overwrite existing entries” to replace them.
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ═══ Edit modal ═══════════════════════════════════════════════════ */}
      {editing && (
        <EditModal
          publication={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditing(null);
            toast.success('Saved.');
          }}
          onError={(message) => toast.error(message)}
        />
      )}

      <Confirm
        open={deleting !== null}
        title="Delete publication"
        message={`“${deleting?.title}” will be permanently removed, along with its author links. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <Toaster toasts={toast.toasts} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Edit modal — only the fields BibTeX cannot express
 * ═══════════════════════════════════════════════════════════════════════════ */

function EditModal({
  publication,
  onClose,
  onSaved,
  onError,
}: {
  publication: Publication;
  onClose: () => void;
  onSaved: (updated: Publication) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    citationCount: publication.citationCount,
    pdfUrl: publication.pdfUrl ?? '',
    codeUrl: publication.codeUrl ?? '',
    projectUrl: publication.projectUrl ?? '',
    slidesUrl: publication.slidesUrl ?? '',
    isFeatured: publication.isFeatured,
    isPublished: publication.isPublished,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setErrors({});

    try {
      const updated = await api.patch<Publication>(
        `/api/admin/publications/${publication.id}`,
        {
          ...form,
          pdfUrl: form.pdfUrl || null,
          codeUrl: form.codeUrl || null,
          projectUrl: form.projectUrl || null,
          slidesUrl: form.slidesUrl || null,
        },
      );
      onSaved(updated);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.details);
        if (Object.keys(cause.details).length === 0) onError(cause.message);
      } else {
        onError('Could not save.');
      }
      setSaving(false);
    }
  };

  const urlField = (
    key: 'pdfUrl' | 'codeUrl' | 'projectUrl' | 'slidesUrl',
    label: string,
  ) => (
    <Field label={label} htmlFor={key} error={errors[key]?.[0]}>
      <input
        id={key}
        type="url"
        className="input"
        value={form[key]}
        placeholder="https://…"
        onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
      />
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit publication"
      description="Bibliographic fields come from the stored BibTeX. Re-import to change them."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-sm font-medium leading-snug">{publication.title}</p>
          <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-muted">
            {publication.ieeeCitation}
          </p>
        </div>

        <Field
          label="Citation count"
          htmlFor="citationCount"
          error={errors.citationCount?.[0]}
          hint="Shown as a Google-Scholar-style badge. Update it manually — Scholar has no public API."
        >
          <input
            id="citationCount"
            type="number"
            min={0}
            className="input"
            value={form.citationCount}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, citationCount: Number(event.target.value) }))
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {urlField('pdfUrl', 'PDF link')}
          {urlField('codeUrl', 'Code repository')}
          {urlField('projectUrl', 'Project page')}
          {urlField('slidesUrl', 'Slides')}
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <Toggle
            checked={form.isFeatured}
            onChange={(value) => setForm((prev) => ({ ...prev, isFeatured: value }))}
            label="Selected work"
            hint="Featured on the home page."
          />
          <Toggle
            checked={form.isPublished}
            onChange={(value) => setForm((prev) => ({ ...prev, isPublished: value }))}
            label="Visible on the public site"
          />
        </div>
      </div>
    </Modal>
  );
}
