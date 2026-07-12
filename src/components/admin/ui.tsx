import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Shared admin UI primitives.
 *
 * Small, unstyled-by-default, and accessible by construction — the modal traps
 * focus, the confirm dialog is a real dialog, and the toast is a live region.
 * These are the pieces every manager screen reuses.
 */

/* ── Toast ────────────────────────────────────────────────────────────────── */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

let toastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = (kind: ToastKind, text: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, text }]);
    // Errors stay longer: they usually need reading, not just noticing.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === 'error' ? 7000 : 3500);
  };

  return {
    toasts,
    success: (text: string) => push('success', text),
    error: (text: string) => push('error', text),
    info: (text: string) => push('info', text),
  };
}

export function Toaster({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-100 flex w-full max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-float ${
            toast.kind === 'success'
              ? 'border-success/30 bg-surface text-success'
              : toast.kind === 'error'
                ? 'border-danger/30 bg-surface text-danger'
                : 'border-line bg-surface text-ink'
          }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

/**
 * A modal built on `<dialog>`, so focus trapping, Escape-to-close and inertness
 * of the background are handled by the platform rather than re-implemented
 * (badly) in JavaScript.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'lg',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const width = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself, not its content)
        // closes the modal — the standard, expected behaviour.
        if (event.target === ref.current) onClose();
      }}
      className={`w-[calc(100%-2rem)] ${width} rounded-2xl border border-line bg-surface p-0 text-ink shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-sm`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="font-serif text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost -mr-2 -mt-1 size-8 !p-0"
          aria-label="Close"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">
          {footer}
        </div>
      )}
    </dialog>
  );
}

/* ── Confirm ──────────────────────────────────────────────────────────────── */

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-muted">{message}</p>
    </Modal>
  );
}

/* ── Form fields ──────────────────────────────────────────────────────────── */

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-subtle">{hint}</span>}
      </span>
    </label>
  );
}

/* ── Empty & loading states ───────────────────────────────────────────────── */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-muted">
      <span
        className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

export function EmptyRow({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
      {action}
    </div>
  );
}

/* ── Status pill ──────────────────────────────────────────────────────────── */

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    neutral: 'border-line text-ink-muted',
    success: 'border-success/30 text-success',
    warning: 'border-warning/30 text-warning',
    danger: 'border-danger/30 text-danger',
    accent: 'border-transparent bg-accent-soft text-accent',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
