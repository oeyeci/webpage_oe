import type { APIRoute } from 'astro';
import { getDb, getEnv, getExecutionContext, getRequestMeta } from '../../lib/context';
import { badRequest, handle, json, tooManyRequests } from '../../lib/api/response';
import { contactSchema } from '../../lib/validation/schemas';
import { createContact } from '../../lib/repositories/contacts';
import { getSettings } from '../../lib/repositories/settings';
import { verifyTurnstile } from '../../lib/security/turnstile';
import { LIMITS, clientIp, rateLimit } from '../../lib/security/rate-limit';
import { sendContactNotification } from '../../lib/services/email';

export const prerender = false;

/**
 * Public contact endpoint.
 *
 * Defence in depth, cheapest check first:
 *   1. Rate limit by IP (KV)      — stops a flood before any work is done.
 *   2. Honeypot field             — free; catches naive bots.
 *   3. Schema validation          — rejects malformed input.
 *   4. Turnstile siteverify       — the real gate; one network call, so it runs last.
 *
 * Accepts JSON (from the React island) *and* form-encoded bodies, so the form
 * still works with JavaScript disabled.
 */
export const POST: APIRoute = async (context) =>
  handle(async () => {
    const db = getDb();
    const env = getEnv();
    const meta = getRequestMeta(context);
    const ip = clientIp(context.request);

    const settings = await getSettings(db);
    if (!settings['contact.enabled']) {
      return badRequest('The contact form is currently closed.');
    }

    /* 1 — Rate limit. */
    const limit = await rateLimit(env.KV, `contact:${ip}`, LIMITS.contact);
    if (!limit.allowed) return tooManyRequests(limit.retryAfter);

    /* Parse either body encoding. */
    const contentType = context.request.headers.get('Content-Type') ?? '';
    const isForm =
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data');

    const raw = isForm
      ? Object.fromEntries(await context.request.formData())
      : await context.request.json().catch(() => null);

    if (!raw || typeof raw !== 'object') {
      return badRequest('Request body must be valid JSON or a form submission.');
    }

    // The no-JS path sends the Turnstile token under its widget name.
    const payload = raw as Record<string, unknown>;
    if (!payload.turnstileToken && payload['cf-turnstile-response']) {
      payload.turnstileToken = payload['cf-turnstile-response'];
    }

    const parsed = contactSchema.safeParse(payload);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        (details[path] ??= []).push(issue.message);
      }
      return badRequest('Some fields need attention.', details);
    }

    const input = parsed.data;

    /* 2 — Honeypot. Answer 200 so a bot cannot tell it was caught. */
    if (input.website) {
      return json({ ok: true });
    }

    /* 3 — Turnstile. */
    const verification = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, {
      remoteIp: ip === 'unknown' ? null : ip,
    });

    if (!verification.success) {
      return badRequest(verification.message ?? 'Verification failed. Please try again.', {
        turnstileToken: [verification.message ?? 'Verification failed.'],
      });
    }

    /* 4 — Store. This is the durable step: once it succeeds the message is
       safe, and the email below is only a convenience. */
    const contact = await createContact(db, {
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      ipAddress: ip === 'unknown' ? null : ip,
      userAgent: meta.userAgent,
      country: meta.country,
    });

    /* 5 — Notify, without making the sender wait for a third-party API. */
    if (settings['contact.notifyEmail']) {
      getExecutionContext(context).waitUntil(
        sendContactNotification(
          {
            apiKey: env.RESEND_API_KEY,
            to: env.CONTACT_TO_EMAIL,
            from: env.CONTACT_FROM_EMAIL,
            siteUrl: env.PUBLIC_SITE_URL,
          },
          {
            name: contact.name,
            email: contact.email,
            subject: contact.subject,
            message: contact.message,
            submittedAt: contact.createdAt,
            ip: contact.ipAddress,
            country: contact.country,
          },
        ).then((result) => {
          if (!result.sent) console.error('contact notification not sent:', result.reason);
        }),
      );
    }

    // The no-JS path expects a page, not JSON.
    if (isForm) {
      return context.redirect('/contact?sent=1', 303);
    }

    return json({ ok: true, id: contact.id });
  });
