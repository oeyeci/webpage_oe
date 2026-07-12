/**
 * Cloudflare Turnstile server-side verification.
 *
 * A Turnstile token is only meaningful once it has been redeemed against
 * `siteverify` — a client that simply *has* a token proves nothing. Tokens are
 * single-use and expire after ~5 minutes, so this must run on every submission.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  /** Machine-readable failure codes, e.g. `timeout-or-duplicate`. */
  errorCodes: string[];
  /** Friendly message suitable for showing on the form. */
  message?: string;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  'missing-input-response': 'Please complete the human-verification challenge.',
  'invalid-input-response': 'The verification challenge expired. Please try again.',
  'timeout-or-duplicate': 'The verification challenge was already used. Please try again.',
  'invalid-input-secret': 'Verification is misconfigured on the server.',
  'missing-input-secret': 'Verification is misconfigured on the server.',
  'internal-error': 'Verification is temporarily unavailable. Please try again.',
};

/**
 * Verifies a Turnstile token.
 *
 * `remoteIp` is optional but recommended — Cloudflare uses it to strengthen the
 * signal. `idempotencyKey` lets a retry of the *same* submission re-verify the
 * same token instead of failing with `timeout-or-duplicate`.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  secret: string,
  options: { remoteIp?: string | null; idempotencyKey?: string } = {},
): Promise<TurnstileResult> {
  if (!token) {
    return {
      success: false,
      errorCodes: ['missing-input-response'],
      message: FRIENDLY_ERRORS['missing-input-response'],
    };
  }

  if (!secret) {
    // Fail closed. A missing secret must never mean "everyone passes".
    return {
      success: false,
      errorCodes: ['missing-input-secret'],
      message: FRIENDLY_ERRORS['missing-input-secret'],
    };
  }

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (options.remoteIp) body.append('remoteip', options.remoteIp);
  if (options.idempotencyKey) body.append('idempotency_key', options.idempotencyKey);

  let payload: { success?: boolean; 'error-codes'?: string[] };
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    payload = await response.json();
  } catch {
    return {
      success: false,
      errorCodes: ['internal-error'],
      message: FRIENDLY_ERRORS['internal-error'],
    };
  }

  const errorCodes = payload['error-codes'] ?? [];
  if (payload.success) return { success: true, errorCodes: [] };

  const firstCode = errorCodes[0] ?? 'internal-error';
  return {
    success: false,
    errorCodes,
    message: FRIENDLY_ERRORS[firstCode] ?? 'Verification failed. Please try again.',
  };
}
