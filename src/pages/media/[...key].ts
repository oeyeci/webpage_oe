import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/context';

/**
 * Serves media objects out of R2.
 *
 * The bucket itself is never made public. Everything goes through this route so
 * that:
 *
 *   • The `Content-Type` comes from what we sniffed at upload time and stored on
 *     the object, never from what the uploader claimed — a file that lied about
 *     being a PNG can therefore never be served as `text/html`.
 *   • `X-Content-Type-Options: nosniff` stops the browser from second-guessing us.
 *   • Objects are immutable (their key contains a random suffix), so they can be
 *     cached forever — a media request should hit the edge and never the Worker.
 *   • Conditional requests (ETag / If-None-Match) are honoured, so a repeat
 *     visitor gets a 304 with no body.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const env = getEnv();
  const object = await env.MEDIA.get(key, {
    onlyIf: request.headers,
  });

  if (!object) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');

  // R2 returns an `R2Object` without a body when the conditional headers matched
  // (i.e. the client's copy is current) — that is a 304, not a 200 with no body.
  if (!('body' in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { status: 200, headers });
};
