import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({ checkout: { sessions: { create: async () => ({ id: 'cs', url: 'https://x' }) } } }),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { grantCredits, getBalance, listJobs, updateApp } from '@agent-researcher/core';
import { seedApp, seedAdmin, token, auth } from './helpers.js';

const research = { template: 'florida-business-for-sale', params: { industry: 'laundromats', mode: 'essential' } };

describe('API security — auth, credits gate, isolation', () => {
  beforeEach(async () => {
    await seedApp('fbizlab');
  });

  it('rejects requests without a token (401)', async () => {
    const r = await app.inject({ method: 'POST', url: '/research', payload: research });
    expect(r.statusCode).toBe(401);
  });

  it('BLOCKS report generation with no credits (402) and creates no job', async () => {
    const t = await token('fbizlab', 'poor@x.com');
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(r.statusCode).toBe(402);
    expect(await listJobs('fbizlab', 'poor@x.com')).toHaveLength(0);
  });

  it('allows generation with credits and consumes exactly one (essential = 1)', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 3 });
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(r.statusCode).toBe(202);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(2);
    expect(await listJobs('fbizlab', 'u@x.com')).toHaveLength(1);
  });

  it('identity comes from the token — body appId/userId are ignored (no spoofing)', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'real@x.com', credits: 1 });
    const t = await token('fbizlab', 'real@x.com');
    // Attacker tries to bill another app/user and impersonate.
    const r = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(t),
      payload: { ...research, appId: 'victim-app', userId: 'victim@x.com' },
    });
    expect(r.statusCode).toBe(202);
    // The job + charge landed on the TOKEN identity, not the body's.
    expect(await listJobs('fbizlab', 'real@x.com')).toHaveLength(1);
    expect(await listJobs('victim-app', 'victim@x.com')).toHaveLength(0);
    expect(await getBalance('fbizlab', 'real@x.com')).toBe(0);
  });

  it("a user cannot read another user's report (403)", async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'alice@x.com', credits: 1 });
    const ta = await token('fbizlab', 'alice@x.com');
    const created = await app.inject({ method: 'POST', url: '/research', headers: auth(ta), payload: research });
    const { jobId } = created.json() as { jobId: string };

    const tb = await token('fbizlab', 'bob@x.com');
    const r = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(tb) });
    expect(r.statusCode).toBe(403);
  });

  it("a user's balance query returns their own balance, not another's", async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'alice@x.com', credits: 9 });
    const tb = await token('fbizlab', 'bob@x.com');
    // Bob tries to read Alice's balance via a query param — ignored for non-admins.
    const r = await app.inject({ method: 'GET', url: '/credits/balance?userId=alice@x.com', headers: auth(tb) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ userId: 'bob@x.com', balance: 0 });
  });

  it('rejects oversized research params at the validation layer (400), no job created', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 1 });
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(t),
      payload: { template: 'florida-business-for-sale', params: { mode: 'essential', instructions: 'x'.repeat(3000) } },
    });
    expect(r.statusCode).toBe(400);
    expect(await listJobs('fbizlab', 'u@x.com')).toHaveLength(0);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(1); // not charged
  });

  it('GET /templates is scoped to the app allowedTemplates; /:id is 403 for disallowed', async () => {
    const t = await token('fbizlab', 'u@x.com');
    // No restriction → the model is visible.
    expect((await app.inject({ method: 'GET', url: '/templates', headers: auth(t) })).json().templates.map((x: any) => x.id))
      .toContain('florida-business-for-sale');

    // Restrict to a model this app doesn't include → list is empty, /:id is 403.
    await updateApp('fbizlab', { allowedTemplates: ['some-other-model'] });
    expect((await app.inject({ method: 'GET', url: '/templates', headers: auth(t) })).json().templates).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/templates/florida-business-for-sale', headers: auth(t) })).statusCode).toBe(403);
  });

  it('template manifest carries modes+credits and localizes to ?lang', async () => {
    const t = await token('fbizlab', 'u@x.com');
    const en = (await app.inject({ method: 'GET', url: '/templates/florida-business-for-sale', headers: auth(t) })).json();
    expect(en.lang).toBe('en');
    expect(en.modes).toEqual([
      { key: 'essential', label: 'Essential', credits: 1 },
      { key: 'comprehensive', label: 'Comprehensive', credits: 2 },
    ]);
    const es = (await app.inject({ method: 'GET', url: '/templates/florida-business-for-sale?lang=es', headers: auth(t) })).json();
    expect(es.lang).toBe('es');
    expect(es.name).toContain('Negocios');
    expect(es.modes[0].label).toBe('Esencial');
    // Unknown lang falls back to en.
    const xx = (await app.inject({ method: 'GET', url: '/templates/florida-business-for-sale?lang=zz', headers: auth(t) }));
    expect(xx.statusCode).toBe(400); // enum-validated query rejects an unsupported lang
  });

  it("rejects a research model not in the app's allowedTemplates (403); admin is exempt", async () => {
    await updateApp('fbizlab', { allowedTemplates: ['some-other-model'] });
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 5 });
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });
    expect(r.statusCode).toBe(403);

    // The admin app is exempt from the model restriction.
    await seedAdmin(['boss@x.com']);
    const admin = await token('admin', 'boss@x.com', 'admin');
    const ra = await app.inject({ method: 'POST', url: '/research', headers: auth(admin), payload: research });
    expect(ra.statusCode).not.toBe(403); // passes the model check (then 402 for no credits)
  });

  it('admin-only endpoints reject non-admin tokens (403) and allow admin', async () => {
    await seedAdmin(['boss@x.com']);
    const user = await token('fbizlab', 'u@x.com', 'user');
    expect((await app.inject({ method: 'GET', url: '/admin/apps', headers: auth(user) })).statusCode).toBe(403);

    const admin = await token('admin', 'boss@x.com', 'admin');
    expect((await app.inject({ method: 'GET', url: '/admin/apps', headers: auth(admin) })).statusCode).toBe(200);
  });
});
