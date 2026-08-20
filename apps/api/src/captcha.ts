/**
 * Route-level Turnstile guard.
 *
 * The verification itself lives in `@agent-researcher/core` (shared by every
 * service); this is the thin Fastify binding: pull the token out of the request,
 * verify it against Cloudflare with the client IP the edge actually saw, and stop
 * the request before the handler runs.
 *
 * Generic by design — a route opts in with one line, naming the burst window it
 * shares with its own rate limit (see `CaptchaOptions.burst` for why that is not
 * optional):
 *
 *   const THING_BURST = { route: 'thing' } as const;
 *   app.post('/thing', { preHandler: requireCaptcha('my-flow', { burst: THING_BURST }), schema: {...} }, handler)
 *
 * …and whether that flow is enforced is then a deployment decision
 * (`TURNSTILE_FLOWS`), not a code change. A new app in this monorepo gets the
 * same behaviour by importing this module; there is nothing app-specific here.
 *
 * Off entirely until `TURNSTILE_SECRET` is set.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { captchaEnabled, config, logEvent, tooManyRequestsNotice, verifyCaptcha, TURNSTILE_TOKEN_FIELD } from '@agent-researcher/core';
import { clientIp, burstOkOnce, burstKeyFor, type BurstWindow } from './public-limit.js';
import { errorLang } from './req-lang.js';

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
   * The route's burst window — the same object its `publicLimit` spec is built
   * from, so the burst counted here lands where the route guard looks for it.
   *
   * REQUIRED, and that is the whole fix. It was optional, which made
   * `isolatedBurst` a two-place opt-in with nothing enforcing the second place:
   * a captcha'd route that asked for its own window and forgot this was counted
   * into the SHARED one here and into `route:ip` there — twice, and the half that
   * mattered drained the window metering sign-in and registration for everyone
   * behind one CGNAT address. Nothing failed; the isolation simply did not
   * happen. Now the omission does not compile, and a route that shares the
   * default window says so by passing a spec without `isolatedBurst` rather than
   * by saying nothing at all.
   *
   * Two declarations that disagree are still possible — pass the SAME object,
   * and see `publicLimit` for the runtime check that shouts when they don't.
   */
  burst: BurstWindow;
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
export function requireCaptcha(flow: CaptchaFlow, opts: CaptchaOptions): preHandlerHookHandler {
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
    if (!burstOkOnce(req as { __burstKey?: string }, burstKeyFor(ip, opts.burst))) {
      logEvent({ jobId: '-', appId: req.auth?.appId }, 'WARNING', 'captcha.burst_skipped', { flow, ip });
      // Same shape as `publicLimit`'s 429, which this one did not have: no
      // `Retry-After` header at all, and no `retryAfterSeconds` for the client
      // that reads it. A 429 that cannot say how long to wait is a dead end.
      reply.header('Retry-After', '60');
      await reply.code(429).send({
        // In the person's language. This is a preHandler on register, login and
        // password-reset — the three doors a NEW buyer walks through — and it sent
        // an English sentence into a page translated into four.
        error: tooManyRequestsNotice(errorLang(req)),
        code: 'rate_limited',
        scope: 'burst',
        retryAfterSeconds: 60,
      });
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
