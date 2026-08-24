import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A byte pattern that survives transport and does NOT survive `JSON.parse` +
 * `JSON.stringify`: an escaped unicode sequence. Re-serializing turns `\u00e9`
 * into the literal `é`, so its absence is proof the handler re-encoded the body.
 */
const RAW_MARKER = String.raw`\u00e9`;

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

/**
 * Stripe mock. `constructEvent` accepts the header 'valid' — and, like the real
 * one, it verifies over the RAW BYTES.
 *
 * The first version only string-compared the signature, so the raw-body plumbing —
 * the only thing that makes verification work at all — was untested on an
 * unauthenticated money route: passing `JSON.stringify(req.body)` instead of the
 * raw buffer left every test green. Real Stripe would reject that, because a
 * re-serialized body differs from the bytes that were signed (key order,
 * whitespace, unicode escapes).
 */
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({
    webhooks: {
      constructEvent: (raw: Buffer | string, sig: string) => {
        if (sig !== 'valid') throw new Error('signature verification failed');
        const text = raw.toString();
        // Stands in for the HMAC: the bytes we were handed must be the bytes the
        // caller sent, not a re-serialization of the parsed object.
        if (!(raw instanceof Buffer)) throw new Error('signature verification failed: not the raw body');
        if (!text.includes(RAW_MARKER)) throw new Error('signature verification failed: body was re-serialized');
        return JSON.parse(text);
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
import { getBalance, listTransactions, grantCredits, createApp, updateApp, config, creditsForMode, getTemplate } from '@agent-researcher/core';

/**
 * What one essential report actually charges, read off the model rather than
 * written down. Three balances in this file were `20 - 5` and `15 = 3 x 5`, and
 * when essential went 5 -> 8 credits (D1) every one of them was a puzzle to
 * re-derive. The price is a product decision that will move again.
 */
const ESSENTIAL = creditsForMode(getTemplate('florida-business-for-sale')!.modes!.essential!, 'essential');
import { listStripePlans } from '../src/stripe.js';
import { seedApp, token, auth, seedAdmin } from './helpers.js';
import { secondsToNextHour } from '../src/public-limit.js';
import { writableConfig } from './writable-config.js';

function purchaseEvent(
  paymentId: string,
  credits = 15,
  amount = 10000,
  // Real sessions always carry this; the fixture used to omit it, which is why
  // "credit only what was actually paid for" had nothing to assert against.
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required' = 'paid',
) {
  return {
    id: `evt_${paymentId}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${paymentId}`,
        payment_intent: paymentId,
        amount_total: amount,
        currency: 'usd',
        payment_status: paymentStatus,
        // The accented character is deliberate: it is what makes a re-serialized
        // body distinguishable from the raw one.
        metadata: { appId: 'fbizlab', userId: 'u@x.com', planId: 'investor', credits: String(credits), note: 'café' },
      },
    },
  };
}
/**
 * Sent as a STRING, not an object, so the bytes on the wire are ours.
 *
 * `payload: someObject` lets the injector serialize it, which is exactly the
 * re-encoding this test needs to be able to detect — the escaped unicode below
 * survives transport and does not survive a parse/stringify round trip.
 */
const webhook = (event: unknown, sig = 'valid') =>
  app.inject({
    method: 'POST',
    url: '/credits/webhook',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    payload: JSON.stringify(event).replace(/é/g, RAW_MARKER),
  });

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
    // No seeding: `getBalance` reports 0 for an account with no ledger, and a
    // zero-credit grant is a no-op write the store now refuses outright.
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
    // Driven as an ADMIN on purpose. The one-in-flight cap 409s five of six before
    // the ledger is ever consulted, so `ok` was always 1 and `<= 3` was trivially
    // true: raising the cap to six left this green, which means the credit gate —
    // the thing the title is about — was never under concurrency at all.
    //
    // Admins are exempt from the SLOT, not from the price (a standing rule here),
    // so this is the one caller for whom credits are the only bound.
    await seedAdmin(['boss@x.com']);
    await updateApp('fbizlab', { adminEmails: ['boss@x.com'] });
    await grantCredits({ appId: 'fbizlab', userId: 'boss@x.com', credits: ESSENTIAL * 3 });
    const t = await token('fbizlab', 'boss@x.com', 'admin');

    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })),
    );
    const ok = results.filter((r) => r.statusCode === 202).length;
    // The grant buys exactly three essentials — and six requests raced for them.
    //
    // Measured: TWO independent gates hold this — the route's pre-check and the
    // ledger transaction's own — so removing either alone leaves this green and
    // removing both turns it red. Worth knowing before treating it as a regression
    // guard for one of them. The ledger's is the one that would matter under real
    // contention, which this suite cannot produce: the in-memory Firestore
    // serializes transactions, so the race is not modelled here at all.
    expect(ok, 'the slot cap is still doing the bounding, not the credit gate').toBe(3);
    expect(results.filter((r) => r.statusCode === 402).length).toBe(3);
    // The invariant: charged exactly once per accepted job, never negative.
    expect(await getBalance('fbizlab', 'boss@x.com')).toBe(0);
  });

  it('allows only ONE report in flight per user (409 while one is queued/running)', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 20 });
    const t = await token('fbizlab', 'u@x.com');
    const first = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('concurrency_limit');
    // The blocked request cost nothing — only the first job was charged.
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(20 - ESSENTIAL);
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

  it('a limited buyer is told when to come back, and the figure is real', async () => {
    // Both 429s on this page sent `Retry-After: 3600` and no `retryAfterSeconds`
    // at all — the field the client reads. So the credits page could say nothing
    // about when, and the header it did send was wrong by up to an hour in the
    // direction that matters: the bucket is a CALENDAR hour, so someone ninety
    // seconds from the reset was told to come back after lunch.
    const heavy = await token('fbizlab', 'clockwatcher@x.com');
    let blocked;
    // BRACKETED against the test's OWN clock, twice — not against a second call to
    // the function under test.
    //
    // Two defects meet here. The original asserted `toBe(secondsToNextHour())`: the
    // API computes the figure while it answers and the test computed it again while
    // it asserted, and the value drops by one every second, so a run that crossed a
    // second boundary failed with `expected 3234 to be 3233` — both figures right,
    // the comparison wrong. It took the deploy gate down on 2026-08-24 for a commit
    // that touched only hosting headers.
    //
    // The obvious repair — bracket it between two calls to `secondsToNextHour()` —
    // is worse than the flake: mutate that function to the flat `3600` this test
    // exists to forbid and BOTH sides move together, so the bracket holds and the
    // test passes green against the bug. The expectation has to be computed here,
    // from the clock, by a formula this file owns.
    const secondsLeft = () => { const d = new Date(); return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds()); };
    const before = secondsLeft();
    for (let i = 0; i < 62 && !blocked; i++) {
      const r = await app.inject({ method: 'GET', url: '/credits/plans', headers: auth(heavy) });
      if (r.statusCode === 429) blocked = r;
    }
    const after = secondsLeft();
    expect(blocked, 'the cap was never reached').toBeTruthy();
    const wait = blocked!.json().retryAfterSeconds as number;
    expect(wait, 'the client reads this and got undefined').toBeTypeOf('number');
    // The answer was computed between those two samples, so it lies between them —
    // exactly, with no invented tolerance. `after > before` only when the calendar
    // hour rolled over mid-test, and then the bracket says nothing.
    if (after <= before) {
      expect(wait, 'the figure is not the seconds this run had left').toBeLessThanOrEqual(before);
      expect(wait, 'the figure is not the seconds this run had left').toBeGreaterThanOrEqual(after);
    }
    // …and it is the seconds to the top of the CALENDAR hour, never a flat 3600 —
    // the defect this test was written for. Skipped in the one second where 3600 is
    // the honest answer.
    if (before < 3600) expect(wait, 'a flat hour is the bug, not the fix').toBeLessThan(3600);
    expect(String(wait), 'the header and the body must not disagree').toBe(blocked!.headers['retry-after']);

    // …and the same on the button that takes their money.
    const cap = config.publicLimits.checkoutPerHourPerUser;
    writableConfig.publicLimits.checkoutPerHourPerUser = 1;
    try {
      const buyer = await token('fbizlab', 'buyer429@x.com');
      const body = { planId: 'investor', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' };
      await app.inject({ method: 'POST', url: '/credits/checkout', headers: auth(buyer), payload: body });
      const second = await app.inject({ method: 'POST', url: '/credits/checkout', headers: auth(buyer), payload: body });
      expect(second.statusCode).toBe(429);
      expect(second.json().retryAfterSeconds).toBe(secondsToNextHour());
      expect(second.headers['retry-after']).toBe(String(secondsToNextHour()));
      // …in their language, and saying the thing they most need to hear on THIS
      // button: no money moved. It said "Too many checkout attempts. Please try
      // again later." in English, whatever page they were on, and said nothing
      // about the charge (round 10's B item).
      expect(second.json().error).toBe('Too many checkout attempts. Please wait a moment and try again — nothing was charged.');
      const es = await app.inject({
        method: 'POST', url: '/credits/checkout',
        headers: { ...auth(buyer), 'accept-language': 'es' }, payload: body,
      });
      expect(es.statusCode).toBe(429);
      expect(es.json().error).toBe('Demasiados intentos de pago. Espera un momento e inténtalo de nuevo — no se te cobró nada.');
    } finally {
      writableConfig.publicLimits.checkoutPerHourPerUser = cap;
    }
  });

  it('CONCURRENT duplicate webhooks credit only once (no over-credit)', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(purchaseEvent('pi_race', 15))));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(15); // once, not 5×
  });
});

describe('credits wait for the money', () => {
  beforeEach(async () => {
    await createApp({ appId: 'fbizlab', name: 'F', active: true } as never).catch(() => {});
  });

  it('does not credit a session whose payment has not landed', async () => {
    // `checkout.session.completed` fires when the CHECKOUT finished, not when the
    // money arrived: a delayed-notification method (bank debits, vouchers) arrives
    // `unpaid`, and the payment can still fail afterwards.
    const before = await getBalance('fbizlab', 'u@x.com');
    const res = await webhook(purchaseEvent('pi_pending', 15, 10000, 'unpaid'));

    expect(res.statusCode).toBe(200);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(before);
  });

  it('credits it once the async payment succeeds', async () => {
    const before = await getBalance('fbizlab', 'u@x.com');
    await webhook(purchaseEvent('pi_slow', 15, 10000, 'unpaid'));
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(before);

    // Same session object, the event that says it landed.
    const paid = purchaseEvent('pi_slow', 15, 10000, 'paid');
    paid.type = 'checkout.session.async_payment_succeeded';
    await webhook(paid);

    expect(await getBalance('fbizlab', 'u@x.com')).toBe(before + 15);
  });

  it('says so, loudly, when a paid session cannot be attributed (N11)', async () => {
    // Unreachable through our own checkout — it always sets the three metadata
    // fields — but a Payment Link created in the Stripe dashboard hits this same
    // endpoint carrying none of them. The handler skipped the crediting branch and
    // answered 200: money taken, no credits, and NOTHING in the logs to find it by.
    const orphan = purchaseEvent('pi_orphan', 15);
    // Metadata a Payment Link might carry, minus the three fields that say who
    // this is. The accent stays for the raw-body check the `webhook` helper needs.
    orphan.data.object.metadata = { note: 'café' } as never;
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => void errors.push(String(line)));
    try {
      const before = await getBalance('fbizlab', 'u@x.com');
      const res = await webhook(orphan);

      // Still acked: a retry would bring back the same unattributable session.
      expect(res.statusCode).toBe(200);
      expect(await getBalance('fbizlab', 'u@x.com'), 'credited someone at random').toBe(before);

      const logged = errors.map((l) => JSON.parse(l) as Record<string, unknown>);
      const entry = logged.find((e) => e.event === 'credits.purchase_unattributed');
      expect(entry, `nothing was logged; lines seen: ${errors.length}`).toBeTruthy();
      expect(entry!.severity, 'a WARNING nobody pages on').toBe('ERROR');
      // The figure support needs to find the session in Stripe, not just a shrug.
      expect(entry!.amountUsd, 'the log does not say how much was taken').toBe(100);
      expect(entry!.jobId, 'the log does not name the session').toBe('cs_pi_orphan');
    } finally {
      spy.mockRestore();
    }
  });

  it('and an attributable one is not reported as a problem — the control', async () => {
    // "Always log the error" would pass the case above and page on every purchase.
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => void errors.push(String(line)));
    try {
      await webhook(purchaseEvent('pi_normal', 15));
      expect(errors.join(' ')).not.toMatch(/purchase_unattributed/);
    } finally {
      spy.mockRestore();
    }
    expect(await getBalance('fbizlab', 'u@x.com')).toBeGreaterThan(0);
  });

  it('still credits a zero-cost checkout', async () => {
    // A 100% promo code settles as `no_payment_required`, and that IS paid.
    const before = await getBalance('fbizlab', 'u@x.com');
    await webhook(purchaseEvent('pi_free', 5, 0, 'no_payment_required'));
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(before + 5);
  });
});
