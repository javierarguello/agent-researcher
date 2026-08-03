import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';
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
    // Really signed, with a real key that is not ours. The previous fixture ended
    // in the literal string `bad`, so it was rejected on SHAPE — removing the
    // signature check entirely left this green, which is the one thing it exists
    // to notice.
    const foreign = await new SignJWT({ appId: 'fbizlab', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('attacker@x.com')
      .setIssuer(config.auth.jwtIssuer)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode('a-different-secret-entirely'));

    await expect(verifySession(foreign)).rejects.toThrow();
  });

  it('rejects a token from another issuer, signed with OUR key', async () => {
    // The other half. A key can be shared across services; the issuer is what says
    // this token was minted for us.
    const other = await new SignJWT({ appId: 'fbizlab', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('attacker@x.com')
      .setIssuer('some-other-service')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode(config.auth.jwtSecret));

    await expect(verifySession(other)).rejects.toThrow();
  });
});
