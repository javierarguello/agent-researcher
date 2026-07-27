/**
 * The unauthenticated endpoints were the only ones with no meter on them, and
 * they are the ones that cost money: each register / reset / contact call sends
 * an email on our Postmark account, and each login runs a password hash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { createApp } from '@agent-researcher/core';
import { burstOk, clientIp, __resetBurst } from '../src/public-limit.js';

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
const post = (url: string, payload: unknown, ip = '203.0.113.9') =>
  app.inject({ method: 'POST', url, payload, headers: { 'x-forwarded-for': `${ip}, 130.211.0.1` } });

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
  it('ignores a forged leading X-Forwarded-For entry', () => {
    // Cloud Run appends: [spoofed, real client, google front end]. With one
    // trusted hop, the entry we keep is the one the front end actually saw.
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 130.211.0.1' }, ip: '10.0.0.1' };
    expect(clientIp(req as never)).toBe('198.51.100.7');
  });

  it('falls back to the socket address with no header', () => {
    expect(clientIp({ headers: {}, ip: '10.0.0.1' } as never)).toBe('10.0.0.1');
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
