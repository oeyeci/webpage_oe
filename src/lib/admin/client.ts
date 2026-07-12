/**
 * Typed API client for the admin panel.
 *
 * Every admin component talks to the server through this, so error handling,
 * the `{ data }` / `{ error }` envelope and field-level validation errors are
 * unwrapped in exactly one place instead of in every form.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
    /** Per-field messages, keyed by field name. */
    readonly details: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** First message for a field, if the server flagged it. */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { raw?: boolean } = {},
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };

  if (body instanceof FormData) {
    // Never set Content-Type for FormData — the browser must add the multipart
    // boundary itself, and setting it manually silently breaks the upload.
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }

  // The session expired mid-session: send the user to sign in again rather than
  // showing a confusing "unauthorized" toast on a page they were already using.
  if (response.status === 401 && !path.includes('/auth/')) {
    window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, 'Your session expired. Please sign in again.');
  }

  if (response.status === 204) return undefined as T;

  if (options.raw) {
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return response as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: string; code?: string; details?: Record<string, string[]> }
    | null;

  if (!response.ok || !payload) {
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed (${response.status}).`,
      payload?.code,
      payload?.details ?? {},
    );
  }

  return payload.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};
