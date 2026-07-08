/**
 * API-key authentication (onRequest hook), backed by the Firestore `apps`
 * collection.
 *
 * A client authenticates with a key via `x-api-key: <key>` or
 * `Authorization: Bearer <key>`. The key is looked up in the apps registry; the
 * resolved (active) app is attached to `req.appRecord` for downstream handlers.
 *
 * Auth is DISABLED when APP_ENV=local (local dev). Public paths (health check,
 * Swagger docs) always skip auth.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, getAppByApiKey, type AppRecord } from '@agent-researcher/core';

declare module 'fastify' {
  interface FastifyRequest {
    /** The app resolved from the API key (undefined in local/dev mode). */
    appRecord?: AppRecord;
  }
}

// /credits/webhook is public to the apiKey layer — Stripe authenticates it via
// its signature header instead.
const PUBLIC_PREFIXES = ['/health', '/docs', '/credits/webhook'];

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (path === '/') return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function extractKey(req: FastifyRequest): string | undefined {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return undefined;
}

export async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.server.appEnv === 'local') return; // local dev — no key required
  if (isPublic(req.url)) return;

  const key = extractKey(req);
  if (!key) {
    await reply.code(401).send({ error: 'Unauthorized: missing API key.' });
    return;
  }

  const app = await getAppByApiKey(key);
  if (!app) {
    await reply.code(401).send({ error: 'Unauthorized: invalid or inactive API key.' });
    return;
  }

  req.appRecord = app;
}

/** Guards admin-only routes (backoffice). Must run after apiKeyAuth. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.server.appEnv === 'local') return; // local dev — allow
  if (req.appRecord?.role !== 'admin') {
    await reply.code(403).send({ error: 'Forbidden: admin API key required.' });
  }
}
