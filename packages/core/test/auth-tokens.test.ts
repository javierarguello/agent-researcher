import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../src/auth/tokens.js';

describe('session JWTs', () => {
  it('signs and verifies a roundtrip', async () => {
    const token = await signSession({ email: 'u@x.com', appId: 'fbizlab', role: 'user', name: 'U' });
    const claims = await verifySession(token);
    expect(claims).toMatchObject({ email: 'u@x.com', appId: 'fbizlab', role: 'user', name: 'U' });
  });

  it('preserves the admin role', async () => {
    const token = await signSession({ email: 'a@x.com', appId: 'admin', role: 'admin' });
    expect((await verifySession(token)).role).toBe('admin');
  });

  it('rejects a tampered token', async () => {
    const token = await signSession({ email: 'u@x.com', appId: 'fbizlab', role: 'user' });
    await expect(verifySession(token + 'x')).rejects.toThrow();
  });

  it('rejects a token signed with another secret', async () => {
    // A structurally valid but foreign JWT.
    const foreign =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4QHkuY29tIiwiYXBwSWQiOiJmYml6bGFiIiwicm9sZSI6ImFkbWluIn0.bad';
    await expect(verifySession(foreign)).rejects.toThrow();
  });
});
