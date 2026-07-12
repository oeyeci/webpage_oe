import { useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Confirm, Field, Modal, Pill, Toaster, Toggle, useToasts } from './ui';

/**
 * A schema-driven CRUD manager.
 *
 * The eleven simple content types (positions, projects, theses, skills, awards,
 * categories…) differ only in their *fields*, not their behaviour. Rather than
 * eleven near-identical screens that drift apart, each one declares its fields
 * and this component renders the list, the form, the validation errors and the
 * delete confirmation.
 *
 * The moment a type needs real behaviour — publications (BibTeX), posts
 * (markdown, scheduling), media (R2) — it gets a purpose-built screen instead.
 * This abstraction is for the cases where it genuinely is just a form.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'number'
  | 'year'
  | 'select'
  | 'date'
  | 'toggle'
  | 'url';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string | number; label: string }>;
  /** Full-width in the two-column form grid. */
  wide?: boolean;
  defaultValue?: unknown;
}

export interface ResourceConfig {
  /** URL segment, e.g. "experiences" → /api/admin/experiences */
  resource: string;
  /** Singular noun used in buttons and dialogs. */
  singular: string;
  fields: FieldDef[];
  /** Row key used as the list item's heading. */
  titleKey: string;
  /** Row key used as the list item's subheading. */
  subtitleKey?: string;
  /** Row keys rendered as small pills on the list item. */
  badgeKeys?: string[];
  /** Row key holding a date/period, shown on the right. */
  metaKey?: string;
}

type Row = Record<string, unknown> & { id: number };

interface Props {
  config: ResourceConfig;
  initial: Row[];
}

function blankRow(fields: FieldDef[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      row[field.key] = field.defaultValue;
      continue;
    }
    row[field.key] =
      field.type === 'toggle'
        ? false
        : field.type === 'number' || field.type === 'year'
          ? null
          : field.type === 'select'
            ? (field.options?.[0]?.value ?? '')
            : '';
  }

  return row;
}

export default function ResourceManager({ config, initial }: Props) {
  const toast = useToasts();

  const [rows, setRows] = useState<Row[]>(initial);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) =>
      Object.values(row).some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
      ),
    );
  }, [rows, query]);

  const save = async (values: Record<string, unknown>) => {
    const id = values.id as number | undefined;

    // Send only the declared fields — the row we loaded also carries
    // server-owned columns (createdAt, renderedHtml) that must not round-trip.
    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      const value = values[field.key];
      payload[field.key] =
        value === '' && field.type !== 'text' && field.type !== 'textarea' && field.type !== 'markdown'
          ? null
          : value;
    }

    if (id) {
      const updated = await api.patch<Row>(`/api/admin/${config.resource}/${id}`, payload);
      setRows((prev) => prev.map((row) => (row.id === id ? updated : row)));
      toast.success('Saved.');
    } else {
      const created = await api.post<Row>(`/api/admin/${config.resource}`, payload);
      setRows((prev) => [created, ...prev]);
      toast.success(`${config.singular} created.`);
    }

    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    try {
      await api.delete(`/api/admin/${config.resource}/${target.id}`);
      setRows((prev) => prev.filter((row) => row.id !== target.id));
      toast.success('Deleted.');
    } catch {
      toast.error(`Could not delete that ${config.singular.toLowerCase()}.`);
    }
  };

  const text = (row: Row, key: string | undefined): string => {
    if (!key) return '';
    const value = row[key];
    return value == null ? '' : String(value);
  };

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${config.resource}…`}
          className="input !py-2 !text-sm sm:max-w-xs"
          aria-label={`Search ${config.resource}`}
        />

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setEditing(blankRow(config.fields))}
        >
          Add {config.singular.toLowerCase()}
        </button>
      </div>

      <ul className="mt-5 space-y-2">
        {visible.map((row) => (
          <li key={row.id} className="card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              {config.badgeKeys && config.badgeKeys.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {config.badgeKeys.map((key) => {
                    const value = row[key];
                    if (value == null || value === '' || value === false) return null;
                    return (
                      <Pill key={key} tone={value === true ? 'accent' : 'neutral'}>
                        {value === true ? key.replace(/^is/, '').toLowerCase() : String(value)}
                      </Pill>
                    );
                  })}
                </div>
              )}

              <h3 className="truncate font-medium">{text(row, config.titleKey) || '—'}</h3>

              {config.subtitleKey && text(row, config.subtitleKey) && (
                <p className="mt-0.5 truncate text-sm text-ink-muted">
                  {text(row, config.subtitleKey)}
                </p>
              )}
            </div>

            {config.metaKey && (
              <span className="shrink-0 font-mono text-xs text-ink-subtle">
                {text(row, config.metaKey) || '—'}
              </span>
            )}

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setEditing({ ...row })}
                className="btn btn-secondary !px-3 !text-xs"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDeleting(row)}
                className="btn btn-danger !px-3 !text-xs"
              >
                Delete
              </button>
            </div>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="card py-16 text-center text-sm text-ink-muted">
            {rows.length === 0
              ? `No ${config.resource} yet.`
              : `No ${config.resource} match your search.`}
          </li>
        )}
      </ul>

      {editing && (
        <ResourceForm
          config={config}
          values={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
          onError={(message) => toast.error(message)}
        />
      )}

      <Confirm
        open={deleting !== null}
        title={`Delete ${config.singular.toLowerCase()}`}
        message={`“${deleting ? text(deleting, config.titleKey) : ''}” will be permanently removed. This cannot be undone.`}
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
 * Form
 * ═══════════════════════════════════════════════════════════════════════════ */

function ResourceForm({
  config,
  values: initialValues,
  onSave,
  onCancel,
  onError,
}: {
  config: ResourceConfig;
  values: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const isNew = values.id === undefined;

  const set = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: [] }));
  };

  const submit = async () => {
    setSaving(true);
    setErrors({});

    try {
      await onSave(values);
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

  const renderField = (field: FieldDef) => {
    const id = `field-${field.key}`;
    const value = values[field.key];
    const error = errors[field.key]?.[0];

    if (field.type === 'toggle') {
      return (
        <div key={field.key} className={field.wide ? 'sm:col-span-2' : undefined}>
          <Toggle
            checked={Boolean(value)}
            onChange={(next) => set(field.key, next)}
            label={field.label}
            hint={field.hint}
          />
        </div>
      );
    }

    return (
      <Field
        key={field.key}
        label={field.label}
        htmlFor={id}
        error={error}
        hint={field.hint}
        required={field.required}
        className={field.wide ? 'sm:col-span-2' : undefined}
      >
        {field.type === 'textarea' || field.type === 'markdown' ? (
          <textarea
            id={id}
            rows={field.type === 'markdown' ? 6 : 3}
            className={`input resize-y ${field.type === 'markdown' ? 'font-mono !text-sm' : ''}`}
            value={(value as string) ?? ''}
            placeholder={field.placeholder}
            onChange={(event) => set(field.key, event.target.value)}
          />
        ) : field.type === 'select' ? (
          <select
            id={id}
            className="input"
            value={(value as string | number) ?? ''}
            onChange={(event) => set(field.key, event.target.value)}
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={
              field.type === 'number' || field.type === 'year'
                ? 'number'
                : field.type === 'url'
                  ? 'url'
                  : 'text'
            }
            className="input"
            value={(value as string | number) ?? ''}
            placeholder={field.placeholder ?? (field.type === 'date' ? 'YYYY-MM-DD' : undefined)}
            min={field.type === 'year' ? 1900 : undefined}
            max={field.type === 'year' ? 2100 : undefined}
            onChange={(event) =>
              set(
                field.key,
                field.type === 'number' || field.type === 'year'
                  ? event.target.value === ''
                    ? null
                    : Number(event.target.value)
                  : event.target.value,
              )
            }
          />
        )}
      </Field>
    );
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={`${isNew ? 'Add' : 'Edit'} ${config.singular.toLowerCase()}`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">{config.fields.map(renderField)}</div>
    </Modal>
  );
}
