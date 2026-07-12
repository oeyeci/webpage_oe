/**
 * Minimal, dependency-free JWT (HS256) built on Web Crypto.
 *
 * A library would work too, but the surface we need is small and the
 * verification rules are exactly the ones that get security bugs when they are
 * left to defaults — so they are spelled out here:
 *
 *   • `alg` is pinned to HS256 and compared before any signature work,
 *     which closes the classic `alg: none` / algorithm-confusion hole.
 *   • The signature is checked with `crypto.subtle.verify` (constant time).
 *   • `exp`, `nbf` and `iat` are all validated, with a small clock skew
 *     allowance for edge nodes whose clocks disagree.
 */

export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  /** JWT id — matches `sessions.id`, enabling server-side revocation. */
  jti: string;
  email: string;
  name: string;
  role: 'admin' | 'editor';
  /** Issued at (seconds). */
  iat: number;
  /** Expires at (seconds). */
  exp: number;
  /** Not before (seconds). */
  nbf?: number;
}

const CLOCK_SKEW_SECONDS = 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Signs a payload. `iat` and `exp` are set by the caller via `ttlSeconds`. */
export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };

  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify(body)));
  const data = `${header}.${claims}`;

  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies a token and returns its payload, or `null` if it is invalid,
 * expired, tampered with, or signed with an unexpected algorithm.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, claims, signature] = parts as [string, string, string];

  // Pin the algorithm *before* doing any crypto: never let the token pick it.
  let parsedHeader: { alg?: unknown; typ?: unknown };
  try {
    parsedHeader = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
  } catch {
    return null;
  }
  if (parsedHeader.alg !== 'HS256') return null;

  let key: CryptoKey;
  try {
    key = await importKey(secret);
  } catch {
    return null;
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signature) as unknown as BufferSource,
      encoder.encode(`${header}.${claims}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) return null;
  if (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_SECONDS > now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) return null;
  if (!payload.sub || !payload.jti) return null;

  return payload;
}
