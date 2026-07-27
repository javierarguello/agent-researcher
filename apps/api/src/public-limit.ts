/**
 * Abuse limits for the UNAUTHENTICATED endpoints.
 *
 * `/auth/register`, `/auth/session`, `/auth/request-password-reset` and
 * `/contact` have no session to meter against, yet each one costs real money:
 * a Postmark send (and, worse, our sender reputation if someone bombs a third
 * party's inbox), a password hash, a Firestore round-trip. They were the only
 * unmetered surface left in the API.
 *
 * Two layers, on purpose:
 *  - a per-instance BURST guard in memory: absorbs a flood without turning it
 *    into one Firestore transaction per request;
 *  - a SUSTAINED per-hour counter in Firestore (the same atomic limiter the
 *    research routes use), which is the one that actually holds across the
 *    several Cloud Run instances a flood will spread over.
 *
 * Limits are keyed by client IP and, where it matters, by the target email — so
 * one address can't be password-sprayed or mail-bombed from many IPs.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { checkRateLimits, config, logEvent, type RateLimitEntry } from '@agent-researcher/core';

// --- Client IP ---------------------------------------------------------------

/**
 * The client IP, resolved so a caller cannot forge it. Infrastructure appends to
 * `X-Forwarded-For`, so the trustworthy entry is counted from the RIGHT: with
 * `proxyHops = 1` (Cloud Run) we drop the Google front end and take what it saw,
 * which is the real peer even when the caller sent their own header.
 */
export function clientIp(req: FastifyRequest): string {
  const raw = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length) {
    const idx = Math.max(0, chain.length - 1 - Math.max(0, config.server.proxyHops));
    return chain[idx] ?? req.ip;
  }
  return req.ip;
}

// --- Burst guard (per instance) ---------------------------------------------

const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;

/** Test seam: drop the in-memory window. */
export function __resetBurst(): void {
  hits.clear();
}

/** False when this IP is over `perMinute` requests in the last minute. */
export function burstOk(ip: string, perMinute = config.publicLimits.burstPerMinute, now = Date.now()): boolean {
  if (perMinute <= 0) return true;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= perMinute) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Opportunistic cleanup so a long-lived instance doesn't accumulate IPs.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return true;
}

// --- Route guard -------------------------------------------------------------

export interface PublicLimitSpec {
  /** Route id used in the counter key, e.g. 'register'. */
  route: string;
  /** Per-IP hourly cap (0/undefined = no IP limit beyond the burst guard). */
  perIp?: number;
  /** Per-target hourly cap plus the target (an email), when the route has one. */
  perKey?: { limit?: number; value?: string };
}

/**
 * Enforce the limits for one public route. Returns true when it has already sent
 * a 429 — the handler must return immediately in that case.
 */
export async function publicLimit(req: FastifyRequest, reply: FastifyReply, spec: PublicLimitSpec): Promise<boolean> {
  const ip = clientIp(req);

  const tooFast = !burstOk(ip);
  const entries: RateLimitEntry[] = [];
  if (!tooFast) {
    if (spec.perIp) entries.push({ key: `pub:${spec.route}:ip:${ip}`, limit: spec.perIp, scope: 'ip' });
    const target = spec.perKey?.value?.trim().toLowerCase();
    if (spec.perKey?.limit && target) {
      entries.push({ key: `pub:${spec.route}:key:${target}`, limit: spec.perKey.limit, scope: 'target' });
    }
  }

  const rl = tooFast ? { allowed: false, violation: { scope: 'burst', limit: config.publicLimits.burstPerMinute, count: 0 } } : await checkRateLimits(entries);
  if (rl.allowed) return false;

  logEvent({ jobId: '-' }, 'WARNING', 'public.rate_limited', { route: spec.route, scope: rl.violation?.scope ?? 'burst', ip });
  reply.header('Retry-After', tooFast ? '60' : '3600');
  await reply.code(429).send({
    error: 'Too many requests. Please wait a moment and try again.',
    code: 'rate_limited',
    scope: rl.violation?.scope,
  });
  return true;
}
