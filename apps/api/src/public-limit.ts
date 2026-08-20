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
import { checkRateLimits, config, logEvent, tooManyRequestsNotice, type RateLimitEntry } from '@agent-researcher/core';
import { errorLang } from './req-lang.js';

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
 * Which burst window a route counts into — the half of `PublicLimitSpec` the
 * captcha preHandler also needs.
 *
 * It is a named type because `requireCaptcha` REQUIRES one: the two places that
 * count a request had to agree, and agreement by convention lasted exactly as
 * long as the person who wrote it remembered. See `CaptchaOptions.burst`.
 */
export type BurstWindow = Pick<PublicLimitSpec, 'route' | 'isolatedBurst'>;

/**
 * The window a route counts against: its own when it is isolated, the shared one
 * otherwise. One definition, used by both the captcha preHandler and the route
 * guard, so the two cannot disagree about which bucket a request belongs in.
 */
export function burstKeyFor(ip: string, spec?: BurstWindow): string {
  return spec?.isolatedBurst && spec.route ? `${spec.route}:${ip}` : ip;
}

/**
 * Count this request against its window from the EARLIEST point, and say whether
 * it may proceed.
 *
 * Called by the captcha preHandler. A read-only peek was the first attempt and it
 * does not work: the window is filled by the route guard, which a request
 * rejected at the captcha never reaches — so an attacker sending junk tokens
 * never counts and is never limited, which is the whole scenario.
 *
 * It records WHICH key it counted, so `publicLimit` does not count the same one a
 * second time (that would halve the effective limit for everybody) and does not
 * skip a DIFFERENT one. The first version stored a boolean, so a captcha'd route
 * that asked for its own window was counted against the shared one here and then
 * skipped entirely there — `isolatedBurst` silently doing nothing, on exactly the
 * routes it exists for.
 */
export function burstOkOnce(req: { __burstKey?: string }, key: string): boolean {
  if (req.__burstKey === key) return true;
  req.__burstKey = key;
  return burstOk(key);
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

  // Counted once, in whichever window this route uses. The captcha preHandler
  // counts the same key when it runs, and says so on the request.
  const key = burstKeyFor(ip, spec);
  const counted = (req as { __burstKey?: string }).__burstKey;

  // The second half of the `isolatedBurst` guard, and the reason it is here
  // rather than in a startup assertion: nothing at boot can see these specs. They
  // are built inside handlers, one per request, so the earliest moment the two
  // windows can be compared is the first request that uses both.
  //
  // `requireCaptcha` now REQUIRES a burst window, so the omission this catches
  // cannot compile — what is left is the two declarations disagreeing, which the
  // type system cannot see. It costs a route double: counted into the shared `ip`
  // window by the captcha and into `route:ip` here, draining the window that
  // meters sign-in and registration for everyone behind one CGNAT address.
  //
  // ERROR, not a silent correction: a mismatch is a wiring bug in our code, not
  // a condition a caller can cause, and it will not be found by looking at the
  // product. Only the second count is dropped — of the two wrong behaviours,
  // under-metering one route is far cheaper than locking a whole carrier NAT out
  // of signing in.
  if (counted !== undefined && counted !== key) {
    logEvent({ jobId: '-' }, 'ERROR', 'public.burst_window_mismatch', { route: spec.route, countedAs: counted, expected: key });
  }
  const tooFast = counted !== undefined ? false : !burstOk(key);
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
  const wait = tooFast ? 60 : secondsToNextHour();
  reply.header('Retry-After', String(wait));
  await reply.code(429).send({
    // In the person's language. Every unauthenticated endpoint answers through this
    // one function, and it answered all of them in English — the register, sign-in
    // and password-reset pages included (round 10's B item).
    error: tooManyRequestsNotice(errorLang(req)),
    code: 'rate_limited',
    scope: rl.violation?.scope,
    // The client has read `retryAfterSeconds` off the body since it was written
    // and no limit in this file ever sent it, so `ApiError.retryAfterSeconds` was
    // permanently `undefined` and nothing could tell the user how long to wait.
    retryAfterSeconds: wait,
  });
  return true;
}

/**
 * Seconds until the hourly counter resets.
 *
 * The bucket is a CALENDAR hour (`yyyy-mm-ddTHH` in `checkRateLimits`), not a
 * sliding window, so a flat `3600` was wrong by up to an hour in the direction
 * that matters: it tells someone who can retry in ninety seconds to come back
 * tomorrow morning. Floored at 1 so a client never sees `Retry-After: 0`.
 */
export function secondsToNextHour(now = new Date()): number {
  return Math.max(1, 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds()));
}
