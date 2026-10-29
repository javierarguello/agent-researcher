/**
 * Transactional email via Postmark — ONE shared Postmark server (token) for every
 * app, but each app sends from its own verified `emailFrom` (configured on the app
 * record in Firestore). Used for account emails (verify address, reset password).
 */
import { isSingleEmail } from '../auth/users.js';
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
  cc?: string;
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
  // Last line of defence, at the only place that talks to Postmark. Every caller
  // validates its own input, but `To:` takes a comma-separated LIST — one missed
  // validation anywhere upstream turns a user-supplied field into a mail-bomb
  // sent from our verified domain, and sender reputation is the one thing here
  // that cannot be rolled back.
  for (const [field, value] of [['to', input.to], ['replyTo', input.replyTo], ['cc', input.cc]] as const) {
    if (value !== undefined && !isSingleEmail(value)) {
      throw new Error(`Refusing to send: "${field}" must be exactly one email address.`);
    }
  }

  // Bounded, because `fetch` is not. undici abandons HEADERS after five minutes and
  // a stalled body never at all, and this call is AWAITED on the buyer's 202 and in
  // the Stripe webhook — so an unbounded one is a Postmark incident turning into a
  // buyer watching a spinner over a job that is already running, and into webhook
  // deliveries slow enough for Stripe to retry them while they are still in flight.
  const res = await fetch(POSTMARK_URL, {
    signal: AbortSignal.timeout(config.email.sendTimeoutMs),
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
      ...(input.cc ? { Cc: input.cc } : {}),
      MessageStream: config.email.messageStream,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmark send failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

export interface PostmarkOutboundStats {
  /** Messages Postmark accepted for delivery in the window — what its plans bill on. */
  sent: number;
  bounced: number;
  spamComplaints: number;
  /** Percent, as Postmark reports it. */
  bounceRate: number;
}

/**
 * Outbound totals for the shared Postmark server between two UTC dates
 * (`YYYY-MM-DD`, inclusive). Postmark has no billing API — a plan bills on
 * messages sent — so this count is what the admin's cost estimate is built from.
 * Read with the same server token the sends use; no account token needed.
 */
export async function getPostmarkOutboundStats(fromDate: string, toDate: string): Promise<PostmarkOutboundStats> {
  const token = config.email.postmarkToken;
  if (!token) throw new EmailNotConfiguredError('POSTMARK_SERVER_TOKEN is not configured.');
  const url = new URL('https://api.postmarkapp.com/stats/outbound');
  url.searchParams.set('fromdate', fromDate);
  url.searchParams.set('todate', toDate);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.email.sendTimeoutMs),
    headers: { Accept: 'application/json', 'X-Postmark-Server-Token': token },
  });
  if (!res.ok) throw new Error(`Postmark stats failed (${res.status})`);
  const d = (await res.json()) as { Sent?: number; Bounced?: number; SpamComplaints?: number; BounceRate?: number };
  return { sent: d.Sent ?? 0, bounced: d.Bounced ?? 0, spamComplaints: d.SpamComplaints ?? 0, bounceRate: d.BounceRate ?? 0 };
}

/**
 * What a month of Postmark costs on a plan: the flat fee, plus overage per 1,000
 * past the included volume. Pure, so the arithmetic is testable. null when no plan
 * fee is configured — an estimate from nothing is not a number worth showing.
 */
export function estimatePostmarkUsd(
  sent: number,
  plan: { planUsd: number | null; includedEmails: number | null; overagePer1000Usd: number | null },
): number | null {
  if (plan.planUsd == null) return null;
  const over = Math.max(0, sent - (plan.includedEmails ?? 0));
  return plan.planUsd + (Math.ceil(over / 1000) * (plan.overagePer1000Usd ?? 0));
}
