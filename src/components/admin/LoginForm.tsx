import { useId, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { ApiError, api } from '../../lib/admin/client';
import { Field } from './ui';

interface Props {
  /** Where to send the user after a successful sign-in. */
  next?: string;
}

export default function LoginForm({ next }: Props) {
  const formId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await api.post<{ redirect: string; mustChangePassword: boolean }>(
        '/api/auth/login',
        { email, password, remember, next },
      );

      window.location.href = result.redirect;
    } catch (cause) {
      // The server deliberately does not distinguish "no such account" from
      // "wrong password", and neither do we — surfacing that difference here
      // would hand an attacker an account-enumeration oracle.
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Something went wrong. Please try again.',
      );
      setPassword('');
      setBusy(false);
    }
  };

  const onChange =
    (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      if (error) setError(null);
    };

  return (
    <form onSubmit={onSubmit} className="card p-7 md:p-8" noValidate>
      <h1 className="font-serif text-2xl font-semibold">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-muted">Administrator access to the site.</p>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <Field label="Email" htmlFor={`${formId}-email`} required>
          <input
            id={`${formId}-email`}
            type="email"
            className="input"
            value={email}
            onChange={onChange(setEmail)}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>

        <Field label="Password" htmlFor={`${formId}-password`} required>
          <input
            id={`${formId}-password`}
            type="password"
            className="input"
            value={password}
            onChange={onChange(setPassword)}
            autoComplete="current-password"
            required
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="size-4 rounded border-line-strong accent-[var(--accent)]"
          />
          <span className="text-ink-muted">Keep me signed in for 30 days</span>
        </label>
      </div>

      <button type="submit" className="btn btn-primary mt-6 w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="mt-5 text-center text-xs leading-relaxed text-ink-subtle">
        Sessions are signed and can be revoked at any time. After several failed attempts,
        sign-in is rate limited.
      </p>
    </form>
  );
}
