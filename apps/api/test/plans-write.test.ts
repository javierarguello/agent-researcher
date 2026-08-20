/**
 * The credit packs are edited through the API, and the SYSTEM writes their metadata.
 *
 * The catalog stays in Stripe — reporting, refunds, review — but `appId`,
 * `templateId`, `planId` and `credits` stop being typed by a person in the Stripe
 * dashboard. That is not tidiness: a pack created with `credits` missing takes
 * someone's money and grants nothing, and it is invisible until it does, because a
 * product with bad metadata never appears in `listStripePlans` at all.
 *
 * Two things here are about money and are tested hardest: a Price is never edited
 * (Stripe forbids it, and the old one must keep resolving for a link someone
 * holds), and an amount cannot change without the editor proving they saw the
 * current one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

const { store, calls } = vi.hoisted(() => ({
  /** A tiny Stripe: products by id, each with metadata and a default price. */
  store: {
    products: new Map<string, { id: string; name: string; active: boolean; metadata: Record<string, string>; default_price: { id: string; unit_amount: number } | null }>(),
    seq: 0,
  },
  calls: [] as string[],
}));

/**
 * The SDK is the seam, not our own module.
 *
 * The first version mocked `../src/stripe.js` and spread the real exports over it —
 * which does nothing for `upsertStripePlan`, because a module's INTERNAL call to
 * `stripe()` resolves inside its own scope and never reaches the mocked namespace.
 * The code under test therefore built a real client and called api.stripe.com with
 * a fake key, and every assertion failed on a 401 that came from Stripe. Mocking the
 * package is what puts the fake client where the real one is constructed.
 */
vi.mock('stripe', () => ({
  default: class {
    products = {
      search: async ({ query }: { query: string }) => {
        const app = /metadata\['appId'\]:'([^']+)'/.exec(query)?.[1];
        const plan = /metadata\['planId'\]:'([^']+)'/.exec(query)?.[1];
        const data = [...store.products.values()].filter(
          (p) => p.active && p.metadata.appId === app && (!plan || p.metadata.planId === plan),
        );
        return { data };
      },
      create: async ({ name, metadata }: { name: string; metadata: Record<string, string> }) => {
        calls.push('products.create');
        const id = `prod_${++store.seq}`;
        const p = { id, name, active: true, metadata, default_price: null as null | { id: string; unit_amount: number } };
        store.products.set(id, p);
        return p;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        calls.push('products.update');
        const p = store.products.get(id)!;
        if (patch.name) p.name = patch.name as string;
        if (patch.metadata) p.metadata = patch.metadata as Record<string, string>;
        if (patch.active === false) p.active = false;
        if (patch.default_price) {
          const pid = patch.default_price as string;
          p.default_price = { id: pid, unit_amount: Number(pid.split(':')[1]) };
        }
        return p;
      },
      retrieve: async (id: string) => store.products.get(id)!,
    };
    prices = {
      create: async ({ unit_amount }: { unit_amount: number }) => {
        calls.push('prices.create');
        return { id: `price_${++store.seq}:${unit_amount}`, unit_amount };
      },
    };
  },
}));

import { app } from '../src/index.js';
import { createApp } from '@agent-researcher/core';
import { writableConfig } from './writable-config.js';
import { seedAdmin, token, auth } from './helpers.js';

async function adminToken() {
  await seedAdmin(['boss@x.com']);
  return token('admin', 'boss@x.com', 'admin');
}

const MODEL = 'florida-business-for-sale';
const put = async (planId: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/admin/plans/${planId}`, headers: auth(await adminToken()), payload: body });

const base = { appId: 'fbizlab', templateId: MODEL, name: 'Scout', credits: 20, priceUsd: 29 };

beforeEach(async () => {
  // `stripe()` refuses to build a client without one, and `stripeConfigured()`
  // gates every route below. The value is never sent anywhere: the SDK is mocked.
  writableConfig.stripe.secretKey = 'sk_test_fake';
  store.products.clear();
  store.seq = 0;
  calls.length = 0;
  await createApp({ appId: 'fbizlab', name: 'F', role: 'app', emailFrom: 'x@f.test', webUrl: 'https://f.test' });
});

describe('creating a pack', () => {
  it('writes appId, templateId, planId and credits itself — nobody types them', async () => {
    const r = await put('scout', base);
    expect(r.statusCode).toBe(200);
    const p = [...store.products.values()][0]!;
    expect(p.metadata).toMatchObject({ appId: 'fbizlab', templateId: MODEL, planId: 'scout', credits: '20' });
    expect(r.json().plan).toMatchObject({ planId: 'scout', templateId: MODEL, credits: 20, priceUsd: 29 });
  });

  it('refuses a model that does not exist, before touching Stripe', async () => {
    const r = await put('scout', { ...base, templateId: 'a-model-we-never-shipped' });
    expect(r.statusCode).toBe(404);
    expect(calls, 'it reached Stripe anyway').toEqual([]);
  });

  it('stores the marketing copy under the per-locale keys the reader expects', async () => {
    await put('scout', { ...base, popular: true, sub: { en: 'Curious buyers', es: 'Compradores curiosos' }, features: { en: ['A', 'B'], es: ['C'] } });
    const p = [...store.products.values()][0]!;
    expect(p.metadata.sub).toBe('Curious buyers');
    expect(p.metadata.sub_es).toBe('Compradores curiosos');
    // Pipe-separated, which is what `planFromProduct` splits back.
    expect(p.metadata.features).toBe('A|B');
    expect(p.metadata.features_es).toBe('C');
    expect(p.metadata.popular).toBe('true');
  });
});

describe('changing a price', () => {
  it('is refused without the confirmation, and nothing moves', async () => {
    await put('scout', base);
    calls.length = 0;
    const r = await put('scout', { ...base, priceUsd: 39 });
    expect(r.statusCode).toBe(428);
    expect(r.json().error).toContain('expectedPriceUsd');
    expect(calls.filter((c) => c === 'prices.create'), 'a price was created anyway').toEqual([]);
    expect([...store.products.values()][0]!.default_price!.unit_amount).toBe(2900);
  });

  it('is refused when the editor was shown a stale figure', async () => {
    // Two admins on two screens. The one holding the old number must not win.
    await put('scout', base);
    const r = await put('scout', { ...base, priceUsd: 39, expectedPriceUsd: 19 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/now costs 29/);
  });

  it('creates a NEW price and repoints the default, leaving the old one alive', async () => {
    // Stripe prices are immutable, and the old one must keep resolving: a checkout
    // link someone is holding quotes the amount they will be charged.
    await put('scout', base);
    const before = [...store.products.values()][0]!.default_price!.id;
    const r = await put('scout', { ...base, priceUsd: 39, expectedPriceUsd: 29 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ priceChanged: true, previousPriceUsd: 29 });
    const after = [...store.products.values()][0]!.default_price!;
    expect(after.id).not.toBe(before);
    expect(after.unit_amount).toBe(3900);
  });

  it('needs no confirmation to edit everything EXCEPT the amount', async () => {
    // The guard is on the number a customer is charged, not on the copy. Making an
    // admin re-confirm a typo fix in a feature list is how confirmations get
    // clicked through without reading.
    await put('scout', base);
    calls.length = 0;
    const r = await put('scout', { ...base, name: 'Scout pack', credits: 25 });
    expect(r.statusCode).toBe(200);
    expect(calls.filter((c) => c === 'prices.create')).toEqual([]);
    expect([...store.products.values()][0]!.metadata.credits).toBe('25');
  });
});

describe('listing and retiring', () => {
  it('lists a model’s packs, and the untagged ones that sell for every model', async () => {
    await put('scout', base);
    await put('other', { ...base, planId: 'other', name: 'Other', templateId: MODEL });
    // A pack from before `templateId` existed: it must keep selling.
    store.products.set('prod_legacy', {
      id: 'prod_legacy', name: 'Legacy', active: true,
      metadata: { appId: 'fbizlab', planId: 'legacy', credits: '5' },
      default_price: { id: 'price_l:900', unit_amount: 900 },
    });
    // …and one sold for a DIFFERENT model, which is the case that discriminates:
    // without it the assertion below passes whether or not the filter exists.
    store.products.set('prod_elsewhere', {
      id: 'prod_elsewhere', name: 'Elsewhere', active: true,
      metadata: { appId: 'fbizlab', templateId: 'some-other-model', planId: 'elsewhere', credits: '5' },
      default_price: { id: 'price_e:900', unit_amount: 900 },
    });
    const r = await app.inject({ method: 'GET', url: `/admin/plans?appId=fbizlab&templateId=${MODEL}`, headers: auth(await adminToken()) });
    expect(r.json().plans.map((p: { planId: string }) => p.planId).sort()).toEqual(['legacy', 'other', 'scout']);
    // Unfiltered, the app's whole catalog — the pricing page for a second model.
    const all = await app.inject({ method: 'GET', url: '/admin/plans?appId=fbizlab', headers: auth(await adminToken()) });
    expect(all.json().plans.map((p: { planId: string }) => p.planId).sort()).toEqual(['elsewhere', 'legacy', 'other', 'scout']);
  });

  it('retires a pack by deactivating it, never by deleting it', async () => {
    // Stripe keeps every payment and session attached to the product; a delete
    // would orphan all of them.
    await put('scout', base);
    const r = await app.inject({
      method: 'POST', url: '/admin/plans/scout/archive',
      headers: auth(await adminToken()), payload: { appId: 'fbizlab' },
    });
    expect(r.statusCode).toBe(200);
    expect([...store.products.values()][0]!.active).toBe(false);
    const list = await app.inject({ method: 'GET', url: '/admin/plans?appId=fbizlab', headers: auth(await adminToken()) });
    expect(list.json().plans).toEqual([]);
  });
});

describe('who may touch the catalog', () => {
  /**
   * `requireAdmin` guards all three routes, and it is not the token's word that
   * decides: `jwtAuth` re-reads the app's `adminEmails` on every request and
   * DOWNGRADES the claim when the email is no longer on the list (`auth.ts:141`).
   * So a signed admin token belonging to someone since removed is a user token by
   * the time a route sees it — which is the case worth testing, because it is the
   * one a session-lifetime check gets wrong.
   */
  const user = async () => auth(await token('fbizlab', 'buyer@x.com'));

  it('refuses a buyer on every one of them', async () => {
    const attempts = [
      app.inject({ method: 'GET', url: '/admin/plans?appId=fbizlab', headers: await user() }),
      app.inject({ method: 'PUT', url: '/admin/plans/scout', headers: await user(), payload: base }),
      app.inject({ method: 'POST', url: '/admin/plans/scout/archive', headers: await user(), payload: { appId: 'fbizlab' } }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.statusCode).toBe(403);
    expect(store.products.size, 'a refused request still wrote to Stripe').toBe(0);
  });

  it('refuses an unauthenticated request', async () => {
    const r = await app.inject({ method: 'PUT', url: '/admin/plans/scout', payload: base, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(401);
    expect(store.products.size).toBe(0);
  });

  it('refuses a token that CLAIMS admin for an app whose whitelist it is not on', async () => {
    // The downgrade. `signSession({ role: 'admin' })` is easy to mint from anywhere
    // that has the secret — a leaked worker key, an old script — and the role on the
    // claim is not the role that is enforced.
    await seedAdmin(['boss@x.com']);
    const impostor = auth(await token('admin', 'someone-else@x.com', 'admin'));
    const r = await app.inject({ method: 'PUT', url: '/admin/plans/scout', headers: impostor, payload: base });
    expect(r.statusCode).toBe(403);
    expect(store.products.size).toBe(0);
  });
});
