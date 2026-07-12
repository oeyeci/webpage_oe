/**
 * Outbound email for contact-form notifications.
 *
 * Cloudflare Workers cannot open SMTP sockets, so delivery goes through an HTTP
 * email API (Resend). Email is treated as *best effort*: the submission is
 * already durably stored in D1 and visible in the admin inbox before we try to
 * send, so a provider outage loses a notification, never a message.
 */
import { escapeHtml } from '../utils/text';

export interface ContactNotification {
  name: string;
  email: string;
  subject: string;
  message: string;
  submittedAt: Date;
  ip?: string | null;
  country?: string | null;
}

export interface EmailConfig {
  apiKey?: string;
  to: string;
  from: string;
  siteUrl: string;
}

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: string };

/** Sends the "new contact message" notification to the site owner. */
export async function sendContactNotification(
  config: EmailConfig,
  contact: ContactNotification,
): Promise<EmailResult> {
  if (!config.apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY is not configured; notification skipped.' };
  }

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#111827;max-width:600px">
      <h2 style="margin:0 0 4px;font-size:18px">New message from your website</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
        ${escapeHtml(contact.submittedAt.toUTCString())}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr>
          <td style="padding:8px 0;color:#6b7280;width:90px;vertical-align:top">From</td>
          <td style="padding:8px 0"><strong>${escapeHtml(contact.name)}</strong>
            &lt;<a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>&gt;</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;vertical-align:top">Subject</td>
          <td style="padding:8px 0">${escapeHtml(contact.subject)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;vertical-align:top">Message</td>
          <td style="padding:8px 0;white-space:pre-wrap">${escapeHtml(contact.message)}</td>
        </tr>
      </table>
      <p style="margin:24px 0 0">
        <a href="${escapeHtml(config.siteUrl)}/admin/contacts"
           style="display:inline-block;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">
          Open in admin
        </a>
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        // Replying in the mail client should reach the sender, not the Worker.
        reply_to: contact.email,
        subject: `[Website] ${contact.subject}`,
        html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { sent: false, reason: `Resend returned ${response.status}: ${detail.slice(0, 200)}` };
    }

    return { sent: true };
  } catch (cause) {
    return {
      sent: false,
      reason: cause instanceof Error ? cause.message : 'Unknown email transport error.',
    };
  }
}
