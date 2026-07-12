import { useState } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Field, Toaster, useToasts } from './ui';

export interface ProfileValues {
  fullName: string;
  honorific: string;
  title: string;
  institution: string;
  department: string;
  tagline: string;
  summary: string;
  professionalBioMd: string;
  academicBioMd: string;
  email: string;
  phone: string;
  office: string;
  address: string;
  googleMapsUrl: string;
  cvMediaId: number | null;
  orcid: string;
  googleScholar: string;
  researchGate: string;
  github: string;
  linkedin: string;
  twitter: string;
}

const SECTIONS: Array<{
  title: string;
  hint?: string;
  fields: Array<{
    key: keyof ProfileValues;
    label: string;
    type?: 'text' | 'textarea' | 'markdown' | 'url';
    hint?: string;
    required?: boolean;
    wide?: boolean;
  }>;
}> = [
  {
    title: 'Identity',
    fields: [
      { key: 'fullName', label: 'Full name', required: true },
      { key: 'honorific', label: 'Honorific', hint: 'Assoc. Prof. Dr.' },
      { key: 'title', label: 'Title', required: true, wide: true },
      { key: 'institution', label: 'Institution' },
      { key: 'department', label: 'Department' },
      {
        key: 'tagline',
        label: 'Tagline',
        type: 'textarea',
        wide: true,
        hint: 'The one-line statement under your name on the home page.',
      },
      {
        key: 'summary',
        label: 'Summary',
        type: 'textarea',
        wide: true,
        hint: 'Used as the default meta description for search engines and link previews.',
      },
    ],
  },
  {
    title: 'Biography',
    hint: 'Markdown. Rendered to HTML on save — the same pipeline the blog uses, so LaTeX and links work.',
    fields: [
      { key: 'professionalBioMd', label: 'Professional biography', type: 'markdown', wide: true },
      { key: 'academicBioMd', label: 'Academic biography', type: 'markdown', wide: true },
    ],
  },
  {
    title: 'Contact',
    hint: 'Shown publicly on the contact page. Do not put a personal mobile number here.',
    fields: [
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone (office)' },
      { key: 'office', label: 'Office' },
      { key: 'address', label: 'Address', type: 'textarea', wide: true },
      { key: 'googleMapsUrl', label: 'Google Maps link', type: 'url', wide: true },
    ],
  },
  {
    title: 'Academic profiles',
    fields: [
      { key: 'orcid', label: 'ORCID', type: 'url' },
      { key: 'googleScholar', label: 'Google Scholar', type: 'url' },
      { key: 'researchGate', label: 'ResearchGate', type: 'url' },
      { key: 'github', label: 'GitHub', type: 'url' },
      { key: 'linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'twitter', label: 'X / Twitter', type: 'url' },
    ],
  },
];

export default function ProfileForm({ initial }: { initial: ProfileValues }) {
  const toast = useToasts();

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (key: keyof ProfileValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: [] }));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});

    try {
      // Empty strings mean "no value" — the schema turns them into NULL.
      await api.put('/api/admin/profile', values);
      setDirty(false);
      toast.success('Profile saved.');
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

  return (
    <>
      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="card p-6">
            <h2 className="font-serif text-lg font-semibold">{section.title}</h2>
            {section.hint && <p className="mt-1 text-sm text-ink-muted">{section.hint}</p>}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {section.fields.map((field) => {
                const id = `profile-${field.key}`;
                const value = String(values[field.key] ?? '');

                return (
                  <Field
                    key={field.key}
                    label={field.label}
                    htmlFor={id}
                    error={errors[field.key]?.[0]}
                    hint={field.hint}
                    required={field.required}
                    className={field.wide ? 'sm:col-span-2' : undefined}
                  >
                    {field.type === 'textarea' || field.type === 'markdown' ? (
                      <textarea
                        id={id}
                        rows={field.type === 'markdown' ? 12 : 2}
                        className={`input resize-y ${
                          field.type === 'markdown' ? 'font-mono !text-sm' : ''
                        }`}
                        value={value}
                        onChange={(event) => set(field.key, event.target.value)}
                      />
                    ) : (
                      <input
                        id={id}
                        type={field.type === 'url' ? 'url' : 'text'}
                        className="input"
                        value={value}
                        onChange={(event) => set(field.key, event.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
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

      <Toaster toasts={toast.toasts} />
    </>
  );
}
