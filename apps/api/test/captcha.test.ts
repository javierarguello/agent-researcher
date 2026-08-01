/**
 * Route-level Turnstile enforcement.
 *
 * The guard is generic — routes bind to a flow name and `TURNSTILE_FLOWS` decides
 * which flows are live — so what matters is: does an unsolved request actually
 * get stopped BEFORE the handler runs, on both the anonymous forms and the
 * authenticated report endpoints, and does everything behave exactly as before
 * when Turnstile isn't configured.
 */
import { writableConfig } from './writable-config.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { config, getBalance, grantCredits, listJobs } from '@agent-researcher/core';
import { seedApp, seedAdmin, token, auth } from './helpers.js';

const research = { template: 'florida-business-for-sale', params: { industry: 'laundromats', mode: 'essential' } };

/** Siteverify says yes/no; anything else (Postmark…) is left alone. */
function stubSiteverify(success: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: { body?: string } = {}) => {
      const u = String(url);
      if (u.includes('challenges.cloudflare.com')) {
        return { ok: true, status: 200, json: async () => ({ success, 'error-codes': success ? [] : ['invalid-input-response'] }) } as Response;
      }
      if (u.includes('postmarkapp.com')) return { ok: true, status: 200, text: async () => '{}' } as Response;
      throw new Error(`unexpected fetch: ${u}`);
    }),
  );
}

describe('turnstile — route enforcement', () => {
  beforeEach(async () => {
    await seedApp('fbizlab');
    writableConfig.captcha.secret = 'test-secret'; // configured → the guard is live
  });
  afterEach(() => {
    writableConfig.captcha.secret = '';
    vi.unstubAllGlobals();
  });

  it('blocks a report request with no token (403) and creates no job, charging nothing', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 12 });
    stubSiteverify(true);
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research });

    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('captcha_failed');
    expect(await listJobs('fbizlab', 'u@x.com')).toHaveLength(0);
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(12); // guard runs before the credits gate
  });

  it('lets a solved report request through', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 12 });
    stubSiteverify(true);
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(t),
      payload: { ...research, 'cf-turnstile-response': 'solved-token' },
    });
    expect(r.statusCode).toBe(202);
    expect(await listJobs('fbizlab', 'u@x.com')).toHaveLength(1);
  });

  it('rejects a token Cloudflare refuses (replayed, expired, forged)', async () => {
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 12 });
    stubSiteverify(false);
    const t = await token('fbizlab', 'u@x.com');
    const r = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(t),
      payload: { ...research, 'cf-turnstile-response': 'replayed-token' },
    });
    expect(r.statusCode).toBe(403);
    expect(await listJobs('fbizlab', 'u@x.com')).toHaveLength(0);
  });

  it('guards the preflight too, so previews cannot be scripted either', async () => {
    stubSiteverify(true);
    const t = await token('fbizlab', 'u@x.com');
    expect((await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(t), payload: research })).statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: '/research/preflight',
      headers: auth(t),
      payload: { ...research, 'cf-turnstile-response': 'solved-token' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('guards the anonymous forms, and stops them before any email is sent', async () => {
    stubSiteverify(true);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { appId: 'fbizlab', email: 'new@x.com', password: 'sup3rsecret' } });
    expect(reg.statusCode).toBe(403);

    const contact = await app.inject({ method: 'POST', url: '/contact', payload: { appId: 'fbizlab', name: 'N', email: 'a@x.com', message: 'hi' } });
    expect(contact.statusCode).toBe(403);

    const login = await app.inject({ method: 'POST', url: '/auth/session', payload: { appId: 'fbizlab', provider: 'password', email: 'a@x.com', password: 'x' } });
    expect(login.statusCode).toBe(403);

    const reset = await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'a@x.com' } });
    expect(reset.statusCode).toBe(403);
  });

  it('leaves Google sign-in alone — that button never renders a widget', async () => {
    stubSiteverify(true);
    // No token, provider=google: must reach the handler (401/400 for a bad
    // id_token), never a captcha rejection. Regression test: gating the whole
    // route broke Google login in production.
    const r = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'google', idToken: 'not-a-real-id-token' },
    });
    expect(r.statusCode).not.toBe(403);
    expect(r.json().code).not.toBe('captcha_failed');
  });

  it('accepts the token under either field name', async () => {
    stubSiteverify(true);
    const t = await token('fbizlab', 'u@x.com');
    for (const field of ['cf-turnstile-response', 'captchaToken']) {
      const r = await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(t), payload: { ...research, [field]: 'solved' } });
      expect(r.statusCode, field).toBe(200);
    }
    // …and from a header, for clients that would rather not touch their payload.
    const viaHeader = await app.inject({
      method: 'POST',
      url: '/research/preflight',
      headers: { ...auth(t), 'cf-turnstile-response': 'solved' },
      payload: research,
    });
    expect(viaHeader.statusCode).toBe(200);
  });

  it('enforces only the flows that are switched on', async () => {
    stubSiteverify(true);
    config.captcha.flows.delete('preflight');
    try {
      const t = await token('fbizlab', 'u@x.com');
      expect((await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(t), payload: research })).statusCode).toBe(200);
      // …while a flow still on the list keeps rejecting.
      expect((await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })).statusCode).toBe(403);
    } finally {
      config.captcha.flows.add('preflight');
    }
  });

  it('exempts an app whose UI has no widget — the admin SPA must not be locked out', async () => {
    stubSiteverify(true);
    await seedAdmin(['boss@x.com']);
    // The admin app is not in TURNSTILE_APPS and its own login has no widget.
    const login = await app.inject({ method: 'POST', url: '/auth/session', payload: { appId: 'admin', provider: 'password', email: 'boss@x.com', password: 'x' } });
    expect(login.statusCode).not.toBe(403); // 401 (bad password) — reached the handler
    expect(login.json().code).not.toBe('captcha_failed');

    // An admin session is privileged: it isn't asked to solve anything either.
    const adminToken = await token('admin', 'boss@x.com', 'admin');
    const r = await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(adminToken), payload: research });
    expect(r.statusCode).toBe(200);
  });

  it('is a complete no-op when no secret is configured', async () => {
    writableConfig.captcha.secret = '';
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 12 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('siteverify must not be called'); }));
    const t = await token('fbizlab', 'u@x.com');
    expect((await app.inject({ method: 'POST', url: '/research', headers: auth(t), payload: research })).statusCode).toBe(202);
  });
});
