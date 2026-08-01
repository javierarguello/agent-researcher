/**
 * Cloudflare Turnstile verification — the shared half of the bot check.
 *
 * Generic on purpose: it knows nothing about routes, apps or frameworks, so any
 * service in this monorepo (and any app added later) can protect a flow by
 * calling `verifyCaptcha`. The API wires it to routes in `apps/api/src/captcha.ts`.
 *
 * Flow: browser widget → our backend → this siteverify call. **Never** call
 * siteverify from the browser; the secret would be exposed and the verdict
 * forgeable.
 *
 * The whole thing is OFF until `TURNSTILE_SECRET` is set, so a deployment or test
 * that hasn't configured it behaves exactly as before. Once configured,
 * verification fails CLOSED: an unreachable Cloudflare rejects the request rather
 * than waving it through, because everything it guards either costs money
 * (emails, credits, tokens) or CPU, and the retry is cheap.
 *
 * Turnstile tokens are single-use and short-lived (~5 minutes). A client cannot
 * reuse one token across two calls — each protected request needs its own solve.
 */
import { config } from '../config.js';
import { logEvent } from '../obs/log.js';

/** The canonical siteverify endpoint. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The field name Turnstile's widget uses; the canonical place to read a token from. */
export const TURNSTILE_TOKEN_FIELD = 'cf-turnstile-response';

/** True when a secret is configured; callers skip the check otherwise. */
export function captchaEnabled(): boolean {
  return !!config.captcha.secret;
}

export interface CaptchaResult {
  ok: boolean;
  /** Machine-readable reason when rejected (for logs; never shown verbatim). */
  reason?: string;
}

/**
 * Verify a client-supplied Turnstile token against Cloudflare.
 *
 * `remoteIp` should be the client IP the edge actually saw (see `clientIp()` in
 * the API) — it is optional, but it improves Cloudflare's signal.
 */
export async function verifyCaptcha(token: string | undefined, remoteIp?: string): Promise<CaptchaResult> {
  if (!captchaEnabled()) return { ok: true };
  // Trimmed: a whitespace-only token is not a token. Untrimmed it is truthy, so it
  // reached Cloudflare — an outbound request, and a 5s timeout held open, for a
  // string that could never verify.
  if (!token || typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({
    secret: config.captcha.secret,
    response: token,
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  let data: { success?: boolean; 'error-codes'?: string[] };
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    data = (await res.json()) as typeof data;
  } catch (err) {
    // Fail closed, but make the outage visible — a silently failing captcha is
    // indistinguishable from one that was never wired up.
    logEvent({ jobId: '-' }, 'ERROR', 'captcha.verify_failed', { message: (err as Error).message });
    return { ok: false, reason: 'verify_unavailable' };
  }

  // The only thing that lets a request through.
  if (data.success !== true) {
    return { ok: false, reason: (data['error-codes'] ?? ['rejected']).join(',') };
  }
  return { ok: true };
}
