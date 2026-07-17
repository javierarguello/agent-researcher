/**
 * Token-based auth for the shared API (BFF-style, consumable from static webs).
 *
 * A frontend does Google Sign-In client-side, then exchanges the Google
 * `id_token` + its `appId` for one of OUR session JWTs (HS256), which carries
 * { email (sub), appId, role }. Every later request is authenticated with that
 * JWT — appId and userId come from the token, never the request body.
 */
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

export type SessionRole = 'user' | 'admin';

export interface SessionClaims {
  /** Authenticated user email (JWT subject). */
  email: string;
  /** App the user is logged into. */
  appId: string;
  role: SessionRole;
  name?: string;
  /** When set, a restricted token — the API caps its use to the matching action.
   *  `report-read`: read one report. `verify-email`/`reset-password`: one-shot
   *  account action from an email link (NOT a login session). */
  scope?: 'report-read' | 'verify-email' | 'reset-password';
  /** The one job a `report-read` token may access. */
  jobId?: string;
}

const secret = () => {
  if (!config.auth.jwtSecret) throw new Error('AUTH_JWT_SECRET is not configured.');
  return new TextEncoder().encode(config.auth.jwtSecret);
};

/** Sign one of our session JWTs. */
export async function signSession(claims: SessionClaims, ttlSeconds = config.auth.jwtTtlSeconds): Promise<string> {
  return new SignJWT({
    appId: claims.appId,
    role: claims.role,
    ...(claims.name ? { name: claims.name } : {}),
    ...(claims.scope ? { scope: claims.scope } : {}),
    ...(claims.jobId ? { jobId: claims.jobId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.email)
    .setIssuer(config.auth.jwtIssuer)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

/**
 * A short-lived, restricted token that lets its holder ONLY read one report — for
 * admin "view in app" impersonation. Role stays `user` (never admin) and the API
 * caps a `report-read` token to that job's read endpoints; it can't launch jobs,
 * spend credits, or see anything else.
 */
export async function signReadToken(input: { email: string; appId: string; jobId: string }, ttlSeconds = 15 * 60): Promise<string> {
  return signSession({ email: input.email, appId: input.appId, role: 'user', scope: 'report-read', jobId: input.jobId }, ttlSeconds);
}

/**
 * A single-purpose token embedded in an account email link (verify address /
 * reset password). It is NOT a login session — the API only accepts it for the
 * matching action (checked via `scope`), then issues a real session.
 */
export async function signActionToken(
  input: { email: string; appId: string; scope: 'verify-email' | 'reset-password' },
  ttlSeconds: number,
): Promise<string> {
  return signSession({ email: input.email, appId: input.appId, role: 'user', scope: input.scope }, ttlSeconds);
}

/** Verify one of our session JWTs. Throws if invalid/expired. */
export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret(), { issuer: config.auth.jwtIssuer });
  const role = payload.role === 'admin' ? 'admin' : 'user';
  return {
    email: String(payload.sub),
    appId: String(payload.appId),
    role,
    name: payload.name as string | undefined,
    scope:
      payload.scope === 'report-read' || payload.scope === 'verify-email' || payload.scope === 'reset-password'
        ? payload.scope
        : undefined,
    jobId: payload.jobId as string | undefined,
  };
}

/** Identity providers the API can authenticate with. Add 'password', etc. here. */
export type IdentityProvider = 'google' | 'password';

/** A verified identity, provider-agnostic — the shared login flow builds on this. */
export interface Identity {
  provider: IdentityProvider;
  email: string;
  name?: string;
  emailVerified: boolean;
  /** Provider-specific subject id (e.g. Google `sub`), when available. */
  sub?: string;
}

const googleClients = new Map<string, OAuth2Client>();

/** Verify a Google id_token against an app's OAuth client id (its `aud`). */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<Identity> {
  let client = googleClients.get(clientId);
  if (!client) {
    client = new OAuth2Client(clientId);
    googleClients.set(clientId, client);
  }
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const p = ticket.getPayload();
  if (!p?.email) throw new Error('Google id_token has no email.');
  return { provider: 'google', email: p.email.toLowerCase(), name: p.name, sub: p.sub, emailVerified: !!p.email_verified };
}

// Future providers (e.g. email/password) implement the same `Identity` shape:
//   export async function verifyPassword(email, password): Promise<Identity> { … provider: 'password' }
// The /auth/session route dispatches on the request's `provider` field.
