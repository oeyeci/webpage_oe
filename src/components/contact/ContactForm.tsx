import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from 'react';

/**
 * Contact form.
 *
 * A React island because it has genuine client state: field-level validation,
 * an async submit, a Turnstile widget whose token has to be threaded through,
 * and a success view that replaces the form.
 *
 * It degrades honestly: with JavaScript disabled the form still posts to
 * `/api/contact` as a normal HTML form (the endpoint accepts both JSON and
 * form-encoded bodies), and the server-side Turnstile check still runs.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        selector: string | HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface Props {
  siteKey: string;
}

interface FieldErrors {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  form?: string;
}

const MAX_MESSAGE = 5000;

export default function ContactForm({ siteKey }: Props) {
  const formId = useId();
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const [values, setValues] = useState({ name: '', email: '', subject: '', message: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  /* ── Turnstile ──────────────────────────────────────────────────────────
     The script is injected here rather than in the page <head> so it is only
     ever loaded on the one page that needs it. */
  useEffect(() => {
    const render = () => {
      if (!window.turnstile || !widgetRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (value) => setToken(value),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };

    if (window.turnstile) {
      render();
      return;
    }

    window.onTurnstileLoad = render;

    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    return () => {
      delete window.onTurnstileLoad;
    };
  }, [siteKey]);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};

    if (values.name.trim().length < 2) next.name = 'Please enter your name.';
    // Deliberately permissive: the only way to truly validate an address is to
    // send to it, and an over-strict regex rejects valid addresses every day.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) {
      next.email = 'Please enter a valid email address.';
    }
    if (values.subject.trim().length < 3) next.subject = 'Please add a subject.';
    if (values.message.trim().length < 20) {
      next.message = 'Please write at least 20 characters so I can respond usefully.';
    }
    if (values.message.length > MAX_MESSAGE) {
      next.message = `Please keep the message under ${MAX_MESSAGE.toLocaleString()} characters.`;
    }

    return next;
  };

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();

    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      // Move focus to the first field with a problem — otherwise a keyboard or
      // screen-reader user has no idea what changed.
      const first = Object.keys(found)[0];
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }

    if (!token) {
      setErrors({ form: 'Please complete the human-verification challenge.' });
      return;
    }

    setErrors({});
    setStatus('submitting');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, turnstileToken: token }),
      });

      if (response.ok) {
        setStatus('success');
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        details?: Record<string, string[]>;
      } | null;

      const details = payload?.details ?? {};
      const fieldErrors: FieldErrors = {};
      for (const [field, messages] of Object.entries(details)) {
        if (field in values && messages[0]) {
          fieldErrors[field as keyof FieldErrors] = messages[0];
        }
      }

      setErrors({
        ...fieldErrors,
        form:
          Object.keys(fieldErrors).length > 0
            ? undefined
            : (payload?.error ?? 'Something went wrong. Please try again.'),
      });
      setStatus('idle');

      // A Turnstile token is single-use — a failed submit needs a fresh one.
      window.turnstile?.reset(widgetId.current ?? undefined);
      setToken('');
    } catch {
      setErrors({ form: 'Could not reach the server. Please check your connection.' });
      setStatus('idle');
      window.turnstile?.reset(widgetId.current ?? undefined);
      setToken('');
    }
  };

  if (status === 'success') {
    return (
      <div
        className="card flex flex-col items-center px-6 py-14 text-center"
        role="status"
        aria-live="polite"
      >
        <div
          className="grid size-12 place-items-center rounded-full bg-success/12 text-success"
          aria-hidden="true"
        >
          <svg
            className="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="mt-5 font-serif text-2xl font-semibold">Message sent</h2>
        <p className="mt-2 max-w-sm text-ink-muted">
          Thank you for getting in touch. I read every message and will reply as soon as I can.
        </p>
        <a href="/" className="btn btn-secondary mt-7">
          Back to home
        </a>
      </div>
    );
  }

  const field = (name: keyof typeof values) => ({
    id: `${formId}-${name}`,
    name,
    value: values[name],
    'aria-invalid': errors[name] ? ('true' as const) : undefined,
    'aria-describedby': errors[name] ? `${formId}-${name}-error` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((prev) => ({ ...prev, [name]: event.target.value }));
      // Clear the error as soon as the user starts fixing it, rather than
      // leaving a red field until they hit submit again.
      if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
    },
  });

  const remaining = MAX_MESSAGE - values.message.length;

  return (
    <form onSubmit={onSubmit} method="post" action="/api/contact" className="card p-6 md:p-8" noValidate>
      {errors.form && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger"
        >
          {errors.form}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-name`} className="label">
            Name <span className="text-danger">*</span>
          </label>
          <input {...field('name')} type="text" className="input" autoComplete="name" required />
          {errors.name && (
            <p id={`${formId}-name-error`} className="field-error">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${formId}-email`} className="label">
            Email <span className="text-danger">*</span>
          </label>
          <input
            {...field('email')}
            type="email"
            className="input"
            autoComplete="email"
            required
          />
          {errors.email && (
            <p id={`${formId}-email-error`} className="field-error">
              {errors.email}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor={`${formId}-subject`} className="label">
          Subject <span className="text-danger">*</span>
        </label>
        <input {...field('subject')} type="text" className="input" required />
        {errors.subject && (
          <p id={`${formId}-subject-error`} className="field-error">
            {errors.subject}
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${formId}-message`} className="label">
            Message <span className="text-danger">*</span>
          </label>
          <span
            className={`text-xs tabular-nums ${remaining < 0 ? 'text-danger' : 'text-ink-subtle'}`}
            aria-live="polite"
          >
            {remaining.toLocaleString()} left
          </span>
        </div>
        <textarea {...field('message')} rows={7} className="input resize-y" required />
        {errors.message && (
          <p id={`${formId}-message-error`} className="field-error">
            {errors.message}
          </p>
        )}
      </div>

      {/* Turnstile widget mounts here. */}
      <div ref={widgetRef} className="mt-6" />

      <button
        type="submit"
        className="btn btn-primary mt-6 w-full sm:w-auto"
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? 'Sending…' : 'Send message'}
      </button>

      <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
        Protected by Cloudflare Turnstile. Your message is stored securely and used only to reply
        to you — see the{' '}
        <a href="/privacy" className="text-accent hover:underline">
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
