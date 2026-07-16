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
import { config, getApp, verifySession, type AppRecord, type SessionClaims } from '@agent-researcher/core';

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified session claims (email, appId, role). */
    auth?: SessionClaims;
    /** The app the token belongs to (loaded for rate limits / config). */
    appRecord?: AppRecord;
  }
}

const PUBLIC_PREFIXES = ['/health', '/docs', '/credits/webhook', '/auth', '/plans'];

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
  req.auth = claims;
  req.appRecord = app;
}

/** Guards admin-only routes. Must run after jwtAuth. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.server.appEnv === 'local') return; // local dev — allow
  if (req.auth?.role !== 'admin') {
    await reply.code(403).send({ error: 'Forbidden: admin token required.' });
  }
}
