import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}) }));

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
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { getBalance, listTransactions, grantCredits } from '@agent-researcher/core';
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
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 3 });
    const t = await token('fbizlab', 'u@x.com');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })),
    );
    const ok = results.filter((r) => r.statusCode === 202).length;
    const denied = results.filter((r) => r.statusCode === 402).length;
    expect(ok).toBe(3); // exactly the affordable number
    expect(denied).toBe(3);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(0); // never negative
  });

  it('CONCURRENT duplicate webhooks credit only once (no over-credit)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(purchaseEvent('pi_race', 15))));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15); // once, not 5×
  });
});
