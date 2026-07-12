/**
 * A single, consistent shape for every API response, plus the error-handling
 * wrapper that all admin routes are built on.
 *
 * The contract the client can rely on:
 *   success → { data: T }
 *   failure → { error: string, code: string, details?: Record<string, string[]> }
 *
 * Unexpected exceptions are logged with a correlation id and reported to the
 * caller as a generic 500 — internal messages and stack traces never cross the
 * network.
 */
import { z } from 'zod';

export type ApiError = {
  error: string;
  code: string;
  details?: Record<string, string[]>;
  requestId?: string;
};

export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA: 'unsupported_media_type',
  INTERNAL: 'internal_error',
} as const;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // API responses are per-user and must never be cached by a shared cache.
  'Cache-Control': 'private, no-store',
};

export function json<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ data }), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

export function created<T>(data: T): Response {
  return json(data, { status: 201 });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
}

export function fail(
  status: number,
  code: string,
  error: string,
  details?: Record<string, string[]>,
): Response {
  const body: ApiError = { error, code };
  if (details) body.details = details;
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const badRequest = (error: string, details?: Record<string, string[]>) =>
  fail(400, ERROR_CODES.VALIDATION, error, details);

export const unauthorized = (error = 'You must sign in to do that.') =>
  fail(401, ERROR_CODES.UNAUTHORIZED, error);

export const forbidden = (error = 'You do not have permission to do that.') =>
  fail(403, ERROR_CODES.FORBIDDEN, error);

export const notFound = (error = 'Not found.') => fail(404, ERROR_CODES.NOT_FOUND, error);

export const conflict = (error: string) => fail(409, ERROR_CODES.CONFLICT, error);

export const tooManyRequests = (retryAfter: number) =>
  new Response(
    JSON.stringify({
      error: `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
      code: ERROR_CODES.RATE_LIMITED,
    } satisfies ApiError),
    {
      status: 429,
      headers: { ...JSON_HEADERS, 'Retry-After': String(retryAfter) },
    },
  );

export const serverError = (requestId: string) =>
  new Response(
    JSON.stringify({
      error: 'Something went wrong on our side. The error has been logged.',
      code: ERROR_CODES.INTERNAL,
      requestId,
    } satisfies ApiError),
    { status: 500, headers: JSON_HEADERS },
  );

/**
 * Flattens a Zod issue list into `{ field: [messages] }`, which is exactly the
 * shape the admin forms consume to show per-field errors.
 */
export function zodDetails(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    (details[path] ??= []).push(issue.message);
  }
  return details;
}

/** Thrown by handlers to short-circuit with a specific status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Wraps a route handler so that validation failures, `HttpError`s and unexpected
 * exceptions all become well-formed JSON instead of an Astro stack-trace page.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof HttpError) {
      return fail(cause.status, cause.code, cause.message, cause.details);
    }

    if (cause instanceof z.ZodError) {
      return badRequest('Some fields need attention.', zodDetails(cause));
    }

    // SQLite surfaces constraint violations as opaque strings; translate the
    // one users actually hit (a duplicate slug / citation key) into a 409.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/UNIQUE constraint failed/i.test(message)) {
      const column = /UNIQUE constraint failed: \w+\.(\w+)/i.exec(message)?.[1];
      return conflict(
        column
          ? `That ${column.replace(/_/g, ' ')} is already in use. Choose a different one.`
          : 'That record already exists.',
      );
    }

    const requestId = crypto.randomUUID();
    console.error(`[${requestId}]`, message, cause instanceof Error ? cause.stack : '');
    return serverError(requestId);
  }
}

/** Parses and validates a JSON request body. */
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, ERROR_CODES.VALIDATION, 'Request body must be valid JSON.');
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION,
      'Some fields need attention.',
      zodDetails(result.error),
    );
  }
  return result.data;
}
