/**
 * Google sign-in trusts exactly one thing: that Google says the address is
 * verified. It used to compute that flag and throw it away, which handed out a
 * session for any address an id_token happened to name — and stamped the victim's
 * record as verified on the way past.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

/** Stand in for Google's verification so the test controls the claims. */
const googleClaims = { provider: 'google' as const, email: 'victim@corp.com', name: 'Victim', sub: 'g-1', emailVerified: false };
vi.mock('@agent-researcher/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-researcher/core')>()),
  verifyGoogleIdToken: vi.fn(async () => googleClaims),
}));

import { app } from '../src/index.js';
import { createApp, getCredential, createPasswordUser, hashPassword } from '@agent-researcher/core';

const login = () =>
  app.inject({ method: 'POST', url: '/auth/session', payload: { appId: 'fbizlab', provider: 'google', idToken: 'stand-in' } });

describe('google sign-in — email_verified', () => {
  beforeEach(async () => {
    await createApp({ appId: 'fbizlab', name: 'F', role: 'app', googleClientId: 'client-id.apps.googleusercontent.com' });
    googleClaims.email = 'victim@corp.com';
    googleClaims.emailVerified = false;
  });

  it('refuses an id_token whose address Google has not verified', async () => {
    const r = await login();
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('email_unverified');
  });

  it('does not touch the victim’s existing account on a refused login', async () => {
    await createPasswordUser({ appId: 'fbizlab', email: 'victim@corp.com', passwordHash: await hashPassword('sup3rsecret') });
    await login();

    const cred = await getCredential('fbizlab', 'victim@corp.com');
    // The bug marked the record verified and linked Google before anyone checked.
    expect(cred?.emailVerified).toBeFalsy();
    expect(cred?.providers ?? []).not.toContain('google');
  });

  it('accepts a verified address and returns a session', async () => {
    googleClaims.emailVerified = true;
    const r = await login();
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBe('victim@corp.com');
    expect(r.json().token).toBeTruthy();
  });

  it('normalizes the identity so it cannot sidestep a block keyed on the password identity', async () => {
    googleClaims.emailVerified = true;
    googleClaims.email = 'J.Doe+tag@gmail.com';
    const r = await login();
    expect(r.statusCode).toBe(200);
    // Same user as a password login with j.doe@gmail.com — one key for blocks,
    // strikes, allowances, credits and rate limits.
    expect(r.json().user.email).toBe('jdoe@gmail.com');
  });
});
