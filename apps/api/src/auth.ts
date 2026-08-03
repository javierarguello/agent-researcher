/**
 * Token-based auth (onRequest hook). The API is a BFF authority: clients send a
 * session JWT (`Authorization: Bearer <token>`) issued by `/auth/session`. The
 * token carries { email (sub), appId, role }; appId + userId are taken from it,
 * never from the request body.
 *
 * Public paths (no token): /health, /docs, /credits/webhook (Stripe-signed),
 * and /auth/* (login). In APP_ENV=local, auth is bypassed with dev identity
 * headers (x-app-id / x-user-id / x-role) so local testing needs no JWT.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  config,
  credentialsStillValid,
  getApp,
  getCredential,
  verifySession,
  type AppRecord,
  type SessionClaims,
} from '@agent-researcher/core';
import { bustPublicCache, cached } from './cache.js';

/**
 * How stale a revocation check may be.
 *
 * The trade, stated: without a cache this is a Firestore read on every
 * authenticated request; with one, a revoked session survives at most this long. A
 * minute is the difference between seven days and before they finish reading the
 * page, at roughly one read per user per minute. The two endpoints that must be
 * exact — verify-email and reset-password — read the credential themselves.
 */
const REVOCATION_TTL_MS = 60_000;

/**
 * Forget the cached credential for one account.
 *
 * The cache is what keeps the revocation check off the per-request path, and it is
 * also what would make a password reset take up to a minute to evict an intruder.
 * Our own flows know the moment they change something, so they say so and eviction
 * is immediate; the window only applies to a change made outside them.
 */
export function forgetCachedCredential(appId: string, email: string): void {
  bustPublicCache(`cred:${appId}:${email}`);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified session claims (email, appId, role). */
    auth?: SessionClaims;
    /** The app the token belongs to (loaded for rate limits / config). */
    appRecord?: AppRecord;
  }
}

const PUBLIC_PREFIXES = ['/health', '/docs', '/credits/webhook', '/auth', '/plans', '/contact'];

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (path === '/') return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function bearer(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return undefined;
}

export async function jwtAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isPublic(req.url)) return;

  // Local dev — identity comes from headers (no Google/JWT needed).
  if (config.server.appEnv === 'local') {
    const appId = (req.headers['x-app-id'] as string) || 'fbizlab';
    const email = (req.headers['x-user-id'] as string) || 'local@dev';
    const role = (req.headers['x-role'] as string) === 'admin' ? 'admin' : 'user';
    req.auth = { email, appId, role };
    req.appRecord = await getApp(appId);
    return;
  }

  const token = bearer(req);
  if (!token) {
    await reply.code(401).send({ error: 'Unauthorized: missing bearer token.' });
    return;
  }
  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
  } catch {
    await reply.code(401).send({ error: 'Unauthorized: invalid or expired token.' });
    return;
  }
  const app = await getApp(claims.appId);
  if (!app || !app.active) {
    await reply.code(401).send({ error: 'Unauthorized: app not found or inactive.' });
    return;
  }
  // Single-purpose tokens are NOT logins. `verify-email` and `reset-password` are
  // minted for one public endpoint each (which verifies the scope itself) and are
  // handed out in URLs — email bodies, browser history, forwarded mail, link
  // scanners. A 24h verification link must never double as 24h of full API access,
  // so anything carrying a scope this hook doesn't explicitly handle is refused
  // here rather than falling through into a session.
  if (claims.scope && claims.scope !== 'report-read') {
    await reply.code(401).send({ error: 'Unauthorized: this link is not a sign-in token.' });
    return;
  }

  // A session outlives the account it was minted for unless something checks.
  // `credentialsChangedAt` is the revocation point; anything issued at or before it
  // is refused. Fails open for an account with no record or no stamp.
  if (claims.scope !== 'report-read') {
    const cred = await cached(
      `cred:${claims.appId}:${claims.email}`,
      REVOCATION_TTL_MS,
      () => getCredential(claims.appId, claims.email),
    ).catch(() => undefined);
    if (!credentialsStillValid(cred, claims.issuedAt)) {
      await reply.code(401).send({ error: 'Unauthorized: this session ended when the account credentials changed.' });
      return;
    }
  }

  req.auth = claims;
  req.appRecord = app;

  // A restricted read-only report token (admin "view in app") may ONLY GET that one
  // report (+ templates for section titles). Anything else is forbidden, so leaking
  // the link does nothing beyond viewing that single report until it expires.
  if (claims.scope === 'report-read') {
    const path = req.url.split('?')[0] ?? req.url;
    const jid = claims.jobId ?? '';
    const allowed =
      req.method === 'GET' &&
      !!jid &&
      (path === `/research/${jid}` ||
        path === `/research/${jid}/report` ||
        path === `/research/${jid}/pdf` ||
        path.startsWith(`/research/${jid}/files/`) ||
        path === '/templates' ||
        path.startsWith('/templates/'));
    if (!allowed) {
      await reply.code(403).send({ error: 'This link is read-only for a single report.' });
    }
  }
}

/**
 * Guards admin-only routes. Must run after jwtAuth.
 *
 * The whitelist is re-read on every request, never trusted from the token.
 * Removing someone from `adminEmails` is the only de-admin control this product
 * has, and on the claim alone it did nothing for the remaining life of their
 * session — up to seven days of granting credits and resolving jobs after being
 * removed. `jwtAuth` has already loaded the app record, so this costs nothing.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.server.appEnv === 'local') return; // local dev — allow
  if (req.auth?.role !== 'admin') {
    await reply.code(403).send({ error: 'Forbidden: admin token required.' });
    return;
  }
  const whitelist = (req.appRecord?.adminEmails ?? []).map((e) => e.toLowerCase());
  if (!whitelist.includes((req.auth.email ?? '').toLowerCase())) {
    await reply.code(403).send({ error: 'Forbidden: admin token required.' });
  }
}
