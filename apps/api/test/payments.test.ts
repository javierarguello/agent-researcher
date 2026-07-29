import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

// Stripe mock: constructEvent trusts the signature header 'valid' and parses the
// raw body; checkout returns a session; resolveStripePlan returns a fixed plan.
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({
    webhooks: {
      constructEvent: (raw: Buffer | string, sig: string) => {
        if (sig !== 'valid') throw new Error('signature verification failed');
        return JSON.parse(raw.toString());
      },
    },
    checkout: { sessions: { create: async (args: Record<string, unknown>) => ({ id: 'cs_test_1', url: 'https://checkout/x', ...args }) } },
  }),
  resolveStripePlan: async (appId: string, planId: string) =>
    planId === 'investor'
      ? { planId: 'investor', name: 'Investor', priceUsd: 100, credits: 15, priceId: 'price_1', appId }
      : undefined,
  listStripePlans: vi.fn(async (appId: string) =>
    appId === 'fbizlab'
      ? [{ planId: 'scout', name: 'Scout', priceUsd: 19, credits: 3, priceId: 'price_s', popular: true, sub: 'Curious buyers', features: ['3 reports', 'Discovery'] }]
      : [],
  ),
  isValidAppId: (appId: string) => /^[a-z0-9][a-z0-9-_]{0,63}$/.test(appId),
}));

import { app } from '../src/index.js';
import { getBalance, listTransactions, grantCredits, createApp } from '@agent-researcher/core';
import { listStripePlans } from '../src/stripe.js';
import { seedApp, token, auth } from './helpers.js';

function purchaseEvent(paymentId: string, credits = 15, amount = 10000) {
  return {
    id: `evt_${paymentId}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${paymentId}`,
        payment_intent: paymentId,
        amount_total: amount,
        currency: 'usd',
        metadata: { appId: 'fbizlab', userId: 'u@x.com', planId: 'investor', credits: String(credits) },
      },
    },
  };
}
const webhook = (event: unknown, sig = 'valid') =>
  app.inject({ method: 'POST', url: '/credits/webhook', headers: { 'stripe-signature': sig, 'content-type': 'application/json' }, payload: event as object });

const research = { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } };

describe('payments — credits load exactly, idempotently, and safely', () => {
  beforeEach(async () => {
    await seedApp('fbizlab');
  });

  it('a valid webhook grants exactly the plan credits', async () => {
    const r = await webhook(purchaseEvent('pi_1', 15));
    expect(r.statusCode).toBe(200);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
  });

  it('does NOT double-credit on webhook retries (idempotent by paymentId)', async () => {
    await webhook(purchaseEvent('pi_1', 15));
    await webhook(purchaseEvent('pi_1', 15)); // Stripe retries the same event
    await webhook(purchaseEvent('pi_1', 15));
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
    const purchases = (await listTransactions('fbizlab', 'u@x.com', 20)).filter((t) => t.type === 'purchase');
    expect(purchases).toHaveLength(1);
  });

  it('rejects a webhook with an invalid signature and grants nothing (400)', async () => {
    const r = await webhook(purchaseEvent('pi_bad', 15), 'forged');
    expect(r.statusCode).toBe(400);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(0);
  });

  it('checkout returns a session and the plan credit amount', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 0 });
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({
      method: 'POST',
      url: '/credits/checkout',
      headers: auth(t),
      payload: { planId: 'investor', successUrl: 'https://ok', cancelUrl: 'https://no' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ credits: 15 });
  });

  it('CONCURRENT report requests never over-spend credits (no double-spend)', async () => {
    // Essential costs 5 → exactly 3 of 6 concurrent requests are affordable with 15.
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 15 });
    const t = await token('fbizlab', 'u@x.com');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })),
    );
    // With the 1-in-flight-per-user concurrency limit + credit gate, the exact
    // number that slip through is bounded; the INVARIANT is what matters — the
    // ledger is charged exactly once per accepted job and never goes negative.
    const ok = results.filter((r) => r.statusCode === 202).length;
    expect(ok).toBeGreaterThanOrEqual(1);
    expect(ok).toBeLessThanOrEqual(3); // never more than credits (15/5) allow
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15 - ok * 5); // spent exactly, no double-spend
  });

  it('allows only ONE report in flight per user (409 while one is queued/running)', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    const t = await token('fbizlab', 'u@x.com');
    const first = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('concurrency_limit');
    // The blocked request cost nothing — only the first job was charged (20 − 5).
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15);
  });

  it('GET /plans is public (no auth) and Stripe-sourced', async () => {
    const r = await app.inject({ method: 'GET', url: '/plans?appId=fbizlab' }); // no Authorization header
    expect(r.statusCode).toBe(200);
    expect(r.json().plans).toHaveLength(1);
    expect(r.json().plans[0]).toMatchObject({ planId: 'scout', credits: 3, popular: true });
    // Short browser cache with background revalidation (not a long, un-purgeable TTL).
    expect(r.headers['cache-control']).toContain('stale-while-revalidate');
  });

  it('an unknown appId is refused WITHOUT reaching Stripe', async () => {
    // This is the amplifier fix. An unknown app used to miss the cache by
    // construction (empty results were deliberately not stored), so a fresh appId
    // per request bought a live Stripe call per request — on the one public route
    // with no meter, and Stripe throttling us stops customers from checking out.
    vi.mocked(listStripePlans).mockClear();
    const r = await app.inject({ method: 'GET', url: '/plans?appId=nope-not-an-app' });
    expect(r.statusCode).toBe(404);
    expect(listStripePlans).not.toHaveBeenCalled();
  });

  it('a malformed appId is refused before it can reach the Stripe query language', async () => {
    vi.mocked(listStripePlans).mockClear();
    // A quote would break out of the literal in `metadata['appId']:'<appId>'`.
    const r = await app.inject({ method: 'GET', url: `/plans?appId=${encodeURIComponent("x' OR active:'true")}` });
    expect(r.statusCode).toBe(400);
    expect(listStripePlans).not.toHaveBeenCalled();
  });

  it('a known app with an empty catalog stays no-store, so a fix propagates fast', async () => {
    await createApp({ appId: 'empty-app', name: 'Empty', role: 'app' });
    const r = await app.inject({ method: 'GET', url: '/plans?appId=empty-app' });
    expect(r.statusCode).toBe(200);
    expect(r.json().plans).toHaveLength(0);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('an empty catalog is cached briefly, so repeat requests do not each hit Stripe', async () => {
    // The third pillar of the amplifier fix, and the easiest to delete by accident:
    // the `no-store` header above is derived from plans.length, not from cache
    // state, so it passes with or without the short TTL. This asserts the call count.
    await createApp({ appId: 'empty-app', name: 'Empty', role: 'app' });
    vi.mocked(listStripePlans).mockClear();
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/plans?appId=empty-app' })).statusCode).toBe(200);
    }
    expect(listStripePlans).toHaveBeenCalledTimes(1);
  });

  it('/credits/plans is metered per user and shares the public cache line', async () => {
    // The route the product UI actually calls. It was left uncached and unmetered
    // while the public one was fixed — the more-used door of the two.
    vi.mocked(listStripePlans).mockClear();
    const t = await token('fbizlab', 'shopper@x.com');
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/credits/plans', headers: auth(t) })).statusCode).toBe(200);
    }
    expect(listStripePlans).toHaveBeenCalledTimes(1); // cached, not one Stripe call each

    // …and the cache line is shared with the public route, not a parallel one.
    await app.inject({ method: 'GET', url: '/plans?appId=fbizlab' });
    expect(listStripePlans).toHaveBeenCalledTimes(1);
  });

  it('one user hammering /credits/plans is limited without affecting anyone else', async () => {
    const heavy = await token('fbizlab', 'heavy@x.com');
    let limited = 0;
    for (let i = 0; i < 62; i++) {
      const r = await app.inject({ method: 'GET', url: '/credits/plans', headers: auth(heavy) });
      if (r.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0); // the cap (60/h/user) is real

    // Metered per user, so a different customer is untouched.
    const other = await token('fbizlab', 'other@x.com');
    expect((await app.inject({ method: 'GET', url: '/credits/plans', headers: auth(other) })).statusCode).toBe(200);
  });

  it('CONCURRENT duplicate webhooks credit only once (no over-credit)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(purchaseEvent('pi_race', 15))));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15); // once, not 5×
  });
});
