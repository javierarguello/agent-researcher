/**
 * Route-level Turnstile guard.
 *
 * The verification itself lives in `@agent-researcher/core` (shared by every
 * service); this is the thin Fastify binding: pull the token out of the request,
 * verify it against Cloudflare with the client IP the edge actually saw, and stop
 * the request before the handler runs.
 *
 * Generic by design — a route opts in with one line:
 *
 *   app.post('/thing', { preHandler: requireCaptcha('my-flow'), schema: {...} }, handler)
 *
 * …and whether that flow is enforced is then a deployment decision
 * (`TURNSTILE_FLOWS`), not a code change. A new app in this monorepo gets the
 * same behaviour by importing this module; there is nothing app-specific here.
 *
 * Off entirely until `TURNSTILE_SECRET` is set.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { captchaEnabled, config, logEvent, verifyCaptcha, TURNSTILE_TOKEN_FIELD } from '@agent-researcher/core';
import { clientIp, burstOkOnce } from './public-limit.js';

/**
 * A named user action a widget can be attached to. Adding one is just adding a
 * string — keep it stable, since `TURNSTILE_FLOWS` references it by name.
 */
export type CaptchaFlow = 'register' | 'login' | 'password-reset' | 'contact' | 'research' | 'preflight';

/**
 * Where a token may arrive. `cf-turnstile-response` is the canonical name the
 * widget itself uses (a native form POST sends exactly this); the JSON clients in
 * this repo send the same name in the body, and the header form exists for
 * clients that would rather not touch their payload shape.
 */
function tokenFrom(req: FastifyRequest): string | undefined {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const candidates = [body[TURNSTILE_TOKEN_FIELD], body.captchaToken, req.headers[TURNSTILE_TOKEN_FIELD]];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * The app a request belongs to: from the verified session when there is one,
 * otherwise from the body (the anonymous forms all carry `appId`).
 */
function appIdOf(req: FastifyRequest): string {
  const fromToken = req.auth?.appId;
  if (fromToken) return fromToken;
  const body = (req.body ?? {}) as { appId?: unknown };
  return typeof body.appId === 'string' ? body.appId : '';
}

/**
 * Whether this particular request must carry a solved token. Three switches, all
 * deployment-level: a secret must be configured, the flow must be enabled, and
 * the calling app must be one whose UI actually renders the widget — otherwise a
 * client that never had a widget (the admin SPA, a server-to-server consumer)
 * would be locked out the moment the secret is set.
 */
export function captchaRequired(flow: CaptchaFlow, req?: FastifyRequest): boolean {
  if (!captchaEnabled() || !config.captcha.flows.has(flow)) return false;
  if (!req) return true;
  if (req.auth?.role === 'admin') return false; // already a privileged session
  return config.captcha.apps.has(appIdOf(req));
}

export interface CaptchaOptions {
  /**
   * Narrows the guard to some requests on the route. Use it when one endpoint
   * serves paths with different risk: `/auth/session` takes both a password and a
   * Google id_token, and only the password path is worth a challenge — an
   * id_token is issued by Google and cannot be minted at scale, while the widget
   * would just add a puzzle to a one-click sign-in.
   */
  when?: (req: FastifyRequest) => boolean;
}

/**
 * Fastify preHandler enforcing Turnstile for one flow. Returns 403 with a
 * machine-readable `code` so a client can tell "solve it again" apart from a
 * genuine authorization failure.
 */
export function requireCaptcha(flow: CaptchaFlow, opts: CaptchaOptions = {}): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!captchaRequired(flow, req)) return;
    if (opts.when && !opts.when(req)) return;

    const ip = clientIp(req);
    // The burst window FIRST, and this is the whole point of the ordering.
    //
    // `verifyCaptcha` is an outbound call to Cloudflare holding a 5s timeout. It
    // used to run before any rate limit, because the limit lives in the route
    // guard and this is a preHandler — so 80 registrations with a junk token
    // produced 80 outbound calls and 80 held connections. The attacker's cost is
    // one HTTP request; ours was a socket and five seconds.
    //
    // It COUNTS here, and marks the request so the route guard does not count it
    // again. A read-only peek was the first attempt and it does not work: the
    // window is filled by the guard, which a request rejected at the captcha never
    // reaches — so junk tokens never counted and were never limited, which is
    // exactly the traffic this is for.
    if (!burstOkOnce(req as { __burstCounted?: boolean }, ip)) {
      logEvent({ jobId: '-', appId: req.auth?.appId }, 'WARNING', 'captcha.burst_skipped', { flow, ip });
      await reply.code(429).send({ error: 'Too many requests. Please try again in a moment.', code: 'rate_limited' });
      return reply;
    }

    const result = await verifyCaptcha(tokenFrom(req), ip);
    if (result.ok) return;

    logEvent({ jobId: '-', appId: req.auth?.appId, userId: req.auth?.email }, 'WARNING', 'captcha.rejected', {
      flow,
      reason: result.reason,
      ip,
    });
    await reply.code(403).send({
      error: 'We could not verify that you are human. Please reload the page and try again.',
      code: 'captcha_failed',
    });
  };
}

/** The JSON-schema fragment routes add so the token isn't stripped by validation. */
export const captchaBodyProperties = {
  [TURNSTILE_TOKEN_FIELD]: {
    type: 'string',
    maxLength: 4096,
    description: 'Cloudflare Turnstile token from the widget. Required when the flow is protected.',
  },
  captchaToken: {
    type: 'string',
    maxLength: 4096,
    description: `Alias for \`${TURNSTILE_TOKEN_FIELD}\`.`,
  },
} as const;
