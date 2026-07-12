/**
 * Password hashing for the Workers runtime.
 *
 * bcrypt/argon2 need native or WASM bindings the Workers runtime does not
 * provide, so we use PBKDF2-SHA256 — implemented by Web Crypto and an accepted
 * KDF (NIST SP 800-132, OWASP Password Storage Cheat Sheet).
 *
 * ─── On the iteration count ───────────────────────────────────────────────
 *
 * OWASP's current floor for PBKDF2-HMAC-SHA256 is 600,000 iterations. **We
 * cannot use it.** workerd hard-caps PBKDF2 at 100,000 and rejects anything
 * higher outright:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 600000)
 *
 * Node's Web Crypto has no such cap, so a higher count works locally and then
 * throws a 500 on every login in production — which is exactly what happened.
 * 100,000 is therefore not a preference, it is the platform ceiling.
 *
 * The gap to OWASP's recommendation is covered by compensating controls, and
 * they are load-bearing rather than decorative:
 *
 *   • Rate limiting: 8 attempts per 15 minutes per IP (lib/security/rate-limit)
 *   • A 12-character minimum with 3 character classes (assessPasswordStrength)
 *   • Per-password random salts, so a stolen hash cannot be attacked in bulk
 *
 * Serialised format:  pbkdf2$<iterations>$<base64 salt>$<base64 hash>
 * The parameters travel with the hash, so this can be raised without
 * invalidating existing passwords the day workerd lifts the cap.
 */

const ALGORITHM = 'pbkdf2';

/** workerd rejects anything above this. Not a tuning knob — a hard limit. */
const MAX_SUPPORTED_ITERATIONS = 100_000;

const ITERATIONS = MAX_SUPPORTED_ITERATIONS;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      // `salt` is a Uint8Array; cast keeps TS happy across DOM/Workers lib versions.
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    key,
    KEY_BITS,
  );

  return new Uint8Array(bits);
}

/** Hashes a plaintext password for storage in `users.password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Verifies a password against a stored hash in constant time.
 *
 * Returns `false` — never throws — for malformed hashes, so a corrupted row
 * cannot turn into a 500 that leaks which accounts exist.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1_000) return false;

  /**
   * A hash written by a runtime without workerd's cap (Node, or an older build
   * of this app) would make `deriveBits` throw, turning every login into a 500.
   * Fail closed instead: the account cannot authenticate until its password is
   * re-hashed, which is a locked door rather than a broken one.
   */
  if (iterations > MAX_SUPPORTED_ITERATIONS) {
    console.error(
      `Stored password hash uses ${iterations} PBKDF2 iterations; this runtime supports at most ` +
        `${MAX_SUPPORTED_ITERATIONS}. Re-hash the password with \`npm run admin:password\`.`,
    );
    return false;
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** Length-independent, constant-time byte comparison. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * True when a hash should be transparently re-hashed on next successful login:
 * either it is weaker than we now require, or it uses an iteration count this
 * runtime cannot even evaluate.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return true;

  const iterations = Number(parts[1]);
  return iterations < ITERATIONS || iterations > MAX_SUPPORTED_ITERATIONS;
}

/** Rejects the passwords that show up first in every credential-stuffing list. */
export function assessPasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (password.length < 12) {
    return { ok: false, reason: 'Password must be at least 12 characters long.' };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'Password must be at most 200 characters long.' };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return {
      ok: false,
      reason:
        'Use at least three of: lowercase letters, uppercase letters, numbers, symbols.',
    };
  }
  return { ok: true };
}
