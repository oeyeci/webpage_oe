/**
 * Fixed-window rate limiting on Workers KV.
 *
 * Guards the two endpoints where abuse actually costs something: the login form
 * (credential stuffing) and the contact form (spam). KV is eventually
 * consistent, so a determined attacker hitting many edge locations at once
 * could exceed the limit briefly — that is an acceptable trade for a
 * zero-infrastructure limiter, and Turnstile is the real gate on the contact
 * form. For login, the limit is a brute-force brake, not a security boundary:
 * the PBKDF2 cost factor is what makes guessing infeasible.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Consumes one unit against `identifier`.
 *
 * Never throws: if KV is unavailable the request is allowed through. A limiter
 * that takes the whole site down when it fails is worse than the abuse it
 * prevents.
 */
export async function rateLimit(
  kv: KVNamespace,
  identifier: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${identifier}:${window}`;

  try {
    const current = Number((await kv.get(key)) ?? '0');
    const used = Number.isFinite(current) ? current : 0;

    const resetsAt = (window + 1) * windowSeconds;
    const retryAfter = Math.max(1, resetsAt - Math.floor(Date.now() / 1000));

    if (used >= limit) {
      return { allowed: false, remaining: 0, retryAfter };
    }

    await kv.put(key, String(used + 1), {
      // Let KV expire the counter for us — no sweeping required.
      expirationTtl: Math.max(60, windowSeconds + 60),
    });

    return { allowed: true, remaining: Math.max(0, limit - used - 1), retryAfter };
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/** Best-effort client IP, as seen by Cloudflare. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export const LIMITS = {
  /** 8 login attempts per 15 minutes per IP. */
  login: { limit: 8, windowSeconds: 15 * 60 },
  /** 5 contact submissions per hour per IP. */
  contact: { limit: 5, windowSeconds: 60 * 60 },
  /** 60 admin writes per minute — a guard against a runaway script, not a user. */
  adminWrite: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
