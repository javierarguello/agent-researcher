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
}

const secret = () => {
  if (!config.auth.jwtSecret) throw new Error('AUTH_JWT_SECRET is not configured.');
  return new TextEncoder().encode(config.auth.jwtSecret);
};

/** Sign one of our session JWTs. */
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ appId: claims.appId, role: claims.role, ...(claims.name ? { name: claims.name } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.email)
    .setIssuer(config.auth.jwtIssuer)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + config.auth.jwtTtlSeconds)
    .sign(secret());
}

/** Verify one of our session JWTs. Throws if invalid/expired. */
export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret(), { issuer: config.auth.jwtIssuer });
  const role = payload.role === 'admin' ? 'admin' : 'user';
  return { email: String(payload.sub), appId: String(payload.appId), role, name: payload.name as string | undefined };
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
