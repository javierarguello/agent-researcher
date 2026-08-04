/**
 * The unauthenticated endpoints were the only ones with no meter on them, and
 * they are the ones that cost money: each register / reset / contact call sends
 * an email on our Postmark account, and each login runs a password hash.
 */
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { writableConfig } from './writable-config.js';
import { app } from '../src/index.js';
import { createApp, grantCredits } from '@agent-researcher/core';
import { seedApp, token, auth } from './helpers.js';
import { burstOk, clientIp, __resetBurst } from '../src/public-limit.js';
import { config } from '@agent-researcher/core';

const sent: unknown[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: unknown, init: { body?: string } = {}) => {
    if (String(url).includes('postmarkapp.com')) {
      sent.push(JSON.parse(init.body ?? '{}'));
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }),
);

const seed = () => createApp({ appId: 'fbizlab', name: 'F', role: 'app', emailFrom: 'no-reply@f.test', webUrl: 'https://f.test' });
// The shape this deployment actually receives: Cloud Run appends the peer, so the
// last entry is the real client. (A load balancer would add one more; see the
// `client IP resolution` cases below.)
const post = (url: string, payload: InjectOptions['payload'], ip = '203.0.113.9'): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, payload, headers: { 'x-forwarded-for': ip } });

describe('public endpoints — rate limits', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seed();
  });

  it('caps registrations per IP (429) — limit 5 in the test env', async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await post('/auth/register', { appId: 'fbizlab', email: `u${i}@x.com`, password: 'sup3rsecret' });
      expect(r.statusCode).toBe(202);
    }
    const blocked = await post('/auth/register', { appId: 'fbizlab', email: 'u6@x.com', password: 'sup3rsecret' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(sent).toHaveLength(5); // the 6th never reached Postmark
  });

  it('caps registrations per target email, so one inbox cannot be bombed from many IPs', async () => {
    // Registration is the more expensive of the two email routes AND the target is
    // fully attacker-chosen, so rotating IPs must not buy more sends.
    const victim = { appId: 'fbizlab', email: 'victim@x.com', password: 'sup3rsecret' };
    for (let i = 1; i <= 3; i++) {
      expect((await post('/auth/register', victim, `198.51.100.${i}`)).statusCode).toBe(202);
    }
    const blocked = await post('/auth/register', victim, '198.51.100.99');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().scope).toBe('target');
    expect(sent).toHaveLength(3); // the 4th never reached Postmark
  });

  it('the per-target cap cannot be split with dots or a +tag', async () => {
    for (let i = 1; i <= 3; i++) {
      await post('/auth/register', { appId: 'fbizlab', email: 'vic.tim@gmail.com', password: 'sup3rsecret' }, `203.0.113.${i}`);
    }
    // Same inbox, written differently — must land in the same bucket.
    const blocked = await post('/auth/register', { appId: 'fbizlab', email: 'victim+promo@gmail.com', password: 'sup3rsecret' }, '203.0.113.99');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().scope).toBe('target');
  });

  it('caps password resets per target email, so one inbox cannot be bombed from many IPs', async () => {
    const target = { appId: 'fbizlab', email: 'victim@x.com' };
    for (let i = 1; i <= 3; i++) {
      expect((await post('/auth/request-password-reset', target, `198.51.100.${i}`)).statusCode).toBe(202);
    }
    const blocked = await post('/auth/request-password-reset', target, '198.51.100.99');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().scope).toBe('target');
  });

  it('caps contact-form submissions per IP', async () => {
    const msg = { appId: 'fbizlab', name: 'N', email: 'a@x.com', message: 'hello' };
    for (let i = 1; i <= 3; i++) expect((await post('/contact', msg)).statusCode).toBe(202);
    expect((await post('/contact', msg)).statusCode).toBe(429);
  });

  it('caps login attempts against a single account', async () => {
    const creds = { appId: 'fbizlab', provider: 'password', email: 'target@x.com', password: 'wrong-guess' };
    for (let i = 1; i <= 5; i++) expect((await post('/auth/session', creds)).statusCode).toBe(401);
    expect((await post('/auth/session', creds)).statusCode).toBe(429);
  });

  it('does not limit authenticated routes', async () => {
    for (let i = 1; i <= 10; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });
});

describe('client IP resolution', () => {
  // The whole per-IP layer rests on this one index. Getting it wrong is silent:
  // limits still "work" in tests while production keys on a header the caller
  // writes. These cases are the two real topologies, pinned explicitly.
  const withHops = <T>(hops: number, fn: () => T): T => {
    const prev = config.server.proxyHops;
    (config.server as { proxyHops: number }).proxyHops = hops;
    try {
      return fn();
    } finally {
      (config.server as { proxyHops: number }).proxyHops = prev;
    }
  };

  it('direct on *.run.app (this deployment): takes the entry Cloud Run appended', () => {
    // The caller sent "1.2.3.4"; Cloud Run appended the real peer after it.
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }, ip: '10.0.0.1' };
    expect(withHops(0, () => clientIp(req as never))).toBe('198.51.100.7');
  });

  it('a forged header cannot change the key, however many entries it carries', () => {
    const forged = Array.from({ length: 20 }, (_, i) => `1.2.3.${i}`).join(', ');
    const req = { headers: { 'x-forwarded-for': `${forged}, 198.51.100.7` }, ip: '10.0.0.1' };
    expect(withHops(0, () => clientIp(req as never))).toBe('198.51.100.7');
  });

  it('behind a load balancer: drops the LB entry and takes what it saw', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 130.211.0.1' }, ip: '10.0.0.1' };
    expect(withHops(1, () => clientIp(req as never))).toBe('198.51.100.7');
  });

  it('falls back to the socket address with no header', () => {
    expect(clientIp({ headers: {}, ip: '10.0.0.1' } as never)).toBe('10.0.0.1');
  });

  it('never returns a caller-supplied value when the header holds only forged entries', () => {
    // No infrastructure hop at all (impossible in prod, but must not fail open).
    const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' };
    expect(withHops(1, () => clientIp(req as never))).toBe('10.0.0.1');
  });
});

describe('burst isolation', () => {
  it('a busy read-only route cannot lock a whole NAT out of signing in', async () => {
    // The burst window is shared across public routes on purpose, so a flood can't
    // be spread across them. But a legitimately busy read-only route would then
    // exhaust it for everyone behind one egress IP — a corporate NAT is a single
    // address to us — so /plans gets its own window.
    __resetBurst();
    const ip = '198.51.100.42';
    // Enough to exhaust the window, whatever the environment sets it to. The old
    // count was 40 against a test limit of 500, so the flood never happened and the
    // isolation it claimed to prove was never exercised.
    const flood = config.publicLimits.burstPerMinute + 5;
    for (let i = 0; i < flood; i++) {
      await app.inject({ method: 'GET', url: '/plans?appId=fbizlab', headers: { 'x-forwarded-for': ip } });
    }
    // Same IP, an auth route: must still be served.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'password', email: 'someone@x.com', password: 'x' },
      headers: { 'x-forwarded-for': ip },
    });
    expect(login.statusCode).not.toBe(429);
  });
});

describe('burst guard', () => {
  it('blocks a flood from one IP inside the minute, and lets others through', () => {
    __resetBurst();
    const now = Date.now();
    for (let i = 0; i < 3; i++) expect(burstOk('9.9.9.9', 3, now)).toBe(true);
    expect(burstOk('9.9.9.9', 3, now)).toBe(false);
    expect(burstOk('8.8.8.8', 3, now)).toBe(true); // unrelated caller unaffected
    expect(burstOk('9.9.9.9', 3, now + 61_000)).toBe(true); // window rolled over
  });
});

describe('the preview route is metered like every other public one', () => {
  it('stops an IP that keeps asking', async () => {
    // It had NO meter: 60 consecutive calls all returned 200, at roughly five
    // Firestore reads each, on the one route where every sibling carries one in
    // addition to its captcha.
    await seedApp('fbizlab');
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 50 });
    const t = await token('fbizlab', 'u@x.com');
    const body = { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } };

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(t), payload: body })).statusCode);
    }
    // PUBLIC_PREFLIGHT_PER_HOUR_IP=4 in this suite.
    expect(codes.filter((c) => c === 429).length, `saw ${codes.join(',')}`).toBeGreaterThan(0);
    expect(codes.filter((c) => c !== 429).length).toBeLessThanOrEqual(4);
  });
});

describe('the captcha does not pay for an attacker’s burst', () => {
  it('refuses on the burst window before calling Cloudflare', async () => {
    // `verifyCaptcha` is an outbound call holding a 5s timeout, and it ran BEFORE
    // any rate limit because the limit lives in the route guard and the captcha is
    // a preHandler. 80 registrations with a junk token produced 80 outbound calls:
    // the attacker spends one HTTP request, we spend a socket and five seconds.
    const secret = config.captcha.secret;
    const hadFlow = config.captcha.flows.has('register');
    const burst = config.publicLimits.burstPerMinute;
    writableConfig.captcha.secret = 'sekret';
    // A `Set` survives the readonly mapping intact, so it is mutated through
    // `config` — `Writable<T>` recurses into it and breaks `.add`.
    config.captcha.flows.add('register');
    writableConfig.publicLimits.burstPerMinute = 3;
    __resetBurst();
    const calls = { n: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => { calls.n += 1; return new Response(JSON.stringify({ success: false }), { status: 200 }); }));

    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      codes.push((await app.inject({
        method: 'POST', url: '/auth/register',
        payload: { appId: 'fbizlab', email: `b${i}@x.com`, password: 'sup3rsecret', captchaToken: 'junk' },
      })).statusCode);
    }

    expect(codes.filter((c) => c === 429).length, `saw ${codes.join(',')}`).toBeGreaterThan(0);
    // The point of the ordering: the outbound calls stop when the burst does.
    expect(calls.n, 'we kept calling Cloudflare for every request past the limit').toBeLessThanOrEqual(3);

    vi.unstubAllGlobals();
    writableConfig.captcha.secret = secret;
    if (!hadFlow) config.captcha.flows.delete('register');
    writableConfig.publicLimits.burstPerMinute = burst;
    __resetBurst();
  });
});
