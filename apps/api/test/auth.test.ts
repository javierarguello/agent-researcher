import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import { createApp, getCredential, createPasswordUser, upsertGoogleUser, hashPassword } from '@agent-researcher/core';

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

  it('verify-email logs the user in; then password login works', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    const v = await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify') } });
    expect(v.statusCode).toBe(200);
    expect(v.json().token).toBeTruthy();
    const l = await login(reg.email, reg.password);
    expect(l.statusCode).toBe(200);
    expect(l.json().user.email).toBe('new@x.com');
  });

  it('a verified email cannot be re-registered (409 email_taken)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify') } });
    const again = await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('email_taken');
  });

  it('wrong password and unknown email both return 401 (no enumeration)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify') } });
    expect((await login(reg.email, 'wrongwrong')).statusCode).toBe(401);
    expect((await login('nobody@x.com', 'whatever12')).statusCode).toBe(401);
  });

  it('password reset sets a new password and logs in; old password stops working', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: reg });
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenFromLast('verify') } });
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

  it('Google login on the same email links the account and auto-verifies it', async () => {
    await createPasswordUser({ appId: 'fbizlab', email: 'dual@x.com', passwordHash: await hashPassword('pw12345678') });
    expect((await getCredential('fbizlab', 'dual@x.com'))?.emailVerified).toBe(false);
    await upsertGoogleUser({ appId: 'fbizlab', email: 'Dual@X.com', name: 'Dual' }); // same email, different case
    const cred = await getCredential('fbizlab', 'dual@x.com');
    expect(cred?.emailVerified).toBe(true);
    expect([...(cred?.providers ?? [])].sort()).toEqual(['google', 'password']);
  });

  it('users are per-app: the same email in another app is a different account', async () => {
    await seedEmailApp('otherapp');
    await createPasswordUser({ appId: 'fbizlab', email: 'same@x.com', passwordHash: await hashPassword('pw12345678') });
    expect(await getCredential('fbizlab', 'same@x.com')).toBeTruthy();
    expect(await getCredential('otherapp', 'same@x.com')).toBeUndefined();
  });
});
