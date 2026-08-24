/**
 * The two messages a buyer gets that are not about their account: the mail that
 * says a dossier STARTED, and the receipt for the credits that paid for it
 * (P-10, P-11 — Javier, 2026-08-24).
 *
 * Both are best-effort by design and that is exactly what makes them worth
 * pinning. A courtesy mail that throws inside the Stripe webhook is not a missing
 * courtesy: it is a 500 that Stripe retries for days and can disable the endpoint,
 * which stops EVERY customer's credits from landing. And a screen that promises
 * mail is only honest if it promises it under the same condition the sender uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

/** The session `create` echoes its args back, so a test can read the metadata we sent. */
const created: Array<Record<string, unknown>> = [];
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({
    webhooks: {
      constructEvent: (raw: Buffer | string, sig: string) => {
        if (sig !== 'valid') throw new Error('signature verification failed');
        return JSON.parse(raw.toString());
      },
    },
    checkout: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          created.push(args);
          return { id: 'cs_test_1', url: 'https://checkout/x', ...args };
        },
      },
    },
  }),
  resolveStripePlan: async (appId: string, planId: string) =>
    planId === 'investor'
      ? { planId: 'investor', name: 'Investor <pack>', priceUsd: 100, credits: 15, priceId: 'price_1', appId }
      : undefined,
  listStripePlans: async () => [],
  isValidAppId: (appId: string) => /^[a-z0-9][a-z0-9-_]{0,63}$/.test(appId),
}));

import { app } from '../src/index.js';
import { createApp, grantCredits, getBalance, listTransactions, creditsForMode, getTemplate } from '@agent-researcher/core';
import { token, auth } from './helpers.js';

const ESSENTIAL = creditsForMode(getTemplate('florida-business-for-sale')!.modes!.essential!, 'essential');

/** Every mail Postmark would have been sent, newest last. */
const sent: Array<{ To: string; Subject: string; HtmlBody: string; TextBody?: string }> = [];
/** Set to make the next Postmark call fail, the way an outage does. */
let mailFails = false;
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: unknown, init: { body?: string } = {}) => {
    const u = String(url);
    if (u.includes('postmarkapp.com')) {
      if (mailFails) return { ok: false, status: 500, text: async () => 'Postmark is down' } as Response;
      sent.push(JSON.parse(init.body ?? '{}'));
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }
    throw new Error(`unexpected fetch: ${u}`);
  }),
);

/** An app that sends mail — BOTH fields, which is the sender's own condition. */
const seedMailApp = () =>
  createApp({ appId: 'fbizlab', name: 'Florida Biz Labs', role: 'app', emailFrom: 'no-reply@fbizlab.test', webUrl: 'https://fbizlab.test' });

const purchaseEvent = (paymentId: string, meta: Record<string, string> = {}) => ({
  id: `evt_${paymentId}`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_${paymentId}`,
      payment_intent: paymentId,
      amount_total: 10000,
      currency: 'usd',
      payment_status: 'paid',
      metadata: { appId: 'fbizlab', userId: 'u@x.com', planId: 'investor', credits: '15', ...meta },
    },
  },
});

const webhook = (event: unknown, sig = 'valid') =>
  app.inject({
    method: 'POST',
    url: '/credits/webhook',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    payload: JSON.stringify(event),
  });

const research = { template: 'florida-business-for-sale', params: { industry: 'hvac', mode: 'essential', language: 'es' } };

beforeEach(() => {
  sent.length = 0;
  created.length = 0;
  mailFails = false;
});

describe('the dossier start email, and the screen’s permission to close the tab', () => {
  it('mails the buyer when the job is queued, with a link back to it', async () => {
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(await token('fbizlab', 'u@x.com')), payload: research });
    expect(r.statusCode).toBe(202);
    const { jobId } = r.json();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.To).toBe('u@x.com');
    // The link is the whole point of this mail: it is what makes closing the tab
    // free. A subject with no way back is a notification, not a handoff.
    expect(sent[0]!.HtmlBody).toContain(`https://fbizlab.test/app/jobs/${jobId}`);
    expect(sent[0]!.TextBody).toContain(`https://fbizlab.test/app/jobs/${jobId}`);
  });

  it('…in the REPORT’s language, not the browser’s — the same language the finished mail will use', async () => {
    // The completion mail reads `job.params.language` (`notifyReportReady`). Two
    // mails about one dossier arriving in two different languages is the
    // half-translation this repo has already shipped once.
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    await app.inject({
      method: 'POST',
      url: '/research',
      headers: { ...auth(await token('fbizlab', 'u@x.com')), 'accept-language': 'en' },
      payload: research, // params.language = 'es'
    });
    expect(sent[0]!.Subject).toMatch(/Estamos generando/);
    expect(sent[0]!.Subject).not.toMatch(/We’re building/);
  });

  it('marks the job `notify` so the screen may say "you can close this"', async () => {
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    const t = await token('fbizlab', 'u@x.com');
    const { jobId } = (await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })).json();
    const got = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(t) });
    expect(got.json().notify).toBe(true);
  });

  it('and does NEITHER for an app that cannot send — no mail, and `notify` false', async () => {
    // The defect this guards is a promise made on a weaker test than the sender
    // uses: `emailFrom` without `webUrl` builds no link, so `notifyReportReady`
    // returns early and the completion mail never goes out. A screen that told
    // this buyer to close the tab would be sending them away from the only place
    // their dossier exists.
    await createApp({ appId: 'fbizlab', name: 'Florida Biz Labs', role: 'app', emailFrom: 'no-reply@fbizlab.test' });
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(r.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
    const got = await app.inject({ method: 'GET', url: `/research/${r.json().jobId}`, headers: auth(t) });
    expect(got.json().notify).toBe(false);
  });

  it('a job created before the flag existed reads `notify: false`, never true by default', async () => {
    // The safe direction, stated as a test. Every job in prod today predates this
    // field. Silence costs a buyer a wait; a wrong promise costs them a dossier
    // they believe is coming by mail and then never arrives.
    await seedMailApp();
    const { createJob } = await import('@agent-researcher/core');
    await createJob({ jobId: 'legacy-1', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params: {} });
    const got = await app.inject({ method: 'GET', url: '/research/legacy-1', headers: auth(await token('fbizlab', 'u@x.com')) });
    expect(got.statusCode).toBe(200);
    expect(got.json().notify).toBe(false);
  });

  it('a dead Postmark costs the courtesy mail and NOT the job', async () => {
    // The job is the thing that was paid for. The 202 must not become a 500
    // because the mail server is down, and the credits must stay spent on a job
    // that is really queued.
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    mailFails = true;
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(await token('fbizlab', 'u@x.com')), payload: research });
    expect(r.statusCode).toBe(202);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(20 - ESSENTIAL);
  });
});

describe('the credit purchase receipt', () => {
  it('sends one receipt naming the credits, the balance and the pack', async () => {
    await seedMailApp();
    const r = await webhook(purchaseEvent('pi_1', { planName: 'Investor', lang: 'es' }));
    expect(r.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.To).toBe('u@x.com');
    // What Stripe's own receipt cannot say: how many credits, and what the buyer
    // now has. That is the whole reason this is ours (Javier, 2026-08-24).
    expect(sent[0]!.HtmlBody).toContain('+15');
    expect(sent[0]!.HtmlBody).toContain('Investor');
    expect(sent[0]!.HtmlBody).toContain('https://fbizlab.test/app/credits');
    expect(sent[0]!.Subject).toMatch(/15 créditos/);
  });

  it('does NOT send a second receipt when Stripe redelivers the same event', async () => {
    // The rule that matters most here. Stripe delivers at least once and retries
    // for days; the grant is idempotent by `paymentId`, so the mail has to ride
    // THAT result and not a key of its own. A buyer with two receipts for one
    // purchase reasonably believes they were charged twice.
    await seedMailApp();
    await webhook(purchaseEvent('pi_1'));
    await webhook(purchaseEvent('pi_1'));
    await webhook(purchaseEvent('pi_1'));
    expect(sent).toHaveLength(1);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
    expect((await listTransactions('fbizlab', 'u@x.com', 20)).filter((t) => t.type === 'purchase')).toHaveLength(1);
  });

  it('reports the balance the purchase produced, not just the credits added', async () => {
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 7 });
    sent.length = 0;
    await webhook(purchaseEvent('pi_1'));
    expect(sent[0]!.TextBody).toContain('22'); // 7 + 15
  });

  it('a dead Postmark still credits the buyer, and still answers 200', async () => {
    // The one that protects everybody else: a throw here is a 500 Stripe retries
    // for days, and a repeatedly failing endpoint gets disabled — which stops
    // every OTHER customer's credits from landing over one mail outage.
    await seedMailApp();
    mailFails = true;
    const r = await webhook(purchaseEvent('pi_1'));
    expect(r.statusCode).toBe(200);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
  });

  it('an app with no sender is credited in silence, not 500', async () => {
    await createApp({ appId: 'fbizlab', name: 'Florida Biz Labs', role: 'app' });
    const r = await webhook(purchaseEvent('pi_1'));
    expect(r.statusCode).toBe(200);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
    expect(sent).toHaveLength(0);
  });

  it('the checkout session carries the language and the pack name the receipt needs', async () => {
    // The webhook has no request to read them from — it is Stripe calling us,
    // possibly hours later for a delayed payment method, with no Accept-Language
    // and no catalog lookup in hand. If they are not on the session, the receipt
    // is in English and names no pack.
    await seedMailApp();
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 1 });
    await app.inject({
      method: 'POST',
      url: '/credits/checkout',
      headers: { ...auth(await token('fbizlab', 'u@x.com')), 'accept-language': 'fr' },
      payload: { planId: 'investor', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' },
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.metadata).toMatchObject({ lang: 'fr', planName: 'Investor <pack>' });
  });

  it('a pack name from the catalog cannot inject markup into the receipt', async () => {
    // Plan names are typed by a person into the admin's Pricing form and travel
    // through Stripe metadata. This mail is HTML we build by string concatenation.
    await seedMailApp();
    await webhook(purchaseEvent('pi_1', { planName: '<img src=x onerror=alert(1)>' }));
    expect(sent[0]!.HtmlBody).not.toContain('<img src=x');
    expect(sent[0]!.HtmlBody).toContain('&lt;img src=x');
  });
});
