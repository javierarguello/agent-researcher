/**
 * Invisible bot check for the unauthenticated forms (signup, contact).
 *
 * Both supported providers are "no puzzle" by design — the user never solves
 * anything, the widget resolves in the background and hands the client a token:
 *
 *  - **Cloudflare Turnstile** (default): free at any volume, managed mode almost
 *    never interrupts, no Google account needed.
 *  - **Google reCAPTCHA v3**: returns a 0..1 score instead of a challenge; free
 *    for the first 10k assessments/month, billed per assessment above that.
 *
 * The whole thing is OFF until `CAPTCHA_SECRET` is set, so deployments and tests
 * that haven't configured a provider behave exactly as before. Verification fails
 * CLOSED — if the provider can't be reached we reject, because this only guards
 * endpoints that cost money (emails, password hashing) and has a cheap retry.
 */
import { config } from '../config.js';
import { logEvent } from '../obs/log.js';

const ENDPOINTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
} as const;

/** True when a provider is configured; callers skip the check otherwise. */
export function captchaEnabled(): boolean {
  return !!config.captcha.secret;
}

export interface CaptchaResult {
  ok: boolean;
  /** Machine-readable reason when rejected (for logs, never shown verbatim). */
  reason?: string;
}

/**
 * Verify a client-supplied captcha token. `remoteIp` is optional but improves
 * both providers' signal.
 */
export async function verifyCaptcha(token: string | undefined, remoteIp?: string): Promise<CaptchaResult> {
  if (!captchaEnabled()) return { ok: true };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret: config.captcha.secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let data: { success?: boolean; score?: number; 'error-codes'?: string[] };
  try {
    const res = await fetch(ENDPOINTS[config.captcha.provider] ?? ENDPOINTS.turnstile, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    data = (await res.json()) as typeof data;
  } catch (err) {
    // Fail closed, but make the outage visible — a silently failing captcha is
    // indistinguishable from one that isn't wired up.
    logEvent({ jobId: '-' }, 'ERROR', 'captcha.verify_failed', { message: (err as Error).message });
    return { ok: false, reason: 'verify_unavailable' };
  }

  if (!data.success) return { ok: false, reason: (data['error-codes'] ?? ['rejected']).join(',') };
  // reCAPTCHA v3 always "succeeds"; the score is the actual signal.
  if (config.captcha.provider === 'recaptcha' && typeof data.score === 'number' && data.score < config.captcha.minScore) {
    return { ok: false, reason: `low_score:${data.score}` };
  }
  return { ok: true };
}
