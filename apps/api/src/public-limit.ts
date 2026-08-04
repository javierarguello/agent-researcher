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
 * The client IP, resolved so a caller cannot forge it.
 *
 * Infrastructure APPENDS to `X-Forwarded-For`, so the trustworthy entry is
 * counted from the RIGHT — never the left, which is whatever the caller chose to
 * send. `config.server.proxyHops` says how many trailing entries our own
 * infrastructure added beyond the one that recorded the real peer: 0 when the
 * service is reached directly on `*.run.app` (this deployment), 1 behind a
 * global external load balancer.
 *
 * Set it too high and the index lands on an attacker-written entry, silently
 * turning every per-IP limit off. That is not hypothetical — it shipped that way.
 */
export function clientIp(req: FastifyRequest): string {
  const raw = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hops = Math.max(0, config.server.proxyHops);
  const idx = chain.length - 1 - hops;
  // A chain shorter than the hops we expect means our own infrastructure did not
  // write it — so every entry in it came from the caller. Clamping to 0 here (the
  // obvious-looking `Math.max(0, idx)`) would hand the key straight to them.
  // Fall back to the socket address, which cannot be forged.
  return idx >= 0 ? chain[idx] ?? req.ip : req.ip;
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

/**
 * Count this request against the shared window from the EARLIEST point, and say
 * whether it may proceed.
 *
 * Called by the captcha preHandler. A read-only peek was the first attempt and it
 * does not work: the window is filled by the route guard, which a request
 * rejected at the captcha never reaches — so an attacker sending junk tokens
 * never counts and is never limited, which is the whole scenario.
 *
 * It marks the request so `publicLimit` does not count it a second time; counting
 * once in two places would halve the effective limit for everybody.
 */
export function burstOkOnce(req: { __burstCounted?: boolean }, ip: string): boolean {
  if (req.__burstCounted) return true;
  req.__burstCounted = true;
  return burstOk(ip);
}

// --- Route guard -------------------------------------------------------------

export interface PublicLimitSpec {
  /** Route id used in the counter key, e.g. 'register'. */
  route: string;
  /** Per-IP hourly cap (0/undefined = no IP limit beyond the burst guard). */
  perIp?: number;
  /** Per-target hourly cap plus the target (an email), when the route has one. */
  perKey?: { limit?: number; value?: string };
  /**
   * Give this route its own burst window instead of the one shared by every
   * public route. Use it for read-only routes that legitimate traffic hits often:
   * otherwise a busy page can exhaust the shared window and 429 sign-in and
   * registration for everyone behind the same egress IP — a corporate NAT, CGNAT
   * or mobile carrier is one address to us.
   *
   * The shared window is the default on purpose: it is what stops someone
   * spreading a flood across routes to stay under each individual cap.
   */
  isolatedBurst?: boolean;
}

/**
 * Enforce the limits for one public route. Returns true when it has already sent
 * a 429 — the handler must return immediately in that case.
 */
export async function publicLimit(req: FastifyRequest, reply: FastifyReply, spec: PublicLimitSpec): Promise<boolean> {
  const ip = clientIp(req);

  // An isolated window is this route's own and is never what the preHandler
  // counted, so it is always checked. The shared one is skipped when the captcha
  // already counted this request.
  const counted = (req as { __burstCounted?: boolean }).__burstCounted === true;
  const tooFast = spec.isolatedBurst
    ? !burstOk(`${spec.route}:${ip}`)
    : counted
      ? false
      : !burstOk(ip);
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
