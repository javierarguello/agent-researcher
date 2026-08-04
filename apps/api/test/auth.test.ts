import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { createApp, getCredential, createPasswordUser, upsertGoogleUser, hashPassword, setPassword } from '@agent-researcher/core';

// Capture the emails Postmark would send, so tests can pull the verify/reset link.
const sent: Array<{ To: string; Subject: string; HtmlBody: string }> = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: unknown, init: { body?: string } = {}) => {
    const u = String(url);
    if (u.includes('postmarkapp.com')) {
      sent.push(JSON.parse(init.body ?? '{}'));
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    }
    throw new Error(`unexpected fetch: ${u}`);
  }),
);

const tokenFromLast = (kind: 'verify' | 'reset'): string => {
  const html = sent[sent.length - 1]?.HtmlBody ?? '';
  const m = html.match(new RegExp(`/${kind}\\?token=([^"&\\s]+)`));
  return m ? decodeURIComponent(m[1]!) : '';
};

const seedEmailApp = (appId = 'fbizlab') =>
  createApp({ appId, name: 'Florida Biz Labs', role: 'app', emailFrom: 'no-reply@fbizlab.test', webUrl: 'https://fbizlab.test' });

const reg = { appId: 'fbizlab', email: 'New@X.com', password: 'sup3rsecret', name: 'New User' };
const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/session', payload: { appId: 'fbizlab', provider: 'password', email, password } });

/**
 * Tokens that are not sign-ins, and identities that are not proven.
 *
 * Both of these were live: an emailed link doubled as 24h of full API access, and
 * a Google id_token was trusted for an address Google had not verified.
 */
describe('auth — single-purpose tokens and unverified identities', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  it('a verification link is not a session: it opens nothing but its own endpoint', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    const link = tokenFromLast('verify');
    expect(link).toBeTruthy();

    // These links live in email bodies, browser history and forwarded mail.
    for (const url of ['/research', '/credits/balance', '/me/stats']) {
      const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${link}` } });
      expect(r.statusCode, url).toBe(401);
    }
    const post = await app.inject({
      method: 'POST',
      url: '/research',
      headers: { authorization: `Bearer ${link}`, 'content-type': 'application/json' },
      payload: { template: 'florida-business-for-sale', params: { industry: 'x', mode: 'essential' } },
    });
    expect(post.statusCode).toBe(401);

    // …but it still does the one job it was minted for.
    expect((await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: link, password: reg.password } })).statusCode).toBe(200);
  });

  it('a password-reset link is not a session either', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: reg.email } });
    const link = tokenFromLast('reset');
    expect(link).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/credits/balance', headers: { authorization: `Bearer ${link}` } })).statusCode).toBe(401);
  });

  it('the session a real login returns still works everywhere', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    // The session has to come from a LOGIN — verifying an address no longer hands
    // one out, because clicking a link does not prove you chose the password.
    const session = (await login(reg.email, reg.password)).json().token;
    expect((await app.inject({ method: 'GET', url: '/credits/balance', headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(200);
  });
});

describe('auth — password register / verify / login / reset', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  it('register sends a verification email; login is blocked until verified', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    expect(r.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    const cred = await getCredential('fbizlab', 'new@x.com'); // stored normalized
    expect(cred?.emailVerified).toBe(false);
    const l = await login(reg.email, reg.password);
    expect(l.statusCode).toBe(403);
    expect(l.json().code).toBe('email_unverified');
  });

  it('verify-email verifies the address but does NOT sign anyone in', async () => {
    // The pre-hijack's other half. Anyone can register an address they don't own,
    // so the password on this record was not necessarily chosen by the person who
    // opened the mail — and handing that person a session is what made the attack
    // pay off: they would use and pay for an account a stranger can log into.
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    const v = await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    expect(v.statusCode).toBe(200);
    expect(v.json().status).toBe('verified');
    expect(v.json().token).toBeUndefined();

    // …and the person who does hold the password signs in normally.
    const l = await login(reg.email, reg.password);
    expect(l.statusCode).toBe(200);
    expect(l.json().user.email).toBe('new@x.com');
  });

  it('sends a reset link to someone whose password Google superseded', async () => {
    // Jane registers, the verification mail lands in spam, she uses the Google
    // button instead — which discards the password nobody verified. Thirty days
    // later she types that password on a machine with no Google session. Before
    // this, she got "Invalid email or password", then "check your email" with NO
    // mail ever arriving (the route only sent when a `passwordHash` existed — the
    // exact field the discard deletes), then "an account already exists" if she
    // tried to sign up again. Three messages, no way forward.
    await createPasswordUser({ appId: 'fbizlab', email: 'jane@corp.com', passwordHash: await hashPassword('Jane-Pass-1!') });
    await upsertGoogleUser({ appId: 'fbizlab', email: 'jane@corp.com', name: 'Jane' });
    sent.length = 0;

    const r = await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'jane@corp.com' } });
    expect(r.statusCode).toBe(202);
    expect(sent).toHaveLength(1); // …the mail she was promised

    const reset = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: tokenFromLast('reset'), password: 'Jane-New-9!' } });
    expect(reset.statusCode).toBe(200);
    expect((await login('jane@corp.com', 'Jane-New-9!')).statusCode).toBe(200);
  });

  it('a password write that lands after verification is refused (registration race)', async () => {
    // Registration reads the record, spends ~40ms hashing, THEN writes. If the
    // address gets verified inside that window — the owner clicks their link, or
    // signs in with Google — a blind write would plant a stranger's password on a
    // live account, and the login gate only checks `passwordHash` + `emailVerified`.
    // Asserted at the guard rather than through the route, because the route's own
    // 409 fires on the state BEFORE the pause and would pass either way.
    await createPasswordUser({ appId: 'fbizlab', email: 'race@corp.com', passwordHash: await hashPassword('First-Pass-1!') });
    await upsertGoogleUser({ appId: 'fbizlab', email: 'race@corp.com' }); // verifies mid-flight

    const written = await setPassword('fbizlab', 'race@corp.com', await hashPassword('Attacker-B-1!'), { onlyIfUnverified: true });
    expect(written).toBe(false);
    expect((await getCredential('fbizlab', 'race@corp.com'))?.passwordHash).toBeUndefined();
    expect((await login('race@corp.com', 'Attacker-B-1!')).statusCode).toBe(401);
  });

  it('a verified email cannot be re-registered (409 email_taken)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    const again = await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('email_taken');
  });

  it('rejects disposable / temporary email domains (400 disposable_email)', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'throwaway@mailinator.com' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('disposable_email');
    expect(sent).toHaveLength(0); // no verification email sent
    expect(await getCredential('fbizlab', 'throwaway@mailinator.com')).toBeUndefined();
  });

  it('refuses to mail a recipient LIST, on every route that takes an address', async () => {
    // `To:` is comma-separated, so an address field that reaches Postmark unchecked
    // lets the caller pick who we mail — from our verified sender, and past the
    // per-inbox cap, because the counter keys on the whole string and every
    // permutation is a fresh bucket.
    const list = 'attacker@evil.com,v1@victim.com,v2@victim.com';
    const reg2 = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: list } });
    expect(reg2.statusCode).toBe(400);

    // The reset leg needs an account that WOULD be mailed, or the guard is not what
    // stops it — nothing was going to be sent either way, and deleting the check
    // left this green.
    await createPasswordUser({
      appId: 'fbizlab', email: list, name: 'L', passwordHash: await hashPassword('sup3rsecret'),
    });
    const reset = await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: list } });
    expect(reset.statusCode).toBe(202); // this route never reveals anything…
    // …so the status cannot say whether the guard fired. The BODY can: the refusal
    // answers `{ok:true}` and the path that would have mailed answers
    // `{status:'reset_sent'}`. Without this the assertion was only that an
    // unseeded address sends no mail, which was true either way.
    expect(reset.json()).toEqual({ ok: true });

    const contact = await app.inject({
      method: 'POST', url: '/contact',
      payload: { appId: 'fbizlab', name: 'A', email: list, message: 'hi' },
    });
    expect(contact.statusCode).toBe(400); // …Reply-To is a recipient field too

    expect(sent).toHaveLength(0); // …and nothing was sent by any of them
  });

  it('rejects weak passwords (requires a letter+number; blocks common ones)', async () => {
    const noNum = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'weak1@x.com', password: 'onlyletters' } });
    expect(noNum.statusCode).toBe(400);
    const common = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'weak2@x.com', password: 'password123' } });
    expect(common.statusCode).toBe(400);
    const strong = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'strong@x.com', password: 'g00dpassword' } });
    expect(strong.statusCode).toBe(202);
  });

  it('+subaddressing cannot spawn a duplicate account (normalized identity)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    // new+promo@x.com normalizes to new@x.com → treated as the existing account.
    const dup = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'new+promo@x.com' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('email_taken');
  });

  it('wrong password and unknown email both return 401 (no enumeration)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    expect((await login(reg.email, 'wrongwrong')).statusCode).toBe(401);
    expect((await login('nobody@x.com', 'whatever12')).statusCode).toBe(401);
  });

  it('password reset sets a new password and logs in; old password stops working', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify'), password: reg.password } });
    const rr = await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: reg.email } });
    expect(rr.statusCode).toBe(202);
    const reset = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: tokenFromLast('reset'), password: 'newpassword9' } });
    expect(reset.statusCode).toBe(200);
    expect((await login(reg.email, reg.password)).statusCode).toBe(401);
    expect((await login(reg.email, 'newpassword9')).statusCode).toBe(200);
  });

  it('reset for an unknown email still returns 202 and sends nothing (no enumeration)', async () => {
    const rr = await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'ghost@x.com' } });
    expect(rr.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it('Google login resolves to the same account, case-insensitively, and auto-verifies it', async () => {
    await createPasswordUser({ appId: 'fbizlab', email: 'dual@x.com', passwordHash: await hashPassword('pw12345678') });
    expect((await getCredential('fbizlab', 'dual@x.com'))?.emailVerified).toBe(false);
    await upsertGoogleUser({ appId: 'fbizlab', email: 'Dual@X.com', name: 'Dual' }); // same email, different case
    const cred = await getCredential('fbizlab', 'dual@x.com');
    expect(cred?.emailVerified).toBe(true);
    // This assertion used to read `['google', 'password']`, which is the pre-hijack
    // itself written down as an expectation: registration proves nothing, so an
    // UNVERIFIED password here belongs to whoever registered first, not to the
    // person Google just authenticated. Google proves the address; it does not
    // vouch for a password stapled to it. A verified password IS kept — both cases
    // are pinned in google-auth.test.ts.
    expect([...(cred?.providers ?? [])]).toEqual(['google']);
    expect(cred?.passwordHash).toBeUndefined();
  });

  it('users are per-app: the same email in another app is a different account', async () => {
    await seedEmailApp('otherapp');
    await createPasswordUser({ appId: 'fbizlab', email: 'same@x.com', passwordHash: await hashPassword('pw12345678') });
    expect(await getCredential('fbizlab', 'same@x.com')).toBeTruthy();
    expect(await getCredential('otherapp', 'same@x.com')).toBeUndefined();
  });
});

describe('a stranger cannot pre-register someone else\u2019s address', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  it('the victim clicking "verify" does not activate the attacker\u2019s password', async () => {
    // Anyone can register an address they do not own. The mail the victim receives
    // is genuine and correctly signed — it is our mail, for a registration they
    // never made. What must not happen is that clicking it hands the account to
    // whoever chose the password.
    const attackerPw = 'Attacker-Pw-1!';
    const victim = 'victim@x.com';
    expect((await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { appId: 'fbizlab', email: victim, password: attackerPw, name: 'V' },
    })).statusCode).toBe(202);

    // The victim reads the mail and clicks. They cannot supply a password they
    // never chose, so verification refuses and the address stays unverified.
    const link = tokenFromLast('verify');
    const clicked = await app.inject({
      method: 'POST', url: '/auth/verify-email', payload: { token: link, password: 'whatever-the-victim-types' },
    });
    expect(clicked.statusCode).toBe(401);

    // …and the attacker still cannot sign in, which is the whole point.
    const signIn = await app.inject({
      method: 'POST', url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'password', email: victim, password: attackerPw },
    });
    expect(signIn.statusCode).not.toBe(200);
  });

  it('lets the person who actually signed up through', async () => {
    // The cost to a legitimate user is confirming the password they just chose.
    expect((await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { appId: 'fbizlab', email: 'real@x.com', password: 'sup3rsecret', name: 'R' },
    })).statusCode).toBe(202);

    const ok = await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: 'sup3rsecret' },
    });
    expect(ok.statusCode).toBe(200);

    const signIn = await app.inject({
      method: 'POST', url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'password', email: 'real@x.com', password: 'sup3rsecret' },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('a wrong password does not consume the link', async () => {
    // Otherwise one mistyped attempt costs a legitimate user their registration.
    expect((await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { appId: 'fbizlab', email: 'typo@x.com', password: 'sup3rsecret', name: 'T' },
    })).statusCode).toBe(202);
    const link = tokenFromLast('verify');

    expect((await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: link, password: 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: link, password: 'sup3rsecret' } })).statusCode).toBe(200);
  });
});

describe('a session lasts as long as the account says, not as long as the token', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  /** Register, verify, sign in — the ordinary path — and hand back the session. */
  async function liveSession(email = 'live@x.com'): Promise<string> {
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email } });
    await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: reg.password },
    });
    const login = await app.inject({
      method: 'POST', url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'password', email, password: reg.password },
    });
    return (login.json() as { token: string }).token;
  }

  it('a password reset evicts the session someone else was holding', async () => {
    // The point of resetting a password on a compromised account. Before this, the
    // intruder simply kept using the session they already had, for the rest of its
    // seven days.
    const stolen = await liveSession();
    expect((await app.inject({ method: 'GET', url: '/me/stats', headers: { authorization: `Bearer ${stolen}` } })).statusCode).toBe(200);

    // A real second, because the session has to be OLDER than the reset — which in
    // reality it always is, since an intruder holds it for minutes or days. A JWT's
    // `iat` is in seconds and the rest of this test runs inside one. Fake timers
    // deadlock the server's own async work, so this waits.
    //
    // That granularity is also why the comparison is inclusive: a session minted in
    // the same second as the change cannot be told from one minted before it, and
    // every legitimate flow that ends in a login lands exactly there.
    await new Promise((r) => setTimeout(r, 1_100));

    await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'live@x.com' } });
    await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { token: tokenFromLast('reset'), password: 'Brand-New-9!' },
    });

    expect((await app.inject({ method: 'GET', url: '/me/stats', headers: { authorization: `Bearer ${stolen}` } })).statusCode).toBe(401);
  });

  it('an emailed reset link works exactly once', async () => {
    // These arrive in URLs — inbox backups, forwarded threads, link scanners — and
    // each redemption used to hand out a fresh seven-day session.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'once@x.com' } });
    await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: reg.password },
    });
    await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'once@x.com' } });
    const link = tokenFromLast('reset');

    expect((await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: link, password: 'First-One-9!' } })).statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: link, password: 'Second-One-9!' } });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error).toMatch(/already been used/i);
  });

  it('refuses a link that carries no id at all', async () => {
    // `claims.tokenId && …` was a migration shim for links minted before the id
    // existed, and it skipped the one-time check entirely: any token without one
    // stayed redeemable for its whole TTL. Those links expired within a day of
    // that deploy, so what was left is a hole with nothing legitimate in it.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'noid@x.com' } });
    const core = await import('@agent-researcher/core');
    // A well-signed token of the right scope — just without the id.
    const legacy = await core.signSession(
      { email: 'noid@x.com', appId: 'fbizlab', role: 'user', scope: 'verify-email' } as never,
      3600,
    );

    const res = await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: legacy, password: reg.password } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already been used/i);
  });

  it('an emailed verification link works exactly once', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'twice@x.com' } });
    const link = tokenFromLast('verify');

    expect((await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: link, password: reg.password } })).statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: link, password: reg.password } });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error).toMatch(/already been used/i);
  });
});

describe('the revocation check fails OPEN, deliberately', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  it('keeps serving when the credential read throws', async () => {
    // The most dangerous line to tidy away. If this `.catch` goes, every
    // authenticated request during a Firestore outage becomes a 500 — the API
    // stops entirely rather than degrading — and nothing else in the suite notices.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'open@x.com' } });
    await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: reg.password },
    });
    const login = await app.inject({
      method: 'POST', url: '/auth/session',
      payload: { appId: 'fbizlab', provider: 'password', email: 'open@x.com', password: reg.password },
    });
    const t = (login.json() as { token: string }).token;

    const core = await import('@agent-researcher/core');
    const spy = vi.spyOn(core, 'getCredential').mockRejectedValue(new Error('firestore unavailable'));
    // Cold cache, so the read is actually attempted.
    const { clearPublicCache } = await import('../src/cache.js');
    clearPublicCache();

    const res = await app.inject({ method: 'GET', url: '/me/stats', headers: { authorization: `Bearer ${t}` } });
    expect(res.statusCode).toBe(200);
    spy.mockRestore();
  });

  it('exempts a report-read link, which outlives a password reset by design', async () => {
    // An admin-minted 15-minute link to ONE report. Stating it because it is a
    // contract nobody wrote down: a reset evicts SESSIONS, not this.
    //
    // The account has to be real and the stamp has to be newer than the token, or
    // the check fails open for a different reason and the exemption is untested.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'reader@x.com' } });
    await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: reg.password },
    });
    const { signReadToken, setPassword, hashPassword } = await import('@agent-researcher/core');
    const rt = await signReadToken({ email: 'reader@x.com', appId: 'fbizlab', jobId: 'j-none' });

    await new Promise((r) => setTimeout(r, 1_100));
    await setPassword('fbizlab', 'reader@x.com', await hashPassword('Brand-New-9!'));

    // 403 from its own scope check — not 401, which is what a revoked session gets.
    const res = await app.inject({ method: 'GET', url: '/me/stats', headers: { authorization: `Bearer ${rt}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('the guards that were written the forbidden way', () => {
  beforeEach(async () => {
    sent.length = 0;
    await seedEmailApp();
  });

  // `x && check(x)` passes whenever `x` is absent. It shipped three times in this
  // file — `claims.tokenId &&` on two routes and `cred.passwordHash &&` on one —
  // and each time the test that covered its sibling stayed green.

  it('refuses to verify an account that has no password to prove', async () => {
    // Reachable: `upsertGoogleUser` DELETES the hash of an unverified account
    // while its verification link is still live. With `cred.passwordHash &&`, any
    // string at all verified the address — the exact hole the block comment above
    // it says was closed.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'nohash@x.com' } });
    const link = tokenFromLast('verify');
    const core = await import('@agent-researcher/core');
    await core.upsertGoogleUser({ appId: 'fbizlab', email: 'nohash@x.com', name: 'G' } as never);

    const res = await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: link, password: 'anything-at-all-9!' },
    });
    expect(res.statusCode, 'a password nobody chose must not verify an address').toBe(401);
  });

  it('still verifies with the password that WAS chosen', async () => {
    // The control. "Always 401" would pass the assertion above.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'hashed@x.com' } });
    const res = await app.inject({
      method: 'POST', url: '/auth/verify-email',
      payload: { token: tokenFromLast('verify'), password: reg.password },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a RESET link that carries no id at all', async () => {
    // The other half of the same fix, and the one that was left uncovered — on the
    // route its own comment calls "a repeatable account takeover for its whole
    // TTL, each redemption handing out a fresh seven-day session". Only
    // `/auth/verify-email` got a case; restoring the shim here was green.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'noidreset@x.com' } });
    const core = await import('@agent-researcher/core');
    const legacy = await core.signSession(
      { email: 'noidreset@x.com', appId: 'fbizlab', role: 'user', scope: 'reset-password' } as never,
      3600,
    );

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { token: legacy, password: 'Brand-New-9!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already been used/i);
  });

  it('accepts a reset link that has one', async () => {
    // The control, again: a 400 on every reset would pass the case above.
    await app.inject({ method: 'POST', url: '/auth/register', payload: { ...reg, email: 'withid@x.com' } });
    await app.inject({ method: 'POST', url: '/auth/request-password-reset', payload: { appId: 'fbizlab', email: 'withid@x.com' } });
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password',
      payload: { token: tokenFromLast('reset'), password: 'Brand-New-9!' },
    });
    expect(res.statusCode).toBe(200);
  });
});
