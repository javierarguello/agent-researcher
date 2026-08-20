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
import { burstOk, clientIp, publicLimit, secondsToNextHour, __resetBurst } from '../src/public-limit.js';
import { config } from '@agent-researcher/core';

const sent: unknown[] = [];
/**
 * The file-level `fetch`, reinstalled by name rather than by
 * `vi.unstubAllGlobals()`.
 *
 * Two cases here stub `fetch` again to watch the captcha's outbound calls, and
 * unstubbing ALL globals removed this one too — so the next test's Postmark send
 * hit the real `fetch` and the route 500'd. A restore that reaches past its own
 * scope is the same defect as no restore at all.
 */
function installFetch(): void {
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
}
installFetch();

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

  it('meters its own bucket, not somebody else’s', async () => {
    // Neither the counter key nor the config key was pinned, so pointing this
    // route at `register`'s meter survived — and `toBeLessThanOrEqual(4)` cannot
    // tell 4 from 3. Exhausting preflight must leave registration working.
    await seedApp('fbizlab');
    await grantCredits({ appId: 'fbizlab', userId: 'bucket@x.com', credits: 50 });
    const t = await token('fbizlab', 'bucket@x.com');
    const body = { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } };
    for (let i = 0; i < 6; i++) {
      await app.inject({ method: 'POST', url: '/research/preflight', headers: { ...auth(t), 'x-forwarded-for': '198.51.100.22' }, payload: body });
    }

    // `seedApp` has no `emailFrom`; the register route needs the one `seed()` writes.
    await seed();
    // TWO of them, and that is the point: preflight allows 4/hour and register 5,
    // so a single registration lands on the 5th slot and passes even when the two
    // routes share a counter. The second is what tells them apart.
    const codes2: number[] = [];
    for (const email of ['after-bucket-1@x.com', 'after-bucket-2@x.com']) {
      codes2.push((await app.inject({
        method: 'POST', url: '/auth/register',
        headers: { 'x-forwarded-for': '198.51.100.22' },
        payload: { appId: 'fbizlab', email, password: 'sup3rsecret' },
      })).statusCode);
    }
    expect(codes2, 'preflight is spending registration’s hourly allowance').toEqual([202, 202]);
  });

  it('caps a USER who moves between IPs', async () => {
    // It was metered per IP only — on an AUTHENTICATED route, where every other
    // multi-dimension meter in the API pairs an IP cap with one on the identity.
    // An IP is shared by many users and a user is not tied to one IP; five
    // Firestore reads a call is per-user work.
    await seedApp('fbizlab');
    await grantCredits({ appId: 'fbizlab', userId: 'roamer@x.com', credits: 50 });
    const t = await token('fbizlab', 'roamer@x.com');
    const body = { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } };
    const perUser = config.publicLimits.preflightPerHourPerUser;
    writableConfig.publicLimits.preflightPerHourPerUser = 4;

    const codes: number[] = [];
    try {
    for (let i = 0; i < 6; i++) {
      // A different address every time, so the per-IP cap can never be what bites.
      codes.push((await app.inject({
        method: 'POST', url: '/research/preflight',
        headers: { ...auth(t), 'x-forwarded-for': `198.51.100.${100 + i}` },
        payload: body,
      })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length, `saw ${codes.join(',')}`).toBeGreaterThan(0);
    } finally {
      writableConfig.publicLimits.preflightPerHourPerUser = perUser;
    }
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
    try {
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
    } finally {
      // In a `finally`, because these are GLOBAL: `captcha.secret`, the enabled
      // flow set, the burst limit and the `fetch` stub all leaked out of this
      // block, so one real failure here silently rewrote the environment for
      // whichever describe happened to run next. `withHops` in this same file
      // does it correctly.
      installFetch();
      writableConfig.captcha.secret = secret;
      if (!hadFlow) config.captcha.flows.delete('register');
      writableConfig.publicLimits.burstPerMinute = burst;
      __resetBurst();
    }
  });

  it('counts it ONCE, not once in each place', async () => {
    // The preHandler counts, the route guard counts — and if the guard does not
    // know the preHandler already did, every captcha'd route's burst limit is
    // halved for everybody. The first version stored a boolean for exactly this,
    // and then a second bug made the boolean the wrong thing to store.
    const secret = config.captcha.secret;
    const hadFlow = config.captcha.flows.has('register');
    const burst = config.publicLimits.burstPerMinute;
    writableConfig.captcha.secret = 'sekret';
    config.captcha.flows.add('register');
    writableConfig.publicLimits.burstPerMinute = 4;
    __resetBurst();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body?: string } = {}) => {
      if (String(url).includes('postmarkapp.com')) { sent.push(JSON.parse(init.body ?? '{}')); return { ok: true, status: 200, text: async () => '{}' } as Response; }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    try {
      await seed();
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await app.inject({
          method: 'POST', url: '/auth/register',
          headers: { 'x-forwarded-for': '198.51.100.44' },
          payload: { appId: 'fbizlab', email: `once${i}@x.com`, password: 'sup3rsecret', captchaToken: 'ok' },
        })).statusCode);
      }
      // Four allowed per minute means four get through, not two.
      expect(codes.filter((c) => c === 429), `saw ${codes.join(',')}`).toEqual([]);
    } finally {
      installFetch();
      writableConfig.captcha.secret = secret;
      if (!hadFlow) config.captcha.flows.delete('register');
      writableConfig.publicLimits.burstPerMinute = burst;
      __resetBurst();
    }
  });

  it('counts a captcha’d request into the window its ROUTE uses', async () => {
    // `burstOkOnce` stored a boolean, so it always counted against the SHARED
    // window and the route guard then skipped its own check entirely. A captcha'd
    // route asking for `isolatedBurst` got neither: it consumed the window that
    // meters sign-in and registration, and its own stayed empty.
    //
    // That is the CGNAT lockout `public-limit.ts` documents — one active session
    // on a busy read route locking out everyone behind the same egress address.
    const secret = config.captcha.secret;
    const hadFlow = config.captcha.flows.has('preflight');
    const burst = config.publicLimits.burstPerMinute;
    writableConfig.captcha.secret = 'sekret';
    config.captcha.flows.add('preflight');
    writableConfig.publicLimits.burstPerMinute = 3;
    __resetBurst();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    try {
      await seedApp('fbizlab');
      await grantCredits({ appId: 'fbizlab', userId: 'iso@x.com', credits: 50 });
      const t = await token('fbizlab', 'iso@x.com');
      const body = { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } };

      // Exhaust preflight's own window, and then some.
      for (let i = 0; i < 6; i++) {
        await app.inject({
          method: 'POST', url: '/research/preflight',
          headers: { ...auth(t), 'x-forwarded-for': '198.51.100.7' },
          payload: { ...body, captchaToken: 'ok' },
        });
      }

      // …and registration from the SAME address is still available, because the
      // shared window was never touched.
      const r = await app.inject({
        method: 'POST', url: '/auth/register',
        headers: { 'x-forwarded-for': '198.51.100.7' },
        payload: { appId: 'fbizlab', email: 'after-iso@x.com', password: 'sup3rsecret', captchaToken: 'ok' },
      });
      expect(r.statusCode, 'preflight ate the window that meters sign-up').not.toBe(429);
    } finally {
      installFetch();
      writableConfig.captcha.secret = secret;
      if (!hadFlow) config.captcha.flows.delete('preflight');
      writableConfig.publicLimits.burstPerMinute = burst;
      __resetBurst();
    }
  });
});

describe('a 429 tells the truth about itself', () => {
  it('says how long to wait, and it is the real figure', async () => {
    // `ApiError.retryAfterSeconds` has been read off the body since it was
    // written, and no limit in `public-limit.ts` ever sent it — so it was
    // permanently `undefined` and nothing could tell a user when to come back.
    //
    // And the bucket is a CALENDAR hour (`yyyy-mm-ddTHH`), not a sliding window,
    // so the flat `3600` was wrong by up to an hour in the direction that matters:
    // it told someone who could retry in ninety seconds to come back tomorrow.
    await seed();
    for (let i = 1; i <= 5; i++) {
      await post('/auth/register', { appId: 'fbizlab', email: `w${i}@x.com`, password: 'sup3rsecret' }, '203.0.113.77');
    }
    const blocked = await post('/auth/register', { appId: 'fbizlab', email: 'w6@x.com', password: 'sup3rsecret' }, '203.0.113.77');
    expect(blocked.statusCode).toBe(429);

    const wait = blocked.json().retryAfterSeconds as number;
    expect(wait, 'the client reads this and got undefined').toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
    expect(String(wait), 'the header and the body must not disagree').toBe(blocked.headers['retry-after']);
    // The honest figure tracks the clock; a hardcoded 3600 only matches in the
    // first second of an hour.
    expect(wait).toBe(secondsToNextHour());
  });

  it('says it in the person’s language, on every 429 a buyer can reach', async () => {
    // Four 429s in the product answered in hand-written English — the captcha burst
    // window, every public endpoint, the plans list and the checkout button — on the
    // three doors a NEW buyer walks through first: register, sign in, pay. The
    // report route's was the only one that ever spoke their language.
    //
    // The language comes from `errorLang`: `body.lang`, then `?lang=`, then
    // `Accept-Language` — which the SPA now sets to the language its switcher is on,
    // because the browser's own value is `en` for a Spanish speaker on a US laptop.
    await seed();
    const fr = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { appId: 'fbizlab', email: `l${ip}@x.com`, password: 'sup3rsecret' },
        headers: { 'x-forwarded-for': ip, 'accept-language': 'fr' },
      });
    for (let i = 1; i <= 5; i++) {
      await post('/auth/register', { appId: 'fbizlab', email: `f${i}@x.com`, password: 'sup3rsecret' }, '203.0.113.91');
    }
    const blocked = await fr('203.0.113.91');
    expect(blocked.statusCode).toBe(429);
    // The words, not the shape: a `toMatch(/./)` passes on the English sentence.
    expect(blocked.json().error).toBe('Trop de requêtes. Patientez un instant et réessayez.');

    // `body.lang` outranks the header — the register form states it explicitly.
    const pt = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { appId: 'fbizlab', email: 'p1@x.com', password: 'sup3rsecret', lang: 'pt' },
      headers: { 'x-forwarded-for': '203.0.113.91', 'accept-language': 'fr' },
    });
    expect(pt.statusCode).toBe(429);
    expect(pt.json().error).toBe('Muitas solicitações. Aguarde um momento e tente novamente.');

    // …and English is still what a client that says nothing gets.
    const en = await post('/auth/register', { appId: 'fbizlab', email: 'e1@x.com', password: 'sup3rsecret' }, '203.0.113.91');
    expect(en.statusCode).toBe(429);
    expect(en.json().error).toBe('Too many requests. Please wait a moment and try again.');
  });

  it('does not pool the verification link with the password-reset link', async () => {
    // They shared one `token` bucket at 30/hour per IP. Clicking the link in your
    // own signup mail is the most ordinary thing a new customer does, and behind a
    // carrier NAT a run of resets spent the allowance for everyone's signup —
    // after which each new user was told, falsely, that their link had expired.
    await seed();
    const cap = config.publicLimits.tokenPerHourPerIp;
    // Lowered so the bucket can actually be EXHAUSTED here. At the real 120 both
    // routes stay far under it and a shared bucket looks identical to two.
    writableConfig.publicLimits.tokenPerHourPerIp = 4;
    try {
      const junk = { token: 'not-a-real-token', password: 'sup3rsecret' };
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        codes.push((await post('/auth/reset-password', junk, '203.0.113.88')).statusCode);
      }
      // The premise: the reset bucket really is spent.
      expect(codes.filter((c) => c === 429).length, `saw ${codes.join(',')}`).toBeGreaterThan(0);

      const verify = await post('/auth/verify-email', junk, '203.0.113.88');
      expect(verify.statusCode, 'the reset traffic spent verification’s allowance').not.toBe(429);
    } finally {
      writableConfig.publicLimits.tokenPerHourPerIp = cap;
    }
  });
});

describe('the two places that count a burst cannot disagree quietly', () => {
  /**
   * `isolatedBurst` is declared twice — in the route's `publicLimit` spec and in
   * the burst window handed to `requireCaptcha` — and used to be enforced in
   * neither. A captcha'd route that asked for its own window and forgot the
   * second declaration was counted into the SHARED `ip` window by the captcha
   * and into `route:ip` here: twice, and the half that mattered drained the
   * window metering sign-in and registration for everyone behind one CGNAT.
   *
   * The omission itself no longer compiles (`CaptchaOptions.burst` is required),
   * which no test can assert — `npm run typecheck` is that test, and removing
   * `{ burst: PREFLIGHT_LIMIT }` from `/research/preflight` fails it. What is
   * left, and what these cover, is the two declarations disagreeing: types
   * cannot see that, so it has to be loud at runtime.
   */
  const IP = '198.51.100.200';
  const fakeReq = (countedAs?: string) =>
    ({ headers: { 'x-forwarded-for': IP }, ip: IP, ...(countedAs ? { __burstKey: countedAs } : {}) }) as never;
  const fakeReply = () => {
    const sentBodies: unknown[] = [];
    const reply = {
      sent: sentBodies,
      header: () => reply,
      code: () => reply,
      send: async (b: unknown) => { sentBodies.push(b); return reply; },
    };
    return reply as never as import('fastify').FastifyReply & { sent: unknown[] };
  };

  beforeEach(() => __resetBurst());

  it('does not spend a second burst slot when the captcha counted another window', async () => {
    const perMinute = config.publicLimits.burstPerMinute;
    writableConfig.publicLimits.burstPerMinute = 1;
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
    try {
      // The misconfiguration: the captcha counted the SHARED window (no
      // `isolatedBurst` in its copy), the route guard wants its own.
      const blocked = await publicLimit(fakeReq(IP), fakeReply(), { route: 'iso', isolatedBurst: true });
      expect(blocked, 'the request itself must still go through').toBe(false);

      // The isolated window is untouched — one request cost one slot, not two.
      // Of the two wrong behaviours this is the cheap one: under-metering one
      // route beats locking a whole carrier NAT out of signing in, which is what
      // the second count did.
      expect(burstOk(`iso:${IP}`), 'the same request was counted in both windows').toBe(true);

      // …and it is not silent. This is a wiring bug in our own code, invisible in
      // the product, so the log is the only place it can surface.
      const event = errors.map((l) => JSON.parse(l)).find((e) => e.event === 'public.burst_window_mismatch');
      expect(event, `no mismatch logged: ${errors.join('|')}`).toBeTruthy();
      expect(event.severity).toBe('ERROR');
      expect(event.countedAs).toBe(IP);
      expect(event.expected).toBe(`iso:${IP}`);
    } finally {
      spy.mockRestore();
      writableConfig.publicLimits.burstPerMinute = perMinute;
      __resetBurst();
    }
  });

  it('still counts the route’s own window when nothing counted it first', async () => {
    // The live control, and the one that matters most: "never count here" passes
    // the case above and turns the burst guard off for every route that has no
    // captcha in front of it.
    const perMinute = config.publicLimits.burstPerMinute;
    writableConfig.publicLimits.burstPerMinute = 1;
    try {
      const blocked = await publicLimit(fakeReq(), fakeReply(), { route: 'iso', isolatedBurst: true });
      expect(blocked).toBe(false);
      expect(burstOk(`iso:${IP}`), 'the guard did not count the request at all').toBe(false);
    } finally {
      writableConfig.publicLimits.burstPerMinute = perMinute;
      __resetBurst();
    }
  });

  it('says nothing when the two agree, which is every route we ship', async () => {
    // The other control: a mismatch ERROR on correct wiring would page someone
    // for `/research/preflight`, which is wired right.
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
    try {
      await publicLimit(fakeReq(`iso:${IP}`), fakeReply(), { route: 'iso', isolatedBurst: true });
      await publicLimit(fakeReq(IP), fakeReply(), { route: 'shared' });
      expect(errors.filter((l) => l.includes('burst_window_mismatch'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
