/**
 * Password hashing for the Workers runtime.
 *
 * bcrypt/argon2 need native or WASM bindings that the Workers runtime does not
 * provide out of the box, so we use PBKDF2-SHA256 — which *is* implemented by
 * Web Crypto and is an accepted KDF (NIST SP 800-132, OWASP Password Storage
 * Cheat Sheet). OWASP's current floor for PBKDF2-HMAC-SHA256 is 600,000
 * iterations; we use that.
 *
 * Serialised format:  pbkdf2$<iterations>$<base64 salt>$<base64 hash>
 * The parameters travel with the hash, so iteration counts can be raised later
 * without invalidating existing passwords.
 */

const ALGORITHM = 'pbkdf2';
const ITERATIONS = 600_000;
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
 * True when a hash was produced with weaker parameters than we now require,
 * which means it should be transparently re-hashed on next successful login.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return true;
  return Number(parts[1]) < ITERATIONS;
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
