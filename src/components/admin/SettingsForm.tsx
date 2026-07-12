import { useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Field, Toaster, Toggle, useToasts } from './ui';

interface Definition {
  key: string;
  label: string;
  group: string;
}

interface Props {
  values: Record<string, unknown>;
  definitions: Definition[];
}

const GROUP_LABELS: Record<string, string> = {
  general: 'General',
  seo: 'Search engines',
  publications: 'Publications',
  blog: 'Blog',
  home: 'Home page',
  contact: 'Contact form',
};

/**
 * Site settings.
 *
 * The input control is inferred from the *type of the stored value*, not from a
 * duplicate schema on the client — a boolean gets a toggle, an array of strings
 * gets a line-per-item textarea, a number gets a number field. The server
 * validates every key against its Zod schema regardless.
 */
export default function SettingsForm({ values: initial, definitions }: Props) {
  const toast = useToasts();

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: [] }));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});

    try {
      const result = await api.patch<{ values: Record<string, unknown> }>(
        '/api/admin/settings',
        values,
      );
      setValues(result.values);
      setDirty(false);
      toast.success('Settings saved.');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErrors(cause.details);
        toast.error(
          Object.keys(cause.details).length > 0 ? 'Some settings are invalid.' : cause.message,
        );
      } else {
        toast.error('Could not save settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  const groups = [...new Set(definitions.map((d) => d.group))];

  const renderControl = (definition: Definition) => {
    const value = values[definition.key];
    const id = `setting-${definition.key}`;
    const error = errors[definition.key]?.[0];

    if (typeof value === 'boolean') {
      return (
        <div key={definition.key} className="py-3">
          <Toggle
            checked={value}
            onChange={(next) => set(definition.key, next)}
            label={definition.label}
          />
          {error && <p className="field-error mt-1">{error}</p>}
        </div>
      );
    }

    if (Array.isArray(value)) {
      return (
        <Field
          key={definition.key}
          label={definition.label}
          htmlFor={id}
          error={error}
          hint="One per line."
          className="py-3"
        >
          <textarea
            id={id}
            rows={Math.min(8, Math.max(3, value.length + 1))}
            className="input resize-y font-mono !text-sm"
            value={(value as string[]).join('\n')}
            onChange={(event) =>
              set(
                definition.key,
                event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
              )
            }
          />
        </Field>
      );
    }

    if (typeof value === 'number') {
      return (
        <Field
          key={definition.key}
          label={definition.label}
          htmlFor={id}
          error={error}
          className="py-3"
        >
          <input
            id={id}
            type="number"
            className="input"
            value={value}
            onChange={(event) => set(definition.key, Number(event.target.value))}
          />
        </Field>
      );
    }

    const isLong = String(value ?? '').length > 80;

    return (
      <Field
        key={definition.key}
        label={definition.label}
        htmlFor={id}
        error={error}
        className="py-3"
      >
        {isLong ? (
          <textarea
            id={id}
            rows={3}
            className="input resize-y"
            value={String(value ?? '')}
            onChange={(event) => set(definition.key, event.target.value)}
          />
        ) : (
          <input
            id={id}
            type="text"
            className="input"
            value={String(value ?? '')}
            onChange={(event) => set(definition.key, event.target.value)}
          />
        )}
      </Field>
    );
  };

  return (
    <>
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group} className="card p-6">
            <h2 className="font-serif text-lg font-semibold">
              {GROUP_LABELS[group] ?? group}
            </h2>

            <div className="mt-2 divide-y divide-line">
              {definitions.filter((d) => d.group === group).map(renderControl)}
            </div>
          </section>
        ))}
      </div>

      <div className="sticky bottom-5 mt-6 flex justify-end">
        <button
          type="button"
          className="btn btn-primary shadow-float"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <div className="mt-8 card p-6">
        <h2 className="font-serif text-lg font-semibold">Backup</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Exports every content table as JSON. Passwords and session data are never included.
          Media files live in R2 and are backed up separately — see the operations guide.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/admin/backup" className="btn btn-secondary" download>
            Download full backup
          </a>
          <a href="/api/admin/backup?contacts=0" className="btn btn-ghost" download>
            Without contact messages
          </a>
        </div>
      </div>

      <Toaster toasts={toast.toasts} />
    </>
  );
}
