import { useState } from 'react';
import { api } from '../../lib/admin/client';
import { Confirm, Modal, Pill, Toaster, useToasts } from './ui';

interface Contact {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'spam';
  country: string | null;
  createdAt: string;
}

const FILTERS = ['all', 'new', 'read', 'replied', 'spam'] as const;

export default function ContactsInbox({ initial }: { initial: Contact[] }) {
  const toast = useToasts();

  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [open, setOpen] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const visible = filter === 'all' ? items : items.filter((item) => item.status === filter);

  const counts = items.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { all: items.length },
  );

  const setStatus = async (contact: Contact, status: Contact['status']) => {
    const previous = items;
    setItems((prev) => prev.map((c) => (c.id === contact.id ? { ...c, status } : c)));
    setOpen((prev) => (prev?.id === contact.id ? { ...prev, status } : prev));

    try {
      await api.patch(`/api/admin/contacts/${contact.id}`, { status });
    } catch {
      setItems(previous);
      toast.error('Could not update that message.');
    }
  };

  /** Opening a message marks it read — that is what "opening" means. */
  const openMessage = (contact: Contact) => {
    setOpen(contact);
    if (contact.status === 'new') void setStatus(contact, 'read');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setOpen(null);

    try {
      await api.delete(`/api/admin/contacts/${target.id}`);
      setItems((prev) => prev.filter((c) => c.id !== target.id));
      toast.success('Message deleted.');
    } catch {
      toast.error('Could not delete that message.');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const tone = (status: Contact['status']) =>
    status === 'new'
      ? 'accent'
      : status === 'replied'
        ? 'success'
        : status === 'spam'
          ? 'danger'
          : 'neutral';

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.filter((f) => f === 'all' || counts[f]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setFilter(name)}
            aria-pressed={filter === name}
            className="chip capitalize transition-colors hover:border-accent hover:text-accent aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-white dark:aria-pressed:text-[#0b0c0f]"
          >
            {name}
            <span className="tabular-nums opacity-60">{counts[name] ?? 0}</span>
          </button>
        ))}
      </div>

      <ul className="mt-5 space-y-2">
        {visible.map((contact) => (
          <li key={contact.id}>
            <button
              type="button"
              onClick={() => openMessage(contact)}
              className={`card card-interactive flex w-full items-center gap-4 p-4 text-left ${
                contact.status === 'new' ? 'border-accent/40' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={tone(contact.status)}>{contact.status}</Pill>
                  {contact.country && <Pill>{contact.country}</Pill>}
                </div>

                <p
                  className={`mt-2 truncate ${
                    contact.status === 'new' ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {contact.subject}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-muted">
                  {contact.name} · {contact.email}
                </p>
                <p className="mt-1 truncate text-xs text-ink-subtle">{contact.message}</p>
              </div>

              <time
                dateTime={contact.createdAt}
                className="shrink-0 whitespace-nowrap text-xs text-ink-subtle"
              >
                {formatDate(contact.createdAt)}
              </time>
            </button>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="card py-16 text-center text-sm text-ink-muted">
            {items.length === 0 ? 'No messages yet.' : 'No messages match this filter.'}
          </li>
        )}
      </ul>

      {/* ═══ Message ══════════════════════════════════════════════════════ */}
      {open && (
        <Modal
          open
          onClose={() => setOpen(null)}
          title={open.subject}
          description={`${open.name} · ${open.email}`}
          footer={
            <>
              <button
                type="button"
                className="btn btn-danger mr-auto"
                onClick={() => setDeleting(open)}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void setStatus(open, 'spam')}
              >
                Mark spam
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void setStatus(open, 'replied')}
              >
                Mark replied
              </button>
              <a
                href={`mailto:${open.email}?subject=${encodeURIComponent(`Re: ${open.subject}`)}`}
                className="btn btn-primary"
                onClick={() => void setStatus(open, 'replied')}
              >
                Reply by email
              </a>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <Pill tone={tone(open.status)}>{open.status}</Pill>
              <span>{formatDate(open.createdAt)}</span>
              {open.country && <span>· {open.country}</span>}
            </div>

            <div className="rounded-lg border border-line bg-surface-2 p-4">
              {/* Plain text, never HTML — this is untrusted input from the internet. */}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{open.message}</p>
            </div>
          </div>
        </Modal>
      )}

      <Confirm
        open={deleting !== null}
        title="Delete message"
        message="This message will be permanently deleted. It is not archived anywhere, and the audit log does not keep a copy of its contents."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <Toaster toasts={toast.toasts} />
    </>
  );
}
