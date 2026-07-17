/**
 * Transactional email via Postmark — ONE shared Postmark server (token) for every
 * app, but each app sends from its own verified `emailFrom` (configured on the app
 * record in Firestore). Used for account emails (verify address, reset password).
 */
import { config } from '../config.js';
import type { AppRecord } from '../apps/types.js';

const POSTMARK_URL = 'https://api.postmarkapp.com/email';

export interface SendEmailInput {
  /** The app to send as — its `emailFrom` is the From address. */
  app: AppRecord;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
}

export class EmailNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

/**
 * Sends one transactional email. Throws `EmailNotConfiguredError` if the shared
 * token or the app's From address is missing (so callers can fail loudly in a
 * flow that depends on email, e.g. registration).
 */
export async function sendAppEmail(input: SendEmailInput): Promise<void> {
  const token = config.email.postmarkToken;
  if (!token) throw new EmailNotConfiguredError('POSTMARK_SERVER_TOKEN is not configured.');
  const from = input.app.emailFrom;
  if (!from) throw new EmailNotConfiguredError(`App "${input.app.appId}" has no emailFrom configured.`);

  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: input.to,
      Subject: input.subject,
      HtmlBody: input.htmlBody,
      ...(input.textBody ? { TextBody: input.textBody } : {}),
      ...(input.replyTo ? { ReplyTo: input.replyTo } : {}),
      MessageStream: config.email.messageStream,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmark send failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
