/**
 * agent-researcher API (Cloud Run Service, scale-to-0).
 *
 * Lightweight BFF: verifies the caller's session JWT, validates the request,
 * consumes credits, records the job in Firestore, and enqueues a Cloud Task for
 * the worker Service. It never runs research inline, so requests return in
 * milliseconds and the service scales to zero.
 *
 * Auth: user session JWT (Authorization: Bearer), issued by POST /auth/session
 * after verifying a Google id_token. appId + userId come from the token. Admin
 * tokens (whitelisted emails on the admin app) unlock /admin/*. Docs: /docs.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyError, FastifyReply } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  config,
  createApp,
  getApp,
  deleteApp,
  checkRateLimits,
  peekRateLimits,
  createJob,
  consumeActionToken,
  credentialsStillValid,
  inFlightSlots,
  claimJobSlot,
  releaseJobSlot,
  releaseUnclaimedSlot,
  setJobSlotHeld,
  markFailed,
  getJob,
  getSettings,
  listApps,
  listJobs,
  getUserJobStats,
  queryJobs,
  requeueJob,
  approveHold,
  rejectHold,
  noteJobResolution,
  closedNotice,
  parkJob,
  getAdminStats,
  queryUsers,
  listTemplates,
  getTemplate,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  logEvent,
  downloadObject,
  downloadObjectBytes,
  toManifest,
  toPublicApp,
  updateApp,
  updateSettings,
  validateRequest,
  tooManyRequestsNotice,
  moderateResearchParams,
  moderationMessage,
  blockedMessage,
  rateLimitNotice,
  asLang,
  runPreflight,
  modeLabel,
  type AssistState,
  type Lang,
  getUserFlags,
  recordModerationStrike,
  setUserBlocked,
  MODERATION_STRIKE_LIMIT,
  reserveAssistedReview,
  resetAssistAllowance,
  resolveMode,
  getModelPricing,
  setModelPricing,
  resolveModeCredits,
  type ModelPricing,
  consumeCredits,
  refundForJob,
  wasJobRefunded,
  wasJobConsumed,
  recordReportStats,
  getBalance,
  listTransactions,
  grantCredits,
  recordPurchase,
  recordPurchaseStats,
  recordRequestLlmCost,
  recordModerationDegraded,
  recordLogin,
  signSession,
  signReadToken,
  signActionToken,
  verifyGoogleIdToken,
  verifySession,
  hashPassword,
  verifyPassword,
  passwordProblem,
  normalizeEmail,
  isSingleEmail,
  isDisposableEmail,
  getCredential,
  createPasswordUser,
  setEmailVerified,
  setPassword,
  upsertGoogleUser,
  UserExistsError,
  sendAppEmail,
  EmailNotConfiguredError,
  verifyEmailTemplate,
  resetPasswordTemplate,
  reportStartedTemplate,
  creditsPurchasedTemplate,
  InsufficientCreditsError,
  type RateLimitEntry,
  type LedgerEntryType,
  type JobStatus,
  clientProgress,
  resolveModeCeiling,
  creditFloorFrom,
  modesOf,
  getCatalog,
  listCatalogs,
  modeShapes,
} from '@agent-researcher/core';
import type Stripe from 'stripe';
import { forgetCachedCredential, jwtAuth, requireAdmin } from './auth.js';
import { stripe, stripeConfigured, listStripePlans, resolveStripePlan, isValidAppId, upsertStripePlan, archiveStripePlan } from './stripe.js';
import { cached, bustPublicCache, PUBLIC_TTL_MS, PUBLIC_EMPTY_TTL_MS, PUBLIC_BROWSER_MAX_AGE, PUBLIC_BROWSER_SWR } from './cache.js';
import { publicLimit, clientIp, secondsToNextHour } from './public-limit.js';
import { requireCaptcha, captchaBodyProperties } from './captcha.js';
import { errorLang } from './req-lang.js';

/**
 * The burst window each captcha'd route counts into — one object per route, read
 * by BOTH the captcha preHandler and the route's own `publicLimit` call.
 *
 * They are here together, and not inline at each route, because the decision they
 * encode is only reviewable as a set: everything on the SHARED window is what
 * stops someone spreading a flood across routes to stay under each individual
 * cap, and every `isolatedBurst` taken out of it is a route that can no longer
 * contribute to that. Isolation is for read routes legitimate traffic hits often
 * (see `/research/preflight`) — a busy page must not exhaust the shared window
 * and 429 sign-in for everyone behind a corporate NAT, CGNAT or mobile carrier,
 * all of which are one address to us.
 *
 * `requireCaptcha` takes one of these because it must: it counts the request
 * before the handler runs, and when the two disagreed about the window the
 * request was counted twice — the isolation silently doing nothing, on exactly
 * the routes it exists for. `perIp`/`perKey` stay at the call site, where they
 * are read per request from live config.
 */
const BURST = {
  login: { route: 'login' },
  register: { route: 'register' },
  // `reset`, not `password-reset`: the flow name and the counter's route id are
  // different namespaces, and this is the id every `pub:reset:*` bucket is keyed
  // on. Copying the flow name here would have quietly split the counter.
  passwordReset: { route: 'reset' },
  contact: { route: 'contact' },
  // Authenticated and metered by the report quota rather than by `publicLimit`,
  // so it has no second declaration to disagree with — it still names its window
  // rather than leaving it to be guessed.
  research: { route: 'research' },
} as const;

// bodyLimit caps every request body at 512 KB — far above any legitimate payload
// (research params are bounded per-field, a Google id_token is ~2 KB, Stripe
// events are small) but blocks an attacker from sending a huge body at all.
const app = Fastify({ logger: { level: config.server.logLevel }, bodyLimit: 512 * 1024 });

// Keep the raw JSON body on the request (Stripe webhook signature needs it),
// while still parsing JSON normally for every other route.
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
  try {
    const buf = body as Buffer;
    done(null, buf.length ? JSON.parse(buf.toString('utf8')) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

// --- OpenAPI / Swagger ------------------------------------------------------
await app.register(swagger, {
  openapi: {
    info: {
      title: 'agent-researcher API',
      version: '0.1.0',
      description: [
        'Deep-research API: submit a research request against a **model** (template), poll the job, and',
        'download the generated report via short-lived signed URLs. This spec is self-sufficient for building',
        'a frontend — no other knowledge required.',
        '',
        '### Build a frontend in 5 steps',
        '1. **Log in** — `POST /auth/session` with `{ appId, provider:"google", idToken }` → `{ token }` (a',
        '   session JWT). Send it as `Authorization: Bearer <token>` on every other call. appId+userId come',
        '   from the token, never the body.',
        '2. **List models** — `GET /templates?lang=<en|es|…>` → each item is a self-contained *manifest*:',
        '   `paramsSchema` (JSON Schema — validate + generate the input form), `paramsUi` (layout `rows`,',
        '   per-field `help`/`suggestions`/`optionLabels`/`placeholder`, `ranges` = min/max sliders, `advanced`',
        '   = collapsed fields), `directives` (structured preference fields with localized labels + options —',
        '   submit the picks under `directivesKey`), `modes` (report tiers with their **credit cost**), and `sections`/`reportSchema`',
        '   (the report structure). All display texts are localized to `lang` (default `en`). The list is scoped',
        '   to the app’s allowed models.',
        '3. **Show credits** — `GET /credits/balance`; buy more via `GET /credits/plans` + `POST /credits/checkout`.',
        '4. **Run** — `POST /research { template, params }` → `202 { jobId }`. Params are validated against the',
        '   model’s `paramsSchema`; the chosen `mode` costs its `modes[].credits`.',
        '5. **Poll** — `GET /research/:jobId` until `status:"completed"` (or `failed`); a completed job returns',
        '   `files[]` with signed download URLs. `progress`/`summary` drive a live view.',
        '',
        'See docs/model-ui.md for the form-generation pattern. Errors are `{ error: string }` with a 4xx/5xx code.',
      ].join('\n'),
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'auth', description: 'Login: exchange a provider identity for a session token' },
      { name: 'templates', description: 'Research models: self-contained manifests (form schema + UI hints + texts + credits), scoped per app, localizable via ?lang' },
      { name: 'research', description: 'Create, list, and poll research jobs' },
      { name: 'credits', description: 'Credit balance + ledger (shared billing)' },
      { name: 'admin', description: 'Management + stats (admin token required)' },
    ],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs' });

// CORS for the static web frontends.
await app.register(cors, {
  origin: config.cors.origins === '*' ? true : config.cors.origins.split(',').map((o) => o.trim()),
});

// --- Auth (after swagger so /docs stays public) -----------------------------
/**
 * What a caller learns when something we did not anticipate goes wrong.
 *
 * Fastify's default returns `err.message` on a 500, so an unhandled Firestore or
 * GCS error handed its own text — collection names, document paths, project
 * identifiers — to whoever made the request. Validation errors (which Fastify
 * raises with a `statusCode` and a message we wrote in the schema) still go back
 * as they are; anything else is logged in full and answered with one sentence.
 */
app.setErrorHandler((err: FastifyError, req, reply) => {
  // Only OUR 4xx text goes back. Fastify's validation errors carry `.validation`
  // and a message we wrote in the schema; a third-party SDK error carries a
  // `statusCode` too, and trusting that echoed a Stripe key or an upstream account
  // detail verbatim. Everything else keeps its status and loses its words.
  const status = err.statusCode ?? 500;
  if (status < 500 && err.validation) {
    return reply.code(status).send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  if (status < 500) {
    req.log.warn({ err, url: req.url }, 'upstream 4xx');
    return reply.code(status).send({ error: 'That request could not be completed.' });
  }
  req.log.error({ err, url: req.url }, 'unhandled error');
  return reply.code(500).send({ error: 'Something went wrong on our side. Please try again.' });
});

app.addHook('onRequest', jwtAuth);

const sec = [{ bearerAuth: [] }];

// --- Health -----------------------------------------------------------------
app.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));

// --- Auth: exchange a provider identity for a session token -----------------
app.post(
  '/auth/session',
  {
    schema: {
      summary: 'Log in: verify a provider identity, return a session JWT',
      description:
        "Send { appId, provider, ...credentials }. provider='google' takes an `idToken`; " +
        "provider='password' takes `email` + `password` (the email must already be verified — " +
        'register via POST /auth/register first). Regular apps allow any Google account; the admin app only whitelisted emails.',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['appId', 'provider'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', minLength: 1, maxLength: 128 },
          provider: { type: 'string', enum: ['google', 'password'] },
          idToken: { type: 'string', maxLength: 8192, description: "Google id_token (provider='google')." },
          email: { type: 'string', maxLength: 320, description: "Email (provider='password')." },
          password: { type: 'string', maxLength: 200, description: "Password (provider='password')." },
          ...captchaBodyProperties,
        },
      },
    },
    // Password sign-in only: a Google id_token already proves an account Google
    // vouched for, and the Google button never renders a widget to solve.
    preHandler: requireCaptcha('login', { burst: BURST.login, when: (req) => (req.body as { provider?: string } | undefined)?.provider === 'password' }),
  },
  async (req, reply) => {
    const b = req.body as { appId?: string; provider?: string; idToken?: string; email?: string; password?: string };
    if (!b.appId || !b.provider) return reply.code(400).send({ error: 'appId and provider are required.' });

    // Unauthenticated + does password hashing → limit per IP and per target email
    // so neither a spray across accounts nor a brute force on one is cheap.
    if (
      await publicLimit(req, reply, {
        ...BURST.login,
        perIp: config.publicLimits.loginPerHourPerIp,
        perKey: { limit: config.publicLimits.loginPerHourPerEmail, value: normalizeEmail(b.email ?? '') },
      })
    ) return reply;

    const appRec = await getApp(b.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: `Unknown or inactive app: ${b.appId}` });

    // Verify identity (dispatch on provider).
    let identity: { email: string; name?: string };
    if (b.provider === 'google') {
      if (!appRec.googleClientId) return reply.code(400).send({ error: 'App has no googleClientId configured.' });
      if (!b.idToken) return reply.code(400).send({ error: 'idToken is required for provider "google".' });
      try {
        const verified = await verifyGoogleIdToken(b.idToken, appRec.googleClientId);
        // Google only proves the address when it says so. An id_token can carry an
        // email the account never verified (the classic unverified-alias case), and
        // accepting it would both hand over a session for someone else's address
        // and stamp their record as verified. `email_verified` is the whole reason
        // this path may skip the verification gate the password path enforces.
        if (!verified.emailVerified) {
          logEvent({ jobId: '-', appId: appRec.appId, userId: verified.email }, 'WARNING', 'auth.google_unverified', {});
          return reply.code(403).send({
            error: 'This Google account has not verified its email address. Verify it with Google, or sign in with a password.',
            code: 'email_unverified',
          });
        }
        // Link Google to the app+email record and mark it verified — the same email
        // used with a password is the SAME user.
        await upsertGoogleUser({ appId: appRec.appId, email: verified.email, name: verified.name });
        // Normalize to the same identity the password path uses. The abuse counters
        // (blocks, strikes, allowances, credits, rate limits) are all keyed on the
        // session email, so `j.doe@gmail.com` and `jdoe@gmail.com` resolving to two
        // different keys would let a blocked user walk around the block by switching
        // login button.
        identity = { email: normalizeEmail(verified.email), name: verified.name };
      } catch (err) {
        return reply.code(401).send({ error: `Google verification failed: ${(err as Error).message}` });
      }
    } else if (b.provider === 'password') {
      const email = normalizeEmail(b.email ?? '');
      if (!email || !b.password) return reply.code(400).send({ error: 'email and password are required.' });
      const cred = await getCredential(appRec.appId, email);
      // Same generic 401 whether the user is missing or the password is wrong (no enumeration).
      if (!cred || !cred.passwordHash || !(await verifyPassword(b.password, cred.passwordHash))) {
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }
      if (!cred.emailVerified) {
        return reply.code(403).send({ error: 'Please verify your email before signing in.', code: 'email_unverified' });
      }
      identity = { email: cred.email, name: cred.name };
    } else {
      return reply.code(400).send({ error: `Unknown auth provider "${b.provider}".` });
    }

    // Authorization: admin app requires the email to be whitelisted.
    let role: 'user' | 'admin' = 'user';
    if (appRec.role === 'admin') {
      const whitelist = (appRec.adminEmails ?? []).map((e) => e.toLowerCase());
      if (!whitelist.includes(identity.email)) {
        return reply.code(403).send({ error: 'This email is not allowed to log into this app.' });
      }
      role = 'admin';
    }

    const token = await signSession({ email: identity.email, appId: appRec.appId, role, name: identity.name });
    // Make the user visible in the admin from their very first login (even before
    // any report or purchase). Never let a stats hiccup break login.
    await recordLogin(appRec.appId, identity.email).catch((err) =>
      logEvent({ jobId: '-', appId: appRec.appId, userId: identity.email }, 'WARNING', 'auth.login_stats_failed', { error: (err as Error).message }),
    );
    logEvent({ jobId: '-', appId: appRec.appId, userId: identity.email }, 'INFO', 'auth.login', { provider: b.provider, role });
    return {
      token,
      user: { email: identity.email, name: identity.name ?? null, role, appId: appRec.appId },
      expiresInSeconds: config.auth.jwtTtlSeconds,
    };
  },
);

// Mint a login session for a verified identity (shared by verify-email + reset).
async function issueSession(appRec: { appId: string; role: string; adminEmails?: string[] }, email: string, name?: string) {
  const role: 'user' | 'admin' =
    appRec.role === 'admin' && (appRec.adminEmails ?? []).map((e) => e.toLowerCase()).includes(email) ? 'admin' : 'user';
  const token = await signSession({ email, appId: appRec.appId, role, name });
  await recordLogin(appRec.appId, email).catch(() => {});
  return { token, user: { email, name: name ?? null, role, appId: appRec.appId }, expiresInSeconds: config.auth.jwtTtlSeconds };
}

app.post(
  '/auth/register',
  {
    schema: {
      summary: 'Register a password account and send an email-verification link',
      description:
        'Creates an unverified account and emails a verification link — the user cannot sign in until they verify. ' +
        "If a verified account already exists for the email (password or Google), returns 409. Retrying an unverified " +
        'registration re-sends the link.',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['appId', 'email', 'password'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', minLength: 1, maxLength: 128 },
          email: { type: 'string', minLength: 3, maxLength: 320 },
          password: { type: 'string', maxLength: 200 },
          name: { type: 'string', maxLength: 200 },
          // The account emails are the only place we know a person's language
          // before they have an account to store it on. `Accept-Language` is what
          // the BROWSER is configured for, which for a Spanish speaker on a US
          // laptop is `en` — so the client sends what the person actually chose,
          // and the header is only the fallback.
          lang: { type: 'string', enum: SUPPORTED_LANGS, description: 'Language for the verification email.' },
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('register', { burst: BURST.register }),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; email: string; password: string; name?: string; lang?: string };
    const email = normalizeEmail(b.email);
    // Exactly ONE address. `To:` takes a comma-separated list, so without this the
    // caller picks who we mail — and the per-target cap keys on the whole string,
    // so every permutation of the list is a fresh bucket.
    if (!isSingleEmail(email)) return reply.code(400).send({ error: 'A valid email is required.' });

    // Every registration sends an email on our Postmark account — the most
    // expensive unauthenticated action in the API, and to an address the caller
    // chose. Cap both dimensions: per IP, and per target inbox so it cannot be
    // bombed from many IPs. `email` is normalized, so the bucket can't be split
    // by adding dots or a +tag.
    if (
      await publicLimit(req, reply, {
        ...BURST.register,
        perIp: config.publicLimits.registerPerHourPerIp,
        perKey: { limit: config.publicLimits.registerPerHourPerEmail, value: email },
      })
    ) return reply;
    // Block throwaway / disposable inboxes (one person → unlimited fake accounts).
    if (isDisposableEmail(email)) {
      return reply.code(400).send({ error: 'You can’t register with a disposable or temporary email address. Please use a permanent personal or work email.', code: 'disposable_email' });
    }
    const pwProblem = passwordProblem(b.password);
    if (pwProblem) return reply.code(400).send({ error: pwProblem });

    const appRec = await getApp(b.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: `Unknown or inactive app: ${b.appId}` });
    if (!appRec.emailFrom || !appRec.webUrl) return reply.code(500).send({ error: 'Email is not configured for this app.' });

    const existing = await getCredential(appRec.appId, email);
    // An already-verified account (or a Google account) can't be re-registered.
    if (existing && (existing.emailVerified || existing.providers.includes('google'))) {
      return reply.code(409).send({ error: 'An account with this email already exists.', code: 'email_taken' });
    }

    const passwordHash = await hashPassword(b.password);
    if (existing) {
      // Guarded: hashing took ~40ms, and if the address became VERIFIED in that
      // window — the owner clicked their link, or signed in with Google — this
      // write would plant a stranger's password on a live account.
      const written = await setPassword(appRec.appId, email, passwordHash, { onlyIfUnverified: true });
      if (!written) return reply.code(409).send({ error: 'An account with this email already exists.', code: 'email_taken' });
    } else {
      try {
        await createPasswordUser({ appId: appRec.appId, email, name: b.name, passwordHash });
      } catch (err) {
        if (err instanceof UserExistsError) return reply.code(409).send({ error: 'An account with this email already exists.', code: 'email_taken' });
        throw err;
      }
    }

    const token = await signActionToken({ email, appId: appRec.appId, scope: 'verify-email' }, config.auth.verifyTtlSeconds);
    const link = `${appRec.webUrl}/verify?token=${encodeURIComponent(token)}`;
    const tpl = verifyEmailTemplate(appRec.name, link, errorLang(req));
    try {
      await sendAppEmail({ app: appRec, to: email, subject: tpl.subject, htmlBody: tpl.html, textBody: tpl.text });
    } catch (err) {
      logEvent({ jobId: '-', appId: appRec.appId, userId: email }, 'ERROR', 'auth.verify_email_failed', { error: (err as Error).message });
      if (err instanceof EmailNotConfiguredError) return reply.code(500).send({ error: 'Email is not configured for this app.' });
      return reply.code(502).send({ error: 'Could not send the verification email. Please try again.' });
    }
    logEvent({ jobId: '-', appId: appRec.appId, userId: email }, 'INFO', 'auth.registered', {});
    return reply.code(202).send({ status: 'verification_sent', email });
  },
);

app.post(
  '/auth/verify-email',
  {
    schema: {
      summary: 'Verify an email address from the emailed link',
      description:
        'Consumes the `verify-email` token from the link and marks the address verified. The password chosen at ' +
        'registration must be supplied with it: anyone can register an address they do not own, so clicking the ' +
        'link proves only that you read the mail. Requiring the password proves you are also the person who ' +
        'signed up. No session is returned — sign in afterwards.',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['token', 'password'],
        additionalProperties: false,
        properties: { token: { type: 'string', maxLength: 4096 }, password: { type: 'string', maxLength: 200 } },
      },
    },
  },
  async (req, reply) => {
    // `verify-token`, not the `token` bucket this used to share with
    // `/auth/reset-password`. They are different acts by different people — one is
    // a brand-new customer finishing signup — and pooling them meant a run of
    // resets behind one address spent the allowance for everyone else's signup.
    if (await publicLimit(req, reply, { route: 'verify-token', perIp: config.publicLimits.tokenPerHourPerIp })) return reply;
    const { token, password } = req.body as { token: string; password: string };
    let claims;
    try {
      claims = await verifySession(token);
    } catch {
      return reply.code(400).send({ error: 'This verification link is invalid or has expired.' });
    }
    if (claims.scope !== 'verify-email') return reply.code(400).send({ error: 'This link is not a verification link.' });
    const appRec = await getApp(claims.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: 'Unknown or inactive app.' });
    const cred = await getCredential(claims.appId, claims.email);
    if (!cred) return reply.code(400).send({ error: 'Account not found.' });

    // The other half of the pre-hijack, and the half that survived not issuing a
    // session here. An attacker registers an address they do not own with a
    // password of their choosing; the victim receives a genuine, correctly signed
    // "verify your email" and clicks it; the attacker then signs in. The earlier
    // reasoning — "if they don't hold the password, forgot-password locks the
    // stranger out" — assumes the victim goes on to TRY to sign in. Someone who
    // only clicked verify never does, and leaves an address stamped verified on a
    // password a stranger chose.
    //
    // So verification proves two things now: you read the mail, and you are the
    // person who signed up. A victim cannot supply a password they never chose,
    // and the account stays unverified and unusable.
    //
    // `!cred.passwordHash ||`, not `cred.passwordHash &&`: the second is the same
    // vacuous shape as the `claims.tokenId &&` shim four lines below, and it means
    // a credential with no hash proves nothing and ANY password verifies.
    // `upsertGoogleUser` deletes the hash of an unverified account while its
    // verification link is still live, so the shape is reachable — and a Google
    // account is already `emailVerified`, which makes refusing this link the
    // correct answer as well as the safe one.
    if (!cred.passwordHash || !(await verifyPassword(password, cred.passwordHash))) {
      logEvent({ jobId: '-', appId: claims.appId, userId: claims.email }, 'WARNING', 'auth.verify_wrong_password', {});
      return reply.code(401).send({ error: 'That password does not match the one chosen when this account was created.' });
    }
    // Redeemed only AFTER the password matched. Consuming it first would mean one
    // typo costs a legitimate user their registration — and would hand an attacker
    // a way to burn someone else's link by guessing wrong on purpose.
    // A link with NO id is refused, not waved through. `claims.tokenId && …` was a
    // migration shim for links minted before `b338240`, and it skipped the
    // one-time check entirely — so any token that lacked an id stayed redeemable
    // for its whole TTL. Those links expired within a day of that deploy; what
    // remains is a hole with nothing legitimate left in it.
    if (!claims.tokenId || !(await consumeActionToken(claims.tokenId))) {
      return reply.code(400).send({ error: 'This verification link has already been used.' });
    }
    await setEmailVerified(claims.appId, claims.email);
    forgetCachedCredential(claims.appId, claims.email);
    logEvent({ jobId: '-', appId: claims.appId, userId: claims.email }, 'INFO', 'auth.email_verified', {});
    // Still no session, for the same reason it was removed: verification is about
    // the address, and signing in is where a session comes from.
    return reply.code(200).send({ status: 'verified', email: claims.email });
  },
);

app.post(
  '/auth/request-password-reset',
  {
    schema: {
      summary: 'Send a password-reset link (always 202, never reveals if the email exists)',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['appId', 'email'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', maxLength: 128 },
          email: { type: 'string', maxLength: 320 },
          lang: { type: 'string', enum: SUPPORTED_LANGS, description: 'Language for the reset email.' },
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('password-reset', { burst: BURST.passwordReset }),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; email: string; lang?: string };
    const email = normalizeEmail(b.email);
    // One recipient, never a list (see /auth/register). Answered like every other
    // rejection on this route — 202, revealing nothing about who exists.
    if (!isSingleEmail(email)) return reply.code(202).send({ ok: true });
    // Sends an email to an address the caller chooses → limit per IP and per
    // target, so it can't be used to mail-bomb someone else's inbox.
    if (
      await publicLimit(req, reply, {
        ...BURST.passwordReset,
        perIp: config.publicLimits.resetPerHourPerIp,
        perKey: { limit: config.publicLimits.resetPerHourPerEmail, value: email },
      })
    ) return reply;
    const appRec = await getApp(b.appId);
    // Only send for an existing password account with email configured; but always
    // return 202 so callers can't probe which emails are registered.
    if (appRec && appRec.active && appRec.emailFrom && appRec.webUrl) {
      const cred = await getCredential(appRec.appId, email);
      // Any credential, not just one that already has a password. Requiring a
      // `passwordHash` meant the two users who most need this got nothing: someone
      // whose unverified password was discarded when they signed in with Google,
      // and anyone who has only ever used the Google button. Both were told "check
      // your email" and no mail was ever sent.
      if (cred) {
        const token = await signActionToken({ email, appId: appRec.appId, scope: 'reset-password' }, config.auth.resetTtlSeconds);
        const link = `${appRec.webUrl}/reset?token=${encodeURIComponent(token)}`;
        const tpl = resetPasswordTemplate(appRec.name, link, errorLang(req));
        await sendAppEmail({ app: appRec, to: email, subject: tpl.subject, htmlBody: tpl.html, textBody: tpl.text }).catch((err) =>
          logEvent({ jobId: '-', appId: appRec.appId, userId: email }, 'ERROR', 'auth.reset_email_failed', { error: (err as Error).message }),
        );
      }
    }
    return reply.code(202).send({ status: 'reset_sent' });
  },
);

app.post(
  '/auth/reset-password',
  {
    schema: {
      summary: 'Set a new password from the emailed reset link, then log in',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['token', 'password'],
        additionalProperties: false,
        properties: { token: { type: 'string', maxLength: 4096 }, password: { type: 'string', maxLength: 200 } },
      },
    },
  },
  async (req, reply) => {
    // Its own bucket — see the note on `/auth/verify-email`.
    if (await publicLimit(req, reply, { route: 'reset-token', perIp: config.publicLimits.tokenPerHourPerIp })) return reply;
    const b = req.body as { token: string; password: string };
    const pwProblem = passwordProblem(b.password);
    if (pwProblem) return reply.code(400).send({ error: pwProblem });
    let claims;
    try {
      claims = await verifySession(b.token);
    } catch {
      return reply.code(400).send({ error: 'This reset link is invalid or has expired.' });
    }
    if (claims.scope !== 'reset-password') return reply.code(400).send({ error: 'This link is not a password-reset link.' });
    const appRec = await getApp(claims.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: 'Unknown or inactive app.' });
    const cred = await getCredential(claims.appId, claims.email);
    if (!cred) return reply.code(400).send({ error: 'Account not found.' });
    // One use per link, and it matters more here: a reset link that reaches a link
    // scanner, an inbox backup or a shared browser was a repeatable account
    // takeover for its whole TTL, each redemption handing out a fresh seven-day
    // session.
    // A link with NO id is refused, not waved through. `claims.tokenId && …` was a
    // migration shim for links minted before `b338240`, and it skipped the
    // one-time check entirely — so any token that lacked an id stayed redeemable
    // for its whole TTL. Those links expired within a day of that deploy; what
    // remains is a hole with nothing legitimate left in it.
    if (!claims.tokenId || !(await consumeActionToken(claims.tokenId))) {
      return reply.code(400).send({ error: 'This reset link has already been used.' });
    }
    const passwordHash = await hashPassword(b.password);
    await setPassword(claims.appId, claims.email, passwordHash);
    // Immediately, not within the cache window: evicting whoever held the old
    // password is the entire point of resetting it.
    forgetCachedCredential(claims.appId, claims.email);
    // Resetting via the emailed link proves ownership — verify the address too.
    if (!cred.emailVerified) await setEmailVerified(claims.appId, claims.email);
    logEvent({ jobId: '-', appId: claims.appId, userId: claims.email }, 'INFO', 'auth.password_reset', {});
    return issueSession(appRec, claims.email, cred.name);
  },
);

app.post(
  '/contact',
  {
    schema: {
      summary: 'Contact / API-access request — emails the internal team from the app',
      description:
        "Sends a contact request to the app's internal inbox (configured server-side, never exposed) from the app's " +
        'own From address, with reply-to set to the requester. If a valid session token is sent, the account email is ' +
        'included. Generic across apps.',
      tags: ['contact'],
      body: {
        type: 'object',
        required: ['appId', 'name', 'email', 'message'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', minLength: 1, maxLength: 128 },
          subject: { type: 'string', maxLength: 200 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          email: { type: 'string', minLength: 3, maxLength: 320 },
          message: { type: 'string', minLength: 1, maxLength: 5000 },
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('contact', { burst: BURST.contact }),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; subject?: string; name: string; email: string; message: string };
    // Anonymous + sends an email on our account.
    if (await publicLimit(req, reply, { ...BURST.contact, perIp: config.publicLimits.contactPerHourPerIp })) return reply;
    // Goes out as Reply-To, which is a recipient field like any other.
    if (!isSingleEmail(normalizeEmail(b.email))) return reply.code(400).send({ error: 'A valid email is required.' });
    const appRec = await getApp(b.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: `Unknown or inactive app: ${b.appId}` });
    if (!appRec.emailFrom) return reply.code(500).send({ error: 'Contact is not configured for this app.' });

    // Optional: if a valid session token came along, note the logged-in account.
    let account = '';
    const authz = req.headers.authorization;
    if (typeof authz === 'string' && authz.startsWith('Bearer ')) {
      try {
        const c = await verifySession(authz.slice(7).trim());
        account = `${c.email} · role ${c.role}`;
      } catch {
        /* ignore invalid token — treat as anonymous */
      }
    }

    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6860;font-size:13px;vertical-align:top">${k}</td><td style="padding:4px 0;font-size:14px;color:#2a2824"><b>${esc(v)}</b></td></tr>`;
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2a2824">` +
      `<h2 style="font-size:18px;margin:0 0 14px">Solicitud de información — ${esc(appRec.name)}</h2>` +
      `<table style="border-collapse:collapse">${row('Asunto', b.subject || '—')}${row('Nombre', b.name)}${row('Email', b.email)}${account ? row('Cuenta', account) : ''}</table>` +
      `<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5dfd4;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(b.message)}</div></div>`;
    const text = `Solicitud de información — ${appRec.name}\n\nAsunto: ${b.subject || '—'}\nNombre: ${b.name}\nEmail: ${b.email}${account ? `\nCuenta: ${account}` : ''}\n\n${b.message}`;

    try {
      await sendAppEmail({
        app: appRec,
        to: config.email.contactInbox,
        subject: `Solicitud de Info ${appRec.name}`,
        htmlBody: html,
        textBody: text,
        replyTo: normalizeEmail(b.email), // the raw value can carry padding the sender refuses
      });
    } catch (err) {
      logEvent({ jobId: '-', appId: appRec.appId, userId: b.email }, 'ERROR', 'contact.send_failed', { error: (err as Error).message });
      return reply.code(502).send({ error: 'Could not send your message. Please try again.' });
    }
    logEvent({ jobId: '-', appId: appRec.appId, userId: b.email }, 'INFO', 'contact.request', { subject: b.subject ?? '' });
    return reply.code(202).send({ status: 'sent' });
  },
);

// --- Templates --------------------------------------------------------------
const langQuery = {
  lang: {
    type: 'string',
    enum: SUPPORTED_LANGS,
    description: `Language for the manifest texts (name, description, section titles, mode labels, field help). Default '${DEFAULT_LANG}'; strings without a translation fall back to '${DEFAULT_LANG}'.`,
  },
} as const;

/** The manifest language: the validated `lang` query, or the default. */
/**
 * The 429 for a report request. ONE function, because there are two places that
 * send it.
 *
 * The report route checks its quota twice — a cheap read-only peek before the
 * expensive work, and the authoritative serializing transaction after it — and
 * both used to build this response inline. Fixing the message at one of them and
 * leaving the other in English is green in every test: with the in-memory
 * Firestore the peek always wins (measured — nine of nine refusals in a
 * twelve-request "simultaneous" burst came from the peek), so the second site is
 * not reachable from a test at all. The way to guard a branch no test can enter
 * is to stop having two of them.
 */
function sendRateLimited(
  reply: FastifyReply,
  violation: { scope: string; limit: number; count: number },
  lang: string,
): FastifyReply {
  const wait = secondsToNextHour();
  reply.header('Retry-After', String(wait));
  return reply.code(429).send({
    // In the buyer's language, and honest about WHOSE limit it is. `app` is the
    // bucket every customer of the app draws from, and the old sentence — `Rate
    // limit exceeded: 100 reports/hour per app` — told a buyer with one report to
    // their name that they had exceeded a hundred, in English, naming an internal
    // scope.
    error: rateLimitNotice(lang, violation.scope),
    code: 'rate_limited',
    scope: violation.scope,
    limit: violation.limit,
    used: violation.count,
    retryAfterSeconds: wait,
  });
}

function reqLang(req: { query?: unknown }): string {
  // No membership check. Every caller carries `langQuery`, whose `enum` makes ajv
  // reject an unsupported value with a 400 before this runs — so the branch that
  // used to be here could never be false, and it read as a SECOND, contradictory
  // contract: a maintainer concluded unknown languages degrade gracefully and
  // wrote the next client accordingly. One contract, stated in the schema.
  return (req.query as { lang?: string } | undefined)?.lang ?? DEFAULT_LANG;
}

/** Overlay the Firestore per-model credit pricing onto a manifest's mode + add-on costs. */
async function withPricing<T extends { id: string; modes: Array<{ key: string; credits: number }>; addons: Array<{ key: string; credits: number }> }>(manifest: T): Promise<T> {
  const pricing = await getModelPricing(manifest.id);
  if (pricing?.modes) {
    for (const m of manifest.modes) {
      const o = pricing.modes[m.key as 'essential' | 'comprehensive'];
      if (o != null) m.credits = o;
    }
  }
  if (pricing?.addons) {
    for (const a of manifest.addons) {
      const o = pricing.addons[a.key];
      if (o != null) a.credits = o;
    }
  }
  return manifest;
}

/**
 * A model's manifest with its pricing overlaid, cached per (model, lang) for the
 * user front (30min). The admin/manager always gets fresh pricing so a price or
 * mode-cost change shows immediately. Scoping (allowedTemplates) is applied by the
 * caller, fresh — only the varying pricing overlay is cached.
 */
function manifestWithPricing(t: Parameters<typeof toManifest>[0], lang: string, isAdmin: boolean) {
  const build = () => withPricing(toManifest(t, lang));
  return isAdmin ? build() : cached(`manifest:${t.id}:${lang}`, PUBLIC_TTL_MS, build);
}

app.get(
  '/templates',
  {
    schema: {
      summary: 'List the research models this app may use',
      description:
        'Returns one manifest per model the app is allowed to use (scoped to the app’s `allowedTemplates`; ' +
        'admin apps see all). Each manifest is self-contained — enough to render a full input form, all display ' +
        'texts, the report structure, and the per-tier credit cost, with no client-side hardcoding. See the ' +
        '`ResearchModelManifest` schema and docs/model-ui.md.',
      tags: ['templates'],
      security: sec,
      querystring: { type: 'object', additionalProperties: false, properties: { ...langQuery } },
    },
  },
  async (req, reply) => {
    const lang = reqLang(req);
    const isAdmin = req.auth!.role === 'admin';
    const allowed = req.appRecord?.allowedTemplates;
    // Scoping stays FRESH (allowedTemplates can change any time); only the pricing
    // overlay — the Firestore read that can vary — is cached per (model, lang).
    const restrict = !isAdmin && allowed && allowed.length ? new Set(allowed) : null;
    const list = listTemplates().filter((t) => !restrict || restrict.has(t.id));
    reply.header('Cache-Control', isAdmin ? 'no-store' : `private, max-age=${PUBLIC_BROWSER_MAX_AGE}, stale-while-revalidate=${PUBLIC_BROWSER_SWR}`);
    return { templates: await Promise.all(list.map((t) => manifestWithPricing(t, lang, isAdmin))) };
  },
);

app.get(
  '/templates/:id',
  {
    schema: {
      summary: 'Get one research model manifest (form + texts + credits)',
      description:
        'The full manifest for one model: `paramsSchema` (JSON Schema — validate + generate the form), ' +
        '`paramsUi` (layout, per-field help, suggestions, ranges, advanced section), `directives` (structured ' +
        'preference fields, each a closed set of localized options; submit picks under `directivesKey`), ' +
        '`modes` (report tiers with ' +
        'their credit cost), `sections`/`reportSchema` (the report structure), all localized to `lang`. ' +
        '403 if the app is not allowed to use this model.',
      tags: ['templates'],
      security: sec,
      params: { type: 'object', properties: { id: { type: 'string', maxLength: 128 } }, required: ['id'] },
      querystring: { type: 'object', additionalProperties: false, properties: { ...langQuery } },
    },
  },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getTemplate(id);
    if (!t) return reply.code(404).send({ error: `Unknown template: ${id}` });
    const isAdmin = req.auth!.role === 'admin';
    const allowed = req.appRecord?.allowedTemplates;
    if (!isAdmin && allowed && allowed.length && !allowed.includes(id)) {
      return reply.code(403).send({ error: `App "${req.auth!.appId}" is not allowed to use model "${id}".` });
    }
    const lang = reqLang(req);
    reply.header('Cache-Control', isAdmin ? 'no-store' : `private, max-age=${PUBLIC_BROWSER_MAX_AGE}, stale-while-revalidate=${PUBLIC_BROWSER_SWR}`);
    return manifestWithPricing(t, lang, isAdmin);
  },
);

// --- Research ---------------------------------------------------------------
/**
 * Max reports a user may have in flight (queued/running) at once. 1 for everyone
 * for now; will become a per-plan entitlement (higher tiers → more concurrency).
 */
/**
 * Artifacts that exist for US, not for the buyer.
 *
 * `/research/:jobId` redacts cost, hold and warnings for a non-admin — and then
 * handed the same caller a `files[]` list pointing at the raw objects, which the
 * proxy served after an ownership check only. `trace.json` carries per-agent USD,
 * the resolved model aliases, the internal search/retry log, error stacks and the
 * prompt brief; `metadata.json` carries the cost block and the English diagnostic
 * warnings. Redacting one surface and publishing the other is not redaction.
 *
 * Both are still there for admins, unchanged, which is where they are read.
 */
const ADMIN_ONLY_FILES = new Set(['trace.json', 'metadata.json']);

/**
 * The buyer's own report, minus what is ours: `meta.cost` is our unit economics,
 * and it rides inside the delivered artifact. The stored object stays whole — the
 * policy belongs at the boundary, where the rest of this file's redaction lives.
 */
function redactReportForBuyer(raw: string): string {
  try {
    const doc = JSON.parse(raw) as { meta?: Record<string, unknown> };
    if (doc.meta && 'cost' in doc.meta) delete doc.meta.cost;
    return JSON.stringify(doc);
  } catch {
    return raw; // not JSON we recognise — serve it untouched rather than guess
  }
}

const MAX_CONCURRENT_JOBS_PER_USER = 1;

/**
 * How many refused `/research` calls one user may make in an hour before the
 * refusals themselves are rate-limited. Generous: a person editing a request that
 * keeps tripping the pre-screen is a normal, frustrating afternoon, and this is
 * only here so the refusal path is not a free loop.
 */
const REFUSALS_PER_HOUR = 30;

/**
 * Content moderation for research params, shared by /research and /research/preflight.
 * On a violation it records a strike (blocking at MODERATION_STRIKE_LIMIT) and returns
 * a reply spec; returns null when the params are clean.
 *
 * Every user-facing string here is OUR copy, selected by the closed category the
 * classifier returned — a rejected request can never write its own message into
 * the response or into the block reason stored on the account.
 */
async function moderateParams(
  appId: string,
  userId: string,
  params: Record<string, unknown>,
  lang: Lang,
  opts: { llm?: boolean } = {},
): Promise<{ code: number; body: Record<string, unknown> } | null> {
  const verdict = await moderateResearchParams(params, opts);
  // Book the classifier's spend whether it allowed or rejected. It runs on the
  // request path, on every preview and every generation, and used to belong to no
  // aggregate at all. Best-effort: metering must never fail a request.
  if (verdict.usage) {
    await recordRequestLlmCost({ appId, userId, usd: verdict.usage.usd, inputTokens: verdict.usage.inputTokens, outputTokens: verdict.usage.outputTokens })
      .catch((err) => logEvent({ jobId: '-', appId, userId }, 'WARNING', 'stats.request_llm_failed', { message: (err as Error).message }));
  }
  // A verdict that is `ok` because the classifier could NOT answer is not the same
  // as one that is ok because it said yes, and until round 10 the difference lived
  // only in a log line nobody watches (R10-10). Booked as a counter so the admin
  // dashboard can say it out loud on the way in. Best-effort, like the meter above:
  // an outage in the thing that RECORDS an outage must not fail the request.
  if (verdict.degraded === 'llm_failed' || verdict.degraded === 'llm_unparsable') {
    await recordModerationDegraded({ appId, userId, kind: verdict.degraded })
      .catch((err) => logEvent({ jobId: '-', appId, userId }, 'WARNING', 'stats.moderation_degraded_failed', { message: (err as Error).message }));
  }
  if (verdict.ok) return null;

  // E4: count the refusal somewhere. A rejected `/research` used to write to NO
  // counter at all — the authoritative quota transaction runs after moderation, so
  // a refused request left no trace and the loop was free (a few Firestore reads
  // and a captcha verify per turn). Its own per-user bucket, deliberately not the
  // report quota: a false positive already costs that user their request, and
  // spending their hourly reports on top would punish them twice for our regex.
  const refusals = await checkRateLimits([
    { key: `research_refused:${appId}:${userId}`, limit: REFUSALS_PER_HOUR, scope: 'refusals' },
  ]).catch(() => ({ allowed: true }) as { allowed: boolean });
  if (!refusals.allowed) {
    logEvent({ jobId: '-', appId, userId }, 'WARNING', 'research.refusal_limit', { limit: REFUSALS_PER_HOUR });
    return {
      code: 429,
      body: {
        error: moderationMessage(verdict.categories[0] ?? 'other', lang),
        code: 'refusal_limit',
        // The counter is a CALENDAR hour, so a flat 3600 tells someone who can
        // try again in ninety seconds to come back in an hour. This one is the
        // worst place to overstate it: the person has just been refused by a
        // moderation call that may well be a false positive, and the number is
        // how long they think they are locked out for.
        retryAfterSeconds: secondsToNextHour(),
      },
    };
  }

  // A pre-screen rejection is REFUSED, but never punished. Those are regexes with
  // no notion of context: "a jailbreak themed room", "offices near the county
  // jail. Breakdown of revenue", "ignora las reglas anteriores que le di al
  // corredor" all read as attacks to them and as ordinary business research to a
  // person. Four of those over the LIFETIME of an account used to mean a permanent
  // block that also stops the user buying credits — for requests that cost us
  // nothing, since this layer makes no model call. Strikes exist to stop repeated
  // BILLED classifier calls, so only the classifier's verdicts earn one.
  if (verdict.source !== 'llm') {
    logEvent({ jobId: '-', appId, userId }, 'INFO', 'research.params_prescreened', { categories: verdict.categories });
    return {
      code: 422,
      body: {
        error: moderationMessage(verdict.categories[0] ?? 'other', lang),
        code: 'params_rejected',
        categories: verdict.categories,
      },
    };
  }

  const strike = await recordModerationStrike(appId, userId, verdict.categories);
  logEvent({ jobId: '-', appId, userId }, 'WARNING', 'research.params_rejected', { categories: verdict.categories, strikes: strike.strikes, blocked: strike.blocked });
  if (strike.blocked) {
    // `blockedReason` names internal category codes in English and is what we
    // STORE for an admin; the user gets copy written for them, in their language.
    return { code: 403, body: { error: blockedMessage(lang), code: 'account_blocked', reason: strike.blockedReason } };
  }
  return {
    code: 422,
    body: {
      error: moderationMessage(verdict.categories[0] ?? 'other', lang),
      code: 'params_rejected',
      categories: verdict.categories,
      strikes: strike.strikes,
      strikeLimit: MODERATION_STRIKE_LIMIT,
    },
  };
}

/** The report language a request asked for (drives every message we send back). */
const paramsLang = (params: Record<string, unknown>): Lang => asLang(params.language);

// The language to answer a person in lives in `req-lang.ts` now — one rule for the
// body, the query and the header, shared with `captcha.ts` and `public-limit.ts`,
// which had no way to reach the local helper this replaced.

app.post(
  '/research',
  {
    schema: {
      summary: 'Create a research job',
      description:
        'Validates the request, enforces the app rate limit, records the job, and triggers the worker. ' +
        'Returns immediately with a jobId to poll.',
      tags: ['research'],
      security: sec,
      // Extra top-level fields (e.g. a spoofed appId/userId) are intentionally
      // ignored, not rejected — identity always comes from the token. `params`
      // is bounded per-field by the template's Zod paramsSchema (validateRequest).
      body: {
        type: 'object',
        required: ['template'],
        properties: {
          template: { type: 'string', minLength: 1, maxLength: 128, description: 'Template id, e.g. "florida-business-for-sale".' },
          params: { type: 'object', description: 'Template-specific params.' },
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('research', { burst: BURST.research }),
  },
  async (req, reply) => {
    let validated;
    try {
      validated = validateRequest(req.body);
      // Silent for the buyer — their meaning survived the dots — and never silent
      // in the record: a link that got as far as a validated request is the one
      // channel that could have handed a page straight to an agent.
      if (validated.defusedLinks?.length) {
        logEvent({ jobId: '-', appId: req.auth!.appId, userId: req.auth!.email }, 'WARNING', 'request.links_defused', {
          params: validated.defusedLinks, template: validated.template,
        });
      }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    // Identity comes from the session token, never the body.
    const appId = req.auth!.appId;
    const userId = req.auth!.email;

    // Enforce which research models this app may use (admin apps are exempt).
    const allowed = req.appRecord?.allowedTemplates;
    if (req.auth!.role !== 'admin' && allowed && allowed.length && !allowed.includes(validated.template)) {
      return reply.code(403).send({ error: `App "${appId}" is not allowed to use model "${validated.template}".` });
    }

    // Blocked users (repeated moderation rejections / admin action) can still read
    // their past reports, but cannot generate new ones.
    if (req.auth!.role !== 'admin') {
      const flags = await getUserFlags(appId, userId);
      if (flags.blocked) {
        return reply.code(403).send({
          error: blockedMessage(paramsLang(validated.params)),
          code: 'account_blocked',
          reason: flags.blockedReason,
        });
      }
    }

    // Concurrency: at most N reports in flight per user. TAKEN, not observed — a
    // `count()` read here was separated from the job document that makes the count
    // go up by a moderation model call, so requests a second apart all read zero
    // and all passed (C6). The claim is a transaction on one doc per user, so a
    // burst serializes against itself.
    //
    // It is also the first gate for a reason: everything expensive is downstream,
    // so a burst gets its 409 before any of it pays for a classifier call (C7).
    //
    // Admins claim nothing. An admin generates for support, testing and demos, and
    // is not who these caps exist for (Javier, 2026-07-31).
    const isAdmin = req.auth!.role === 'admin';
    let slotHeld = false;
    if (!isAdmin) {
      const slot = await claimJobSlot(appId, userId, MAX_CONCURRENT_JOBS_PER_USER);
      if (!slot.ok) {
        return reply.code(409).send({
          error: 'You already have a report in progress. Please wait for it to finish before starting another.',
          code: 'concurrency_limit',
          limit: MAX_CONCURRENT_JOBS_PER_USER,
          inProgress: slot.inFlight,
        });
      }
      slotHeld = true;
    }

    // From here the slot is owed back on EVERY path that does not end with a job
    // document. `finally` is the whole mechanism: a leaked slot locks a buyer out
    // of the product permanently, and the handler has half a dozen early returns
    // that would each have to remember (E2's shape, exactly).
    let jobCreated = false;
    try {
      // Rate limits (reports per hour) — per app and per user. Skipped in local dev.
      //
      // Two-stage on purpose. This peek is a cheap early rejection that writes
      // nothing; the authoritative, serializing check runs further down, after the
      // balance read and moderation. That ordering is what stops a request that dies
      // for want of credits or on rejected params from spending a slot in the
      // APP-WIDE bucket every other customer draws from — which is how five
      // zero-balance accounts used to 429 the paying ones, for free.
      let rateEntries: RateLimitEntry[] = [];
      if (config.server.appEnv !== 'local') {
        const settings = await getSettings();
        const appLimit = req.appRecord?.rateLimitPerHour ?? settings.appRateLimitPerHour;
        rateEntries = [
          { key: `app:${appId}`, limit: appLimit, scope: 'app' },
          { key: `user:${userId}`, limit: settings.userRateLimitPerHour, scope: 'user' },
        ];
        const rl = await peekRateLimits(rateEntries);
        // Read-only: rejects a caller who is ALREADY over without writing anything,
        // so an over-limit request doesn't pay for moderation. The authoritative,
        // serializing check runs later — see `checkRateLimits` below.
        if (!rl.allowed && rl.violation) return sendRateLimited(reply, rl.violation, paramsLang(validated.params));
      }

      const jobId = randomUUID();
      const logCtx = { jobId, appId, userId, template: validated.template };

      // Resolve the mode + its credit cost (stored on the job so the UI can show
      // "X credits · Comprehensive" per report).
      const tmpl = getTemplate(validated.template);
      const mode = resolveMode(tmpl?.modes, (validated.params as Record<string, unknown>).mode);
      const pricing = await getModelPricing(validated.template); // Firestore override → code default
      const creditsSpent = resolveModeCredits(pricing, mode.config, mode.key);

      // Affordability BEFORE moderation. `consumeCredits` below is the authority —
      // this read is only here so a caller who provably cannot pay doesn't cost us
      // a model call on the way to the same 402 they were always going to get.
      // Admins are NOT skipped: they pay like everyone, so they get the cheap 402
      // too rather than one that arrives after a billed classifier call.
      if (config.server.appEnv !== 'local') {
        const balance = await getBalance(appId, userId);
        if (balance < creditsSpent) {
          return reply.code(402).send({ error: 'Insufficient credits.', required: creditsSpent, balance });
        }
      }

      // Content moderation: reject prompt-injection / profanity / off-topic params
      // BEFORE spending credits or creating a job. Cheapest model; fails open on an
      // LLM outage (the engine still fences user instructions as low-authority).
      if (req.auth!.role !== 'admin') {
        const rej = await moderateParams(appId, userId, validated.params, paramsLang(validated.params));
        if (rej) return reply.code(rej.code).send(rej.body);
      }

      // The authoritative quota check, and the last gate before we start spending.
      //
      // It is a Firestore transaction, and that is load-bearing beyond the count:
      // contended transactions on the same document serialize, which is what stops a
      // simultaneous burst from all reading "0 used" and all proceeding. A previous
      // version of this handler replaced it with a read-only peek plus a later
      // increment, which removed the only serialization point in the request and
      // quietly turned both this cap and the concurrency cap into advisory ones.
      //
      // It sits after the balance read and after moderation, so the requests that
      // used to spend the shared app bucket for free — no credits, or rejected
      // params — never reach it. A request that passes here and then loses a race at
      // `consumeCredits` does spend a slot; that costs the caller credits they had,
      // so it is not a lever.
      if (config.server.appEnv !== 'local' && !isAdmin) {
        const rl = await checkRateLimits(rateEntries);
        if (!rl.allowed && rl.violation) return sendRateLimited(reply, rl.violation, paramsLang(validated.params));
      }

      // Credits gate: consume the mode's credit cost up front.
      //
      // EVERY job pays, admins included (Javier, 2026-07-31). The exemptions above
      // are LIMITS — how fast, how many — and an admin is not who those exist for.
      // A credit is not a limit: it is what the report costs, and it always comes
      // off the balance of whoever the job belongs to. An admin who wants to run
      // one tops up their own account first, which is what the admin app has told
      // them to do all along.
      if (config.server.appEnv !== 'local') {
        try {
          await consumeCredits(appId, userId, creditsSpent, jobId);
          logEvent(logCtx, 'INFO', 'credits.consumed', { credits: creditsSpent, mode: mode.key });
        } catch (err) {
          if (err instanceof InsufficientCreditsError) {
            return reply.code(402).send({ error: 'Insufficient credits.', required: err.required, balance: err.balance });
          }
          throw err;
        }
      }

      // Does this app send mail? The answer decides two things at once: whether the
      // job page may tell the buyer to close the tab, and whether the start mail
      // below is sent at all. ONE read, here, and the answer travels on the job —
      // see `ResearchJob.notify` for why not on every poll.
      //
      // The condition is the worker's, not a new one (`notifyReportReady`:
      // `emailFrom` AND `webUrl`, or it returns early). A screen that promises mail
      // on a weaker test than the sender uses is a screen that promises mail nobody
      // sends.
      const notifyApp = await getApp(appId).catch(() => undefined);
      const notify = !!(notifyApp?.emailFrom && notifyApp.webUrl);

      // Charged but no job is the one failure with no way back: `resolve` needs a
      // HELD job document to act on, so an admin cannot refund something that does
      // not exist — only read the ledger and grant by hand. Refund inline instead,
      // exactly as the enqueue failure below already does, since nothing has run.
      try {
        await createJob({ jobId, appId, userId, template: validated.template, params: validated.params, mode: mode.key, creditsSpent, slotHeld, notify });
      } catch (err) {
        const refunded =
          config.server.appEnv === 'local'
            ? true
            : await refundForJob(jobId, 'Job could not be created').catch(() => false);
        logEvent(logCtx, 'ERROR', 'job.create_failed', { message: (err as Error).message, refunded });
        // Never claim a refund that did not happen — the same rule the enqueue
        // branch below states, and this branch was written without it. The likely
        // cause of a `createJob` throw is Firestore being unavailable, which is
        // exactly when the refund fails too; and if the write LANDED and only the
        // call threw, the job reads `queued` and `refundForJob` correctly refuses.
        // Telling the buyer "nothing was charged" in either case is a lie support
        // cannot unpick.
        return reply.code(503).send({
          error: refunded
            ? 'Could not start the report. Your credits were returned — please try again.'
            : 'Could not start the report. If credits were taken, contact support and we will return them.',
          creditsRefunded: refunded,
        });
      }
      jobCreated = true;
      logEvent(logCtx, 'INFO', 'job.created', { params: validated.params });
      // The user generated: the assisted previews they ran paid off, so give the
      // allowance back (and pay off one cooldown step). Best-effort.
      if (req.auth!.role !== 'admin') await resetAssistAllowance(appId, userId).catch(() => {});

      try {
        const { enqueueJob } = await import('./enqueue.js');
        await enqueueJob(jobId);
      } catch (err) {
        logEvent(logCtx, 'ERROR', 'job.enqueue_failed', { message: (err as Error).message });
        req.log.error({ err, jobId }, 'failed to enqueue job');
        // Nothing will ever run this job: the worker is what refunds and fails a job,
        // and it is exactly what we could not reach. Left as `queued` it counted
        // against the user's one-in-flight cap forever — so they kept their spent
        // credits and could never generate again — and the 202 above told the SPA it
        // had succeeded, which navigated them to a dossier that would never appear.
        // Order matters. `markFailed` first, because it is what stops a task that DID
        // get created from running a job we are about to refund — a free report, and
        // the response would still say the credits were not spent. Refund only once
        // the job can no longer run.
        let refunded = false;
        try {
          await markFailed(jobId, 'Could not be queued for processing.');
          // Nothing will ever run this job, so nothing downstream will release its
          // slot. This is the one refund that stays automatic: no work was done and
          // no money was spent, so there is nothing for an admin to decide.
          await releaseJobSlot(jobId);
          refunded = await refundForJob(jobId, 'enqueue failed');
        } catch (e) {
          logEvent(logCtx, 'ERROR', 'job.enqueue_cleanup_failed', { message: (e as Error).message });
        }
        return reply.code(503).send({
          // Never claim a refund that did not happen: support can tell the two apart.
          error: refunded
            ? 'We could not start your report just now. Your credits were not spent — please try again.'
            : 'We could not start your report just now. Please try again; contact us if your credits do not come back.',
          code: 'enqueue_failed',
          creditsRefunded: refunded,
        });
      }

      logEvent(logCtx, 'INFO', 'job.queued', {});

      // The start mail — sent only once the job is QUEUED, so it never announces a
      // dossier that failed to enqueue and was refunded a few lines up.
      //
      // Best-effort and awaited-with-catch: the buyer's 202 must not wait on
      // Postmark, and must not turn into a 500 because Postmark is down. A job that
      // is running is the outcome; the mail is a courtesy on top of it.
      //
      // It carries no title — `headline` writes that inside the engine, which has
      // not run yet — and no duration. The three measured comprehensive runs were
      // 18, 20 and 17 minutes, but `essential` is a different job and no template
      // declares an estimate, so any figure here would be invented at the one moment
      // we cannot check it.
      if (notify && notifyApp) {
        const startTpl = reportStartedTemplate(notifyApp.name, `${notifyApp.webUrl}/app/jobs/${jobId}`, paramsLang(validated.params));
        await sendAppEmail({ app: notifyApp, to: userId, subject: startTpl.subject, htmlBody: startTpl.html, textBody: startTpl.text })
          .then(() => logEvent(logCtx, 'INFO', 'job.start_email_sent', {}))
          .catch((err) => logEvent(logCtx, 'WARNING', 'job.start_email_failed', { message: (err as Error).message }));
      }

      return reply.code(202).send({ jobId, status: 'queued' });
    } finally {
      // The job document now owns the slot (`slotHeld`), and every terminal path —
      // completed, held, the enqueue failure below — releases it through the job.
      // Anything that got here WITHOUT a job owes it back now.
      if (slotHeld && !jobCreated) await releaseUnclaimedSlot(appId, userId).catch(() => {});
    }
  },
);

// --- Research: pre-flight validation (moderation + AI preview) ---------------
/**
 * Preflight's burst window and route id, in ONE place.
 *
 * The captcha preHandler counts a request into a burst window before the route
 * guard ever runs, so the two have to agree on which window. They are the same
 * object here rather than two literals that look alike.
 *
 * Isolated on purpose: this is a read route a busy page hits often, and on the
 * shared window a single active session could exhaust it and 429 sign-in and
 * registration for everyone behind the same egress address — a corporate NAT,
 * CGNAT or mobile carrier is one IP to us.
 */
const PREFLIGHT_LIMIT = {
  route: 'preflight',
  perIp: config.publicLimits.preflightPerHourPerIp,
  isolatedBurst: true,
} as const;

app.post(
  '/research/preflight',
  {
    schema: {
      summary: 'Review research params before generating',
      description:
        'Runs content moderation, then a review of the request in two layers. The DETERMINISTIC layer always ' +
        'runs and costs nothing: a plain-language summary of exactly what will be researched, rendered from the ' +
        'validated params, plus rule-based findings. The ASSISTED layer additionally asks the cheapest model for ' +
        'spelling/format corrections on a small whitelist of fields and for extra finding codes; it is bounded to ' +
        'a closed output vocabulary, so no model-authored text is ever returned. ' +
        'Corrections are PROPOSALS — `correctedParams` is what to submit if the user accepts them. ' +
        'The assisted layer runs only when the user could actually generate (enough credits) and has not run ' +
        'several previews without generating; otherwise `assist.state` explains why and the deterministic ' +
        'review is returned on its own. This endpoint never blocks a generation.',
      tags: ['research'],
      security: sec,
      body: {
        type: 'object',
        required: ['template'],
        properties: {
          template: { type: 'string', minLength: 1, maxLength: 128 },
          params: { type: 'object', description: 'Template-specific params.' },
          freeText: {
            type: 'string',
            maxLength: 2000,
            description:
              'What the user wrote in their own words. Moderated like every other free text, then read by the ' +
              'assisted layer to PROPOSE structured params — values from the model\'s directive vocabularies, and ' +
              'keywords only for a model that offers them (the flagship does not: `keywords` is an internal param ' +
              'and a request carrying it is refused) — returned as `proposals` with `proposedParams` ready to ' +
              'submit if the user accepts. It is never a param and never reaches a research prompt.',
          },
          draftId: {
            type: 'string',
            maxLength: 64,
            description:
              'Opaque id for the report being drafted, stable while the user edits it. Scopes the assisted ' +
              'review allowance: the same draft gets a couple of assisted passes, then the review continues ' +
              'deterministic-only. Omit it and only the per-user backstop applies.',
          },
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('preflight', { burst: PREFLIGHT_LIMIT }),
  },
  async (req, reply) => {
    // A meter, which this route did not have. Reproduced at 60 consecutive 200s,
    // ~5 Firestore reads each, on the one route where every sibling carries one in
    // addition to the captcha.
    if (await publicLimit(req, reply, { ...PREFLIGHT_LIMIT, perKey: { limit: config.publicLimits.preflightPerHourPerUser, value: req.auth?.email } })) return reply;

    let validated;
    try {
      validated = validateRequest(req.body);
      // Silent for the buyer — their meaning survived the dots — and never silent
      // in the record: a link that got as far as a validated request is the one
      // channel that could have handed a page straight to an agent.
      if (validated.defusedLinks?.length) {
        logEvent({ jobId: '-', appId: req.auth!.appId, userId: req.auth!.email }, 'WARNING', 'request.links_defused', {
          params: validated.defusedLinks, template: validated.template,
        });
      }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const appId = req.auth!.appId;
    const userId = req.auth!.email;

    // Same allow-list as /research and GET /templates/:id. Without it a preview is
    // a way to read a model this app is not entitled to — its plan, its issue
    // vocabulary, and an assisted pass against it — on the one route that omitted
    // the check.
    const allowed = req.appRecord?.allowedTemplates;
    if (req.auth!.role !== 'admin' && allowed && allowed.length && !allowed.includes(validated.template)) {
      return reply.code(403).send({ error: `App "${appId}" is not allowed to use model "${validated.template}".` });
    }

    const params = validated.params as Record<string, unknown>;
    const lang = paramsLang(params);
    const tpl = getTemplate(validated.template)!;
    const mode = resolveMode(tpl.modes, params.mode);
    const freeText = typeof (req.body as { freeText?: unknown }).freeText === 'string' ? (req.body as { freeText: string }).freeText.trim().slice(0, 2000) : '';

    // Which layers may run. Admins always get the assisted one.
    let assist: AssistState = config.validation.llm ? 'on' : 'off_disabled';

    if (req.auth!.role !== 'admin') {
      // 1. Account state. A blocked user previews nothing.
      const flags = await getUserFlags(appId, userId);
      if (flags.blocked) {
        return reply.code(403).send({ error: blockedMessage(lang), code: 'account_blocked', reason: flags.blockedReason });
      }

      // 2. Allowance, BEFORE anything reaches a model. Both model-backed passes on
      //    this endpoint — the moderation classifier and the assisted review — are
      //    covered by it, so a user who previews without ever generating cannot
      //    keep either one running.
      if (assist === 'on') {
        // Nothing to preview for someone who can't pay for this mode. (Local dev
        // has no credits gate at all — mirror /research and skip the check.)
        const pricing = await getModelPricing(validated.template);
        const cost = resolveModeCredits(pricing, mode.config, mode.key);
        if (config.server.appEnv !== 'local' && (await getBalance(appId, userId)) < cost) assist = 'off_no_credits';
        else {
          const draftId = typeof (req.body as { draftId?: unknown }).draftId === 'string'
            ? (req.body as { draftId: string }).draftId.slice(0, 64)
            : undefined;
          const claim = await reserveAssistedReview(appId, userId, draftId);
          // Two different situations: 'attempts' means this request has already
          // been reviewed enough — nothing to wait for, just generate. 'cooldown'
          // is the abuse backstop and does make the user wait.
          if (!claim.allowed) assist = claim.reason === 'attempts' ? 'off_attempts' : 'off_cooldown';
        }
      }

      // 3. Moderation. Inside the `role !== 'admin'` block that opens this handler,
      //    which is the whole of it: for an ADMIN caller neither layer runs — not
      //    the classifier and not the deterministic pre-screen — while `assist`
      //    above stays `'on'`, so an admin's free text reaches `proposeFromText`
      //    unscreened. That is a trusted human by construction (`app.role` AND the
      //    address in `adminEmails`), and it is deliberate, but it was written up
      //    as "the pre-screen always runs" and it does not (round 10, R10-10).
      //    For everyone else: the pre-screen always runs; only the classifier's
      //    verdicts record a strike, and it is billed against the allowance above.
      //    Skipping it here is safe because /research moderates in full — and that
      //    is the call that actually spends credits.
      //    The buyer's free text is moderated with the params: it is the one
      //    piece of their own words the assist will read.
      const rej = await moderateParams(appId, userId, freeText ? { ...params, freeText } : params, lang, { llm: assist === 'on' });
      if (rej) return reply.code(rej.code).send(rej.body);
    }

    const outcome = await runPreflight({
      template: tpl,
      params,
      lang,
      modeLabel: modeLabel(tpl, mode.key, lang),
      assist,
      ...(freeText ? { freeText } : {}),
    });

    logEvent({ jobId: '-', appId, userId }, 'INFO', 'research.preflight', {
      assist: outcome.assist.state,
      quality: outcome.quality,
      issues: outcome.issues.map((i) => i.code),
      corrections: outcome.corrections.map((c) => c.field),
      ...(outcome.proposals ? { proposals: { directives: Object.keys(outcome.proposals.directives), keywords: outcome.proposals.keywords.length } } : {}),
      ...(outcome.usage ? { inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens } : {}),
    });
    if (outcome.usage) {
      await recordRequestLlmCost({ appId, userId, usd: outcome.usage.usd, inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens })
        .catch((err) => logEvent({ jobId: '-', appId, userId }, 'WARNING', 'stats.request_llm_failed', { message: (err as Error).message }));
    }
    // `usage` is internal metering — it stays server-side, like job cost does.
    const { usage: _usage, ...clientView } = outcome;
    return reply.send({ ok: true, ...clientView });
  },
);

// --- Research: list a user's reports (inbox) --------------------------------
app.get(
  '/research',
  {
    schema: {
      summary: "List a user's research jobs (report inbox)",
      description: "Returns the calling app's jobs for a user, newest first.",
      tags: ['research'],
      security: sec,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          userId: { type: 'string', maxLength: 320, description: 'Admin only: list another user (defaults to the token user).' },
          appId: { type: 'string', maxLength: 128, description: 'Admin only: another app (defaults to the token app).' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
  },
  async (req, reply) => {
    const q = req.query as { userId?: string; appId?: string; limit?: number };
    const isAdmin = req.auth!.role === 'admin';
    const appId = (isAdmin && q.appId) || req.auth!.appId;
    const userId = (isAdmin && q.userId) || req.auth!.email;
    const jobs = await listJobs(appId, userId, q.limit ?? 50);
    return {
      jobs: jobs.map((j) => ({
        jobId: j.jobId,
        template: j.template,
        title: j.title ?? null,
        shortDescription: j.shortDescription ?? null,
        status: j.status,
        // Report mode + credits charged — shown as a per-report tag in the inbox.
        mode: j.mode ?? ((j.params as Record<string, unknown>)?.mode as string | undefined) ?? null,
        creditsSpent: j.creditsSpent ?? null,
        // Client-facing progress so the inbox can show the live step (no internals).
        progress: j.progress ? (isAdmin ? { phase: j.progress.phase, message: j.progress.message, kind: j.progress.kind ?? null } : clientProgress(j.progress)) : null,
        // Cost is internal — only admins see it.
        ...(isAdmin ? { cost: j.cost ?? null } : {}),
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        finishedAt: j.finishedAt ?? null,
      })),
    };
  },
);

app.get(
  '/research/:jobId',
  {
    schema: {
      summary: 'Poll a research job',
      description: 'Returns status + progress. When completed, includes short-lived signed read URLs.',
      tags: ['research'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });

    // Admins can read any job; a regular user only their own (same app + email).
    if (
      req.auth!.role !== 'admin' &&
      req.auth!.scope !== 'report-read' &&
      (job.appId !== req.auth!.appId || job.userId !== req.auth!.email)
    ) {
      return reply.code(403).send({ error: 'Forbidden: not your report.' });
    }

    // Non-admin callers get only client-facing info — no cost, turns, tokens, or
    // per-agent internals. Progress: the buyer gets the phase, the KIND of step
    // and, for a search, the query — never `message`, which is the engine's
    // English sentence: it names internal section keys and carries the model's
    // own words (a page can put a sentence there through the next query, so the
    // detail is clipped and the client shows it quoted, as a query). Summary
    // keeps only what a client should see (whether the report was degraded).
    const isAdmin = req.auth!.role === 'admin';
    const progress = job.progress ? (isAdmin ? job.progress : clientProgress(job.progress)) : null;
    const s = job.summary;
    const summary = s
      ? isAdmin
        ? s
        : // `warnings` is diagnostics: it names our agents and section keys, in
          // English, whatever language the buyer reads. They get `notice` instead.
          { ...(s.notice ? { notice: s.notice } : {}), ...(s.sections ? { sections: s.sections } : {}) }
      : null;
    const base = {
      jobId: job.jobId,
      appId: job.appId,
      userId: job.userId,
      template: job.template,
      title: job.title ?? null,
      shortDescription: job.shortDescription ?? null,
      status: job.status,
      mode: job.mode ?? ((job.params as Record<string, unknown>)?.mode as string | undefined) ?? null,
      creditsSpent: job.creditsSpent ?? null,
      // The caller's own request params — safe to echo (not internal), useful for
      // showing what's being researched while the job runs.
      params: job.params,
      progress,
      // Whether the completion email is coming — the one fact the job page needs
      // before it can tell the buyer to close the tab. Recorded on the job at
      // creation (see `ResearchJob.notify`), so this is a field read, not an app
      // lookup on every poll.
      //
      // `=== true`, so a job created before the field existed reads FALSE and the
      // screen simply says nothing. That is the safe direction: silence costs a
      // buyer twenty minutes of watching, and a wrong promise costs them a dossier
      // they think will be mailed to them and never is.
      notify: job.notify === true,
      // Both admin-only, and for the same reason: what a job cost us, and which of
      // our own limits stopped it, are operational facts. The buyer gets `error`.
      // `refunded` reads the LEDGER, not the job. The admin page used to infer it
      // from `failureKind`, which `rejectHold` copies from the hold whatever the
      // decision was — so it claimed a refund after a dismiss and after a refund
      // that failed. It is also what makes a stranded refund visible on reload.
      ...(isAdmin
        ? {
            cost: job.cost ?? null,
            failureKind: job.failureKind ?? null,
            hold: job.hold ?? null,
            refunded: await wasJobRefunded(job.jobId),
          }
        : {}),
      summary,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error ?? null,
    };

    if (job.status !== 'completed') return base;

    // Files are served ONLY through the authenticated proxy below (no public/shareable
    // signed URLs). `url` is a relative API path the client fetches WITH its token.
    return {
      ...base,
      finishedAt: job.finishedAt ?? null,
      bucketPath: job.bucketPath,
      files: (job.files ?? []).filter((f) => isAdmin || !ADMIN_ONLY_FILES.has(f.name)).map((f) => ({
        name: f.name,
        contentType: f.contentType,
        size: f.size ?? null,
        url: `/research/${job.jobId}/files/${encodeURIComponent(f.name)}`,
      })),
    };
  },
);

app.get(
  '/research/:jobId/report',
  {
    schema: {
      summary: 'Get the structured report of a completed job (for an in-app viewer)',
      description:
        'Returns the parsed `report.json` — `{ meta, report }` — so a client can render the report inline ' +
        '(section values are Markdown strings or structured objects). Use `GET /templates/:id` `sections` for ' +
        'titles + order. Owner or admin only.',
      tags: ['research'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    if (
      req.auth!.role !== 'admin' &&
      req.auth!.scope !== 'report-read' &&
      (job.appId !== req.auth!.appId || job.userId !== req.auth!.email)
    ) {
      return reply.code(403).send({ error: 'Forbidden: not your report.' });
    }
    if (job.status !== 'completed') return reply.code(409).send({ error: `Report not ready (status: ${job.status}).` });
    const raw = await downloadObject(jobId, 'report.json');
    if (!raw) return reply.code(404).send({ error: 'Report file not found.' });
    const body = req.auth!.role === 'admin' ? raw : redactReportForBuyer(raw);
    return reply.type('application/json').header('Cache-Control', 'no-store').send(body);
  },
);

app.get(
  '/research/:jobId/pdf',
  {
    schema: {
      summary: 'Get (or start generating) the report PDF — generated once, then served from files',
      description:
        'The report PDF is rendered on demand the FIRST time it is requested: if `report.pdf` already exists this ' +
        'returns `{ ready: true }` (download it via `GET /research/:jobId/files/report.pdf`); otherwise it enqueues ' +
        'a one-off render and returns 202 `{ ready: false }`. Poll until ready. Owner, admin, or a read-only report ' +
        'token. The PDF is never regenerated once it exists.',
      tags: ['research'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
      querystring: { type: 'object', properties: { force: { type: 'string', enum: ['1'] } } },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    if (
      req.auth!.role !== 'admin' &&
      req.auth!.scope !== 'report-read' &&
      (job.appId !== req.auth!.appId || job.userId !== req.auth!.email)
    ) {
      return reply.code(403).send({ error: 'Forbidden: not your report.' });
    }
    if (job.status !== 'completed') return reply.code(409).send({ error: `Report not ready (status: ${job.status}).` });
    const name = 'report.pdf';
    // Admins may force a re-render (e.g. after a PDF template/design change).
    const force = req.auth!.role === 'admin' && (req.query as { force?: string }).force === '1';
    reply.header('Cache-Control', 'no-store');
    const { enqueuePdf } = await import('./enqueue.js');
    if (!force && (job.files ?? []).some((f) => f.name === name)) return { ready: true, name };
    await enqueuePdf(jobId, { force });
    return reply.code(202).send({ ready: false, status: 'generating', name });
  },
);

app.get(
  '/research/:jobId/files/:name',
  {
    schema: {
      summary: 'Download a report file — owner/admin only, auth-gated (no shareable link)',
      description:
        'Streams a generated report file (report.json, *.md) straight from storage, behind the same session ' +
        'JWT + ownership check. There is no public/signed URL, so the "link" only works for the authenticated ' +
        'session — sharing it does nothing.',
      tags: ['research'],
      security: sec,
      params: { type: 'object', required: ['jobId', 'name'], properties: { jobId: { type: 'string', maxLength: 128 }, name: { type: 'string', maxLength: 256 } } },
    },
  },
  async (req, reply) => {
    const { jobId, name } = req.params as { jobId: string; name: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    if (
      req.auth!.role !== 'admin' &&
      req.auth!.scope !== 'report-read' &&
      (job.appId !== req.auth!.appId || job.userId !== req.auth!.email)
    ) {
      return reply.code(403).send({ error: 'Forbidden: not your report.' });
    }
    if (job.status !== 'completed') return reply.code(409).send({ error: `Report not ready (status: ${job.status}).` });
    // Only files the job actually produced — no arbitrary reads / path traversal.
    if (!(job.files ?? []).some((f) => f.name === name)) return reply.code(404).send({ error: 'File not found.' });
    // …and only the ones that are the buyer's. 404, not 403: as far as this caller
    // is concerned the file is not part of their report.
    if (req.auth!.role !== 'admin' && ADMIN_ONLY_FILES.has(name)) {
      return reply.code(404).send({ error: 'File not found.' });
    }
    // Binary files (PDF) must be streamed as bytes, not decoded as UTF-8 text.
    if (name.endsWith('.pdf')) {
      const bytes = await downloadObjectBytes(jobId, name);
      if (!bytes) return reply.code(404).send({ error: 'File not found.' });
      return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(bytes);
    }
    const raw = await downloadObject(jobId, name);
    if (!raw) return reply.code(404).send({ error: 'File not found.' });
    const body = name === 'report.json' && req.auth!.role !== 'admin' ? redactReportForBuyer(raw) : raw;
    const ct = name.endsWith('.json') ? 'application/json' : name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/octet-stream';
    return reply.type(ct).header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(body);
  },
);

app.get(
  '/me/stats',
  {
    schema: {
      summary: "The current user's report counters (by status)",
      description: 'Aggregate counts over ALL of the caller\'s jobs (computed server-side, not a tally of the paginated inbox): total, ready (completed/partial), inProgress (queued/running), failed. Scoped to the token\'s app + user.',
      tags: ['research'],
      security: sec,
    },
  },
  async (req) => {
    const [stats, flags, inFlight] = await Promise.all([
      getUserJobStats(req.auth!.appId, req.auth!.email),
      getUserFlags(req.auth!.appId, req.auth!.email),
      inFlightSlots(req.auth!.appId, req.auth!.email),
    ]);
    // `inProgress` comes from the SLOT, not from counting job documents, because the
    // slot is what refuses the next request. Reporting a count that can disagree
    // with it is how a user ends up reading "no reports in progress" next to "you
    // already have a report in progress".
    return { ...stats, inProgress: inFlight, blocked: flags.blocked, blockedReason: flags.blockedReason ?? null };
  },
);

// --- Credits ----------------------------------------------------------------
app.get(
  '/credits/balance',
  {
    schema: {
      summary: "Get the current user's credit balance",
      tags: ['credits'],
      security: sec,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { userId: { type: 'string', maxLength: 320 }, appId: { type: 'string', maxLength: 128 } },
      },
    },
  },
  async (req) => {
    const q = req.query as { userId?: string; appId?: string };
    const isAdmin = req.auth!.role === 'admin';
    const appId = (isAdmin && q.appId) || req.auth!.appId;
    const userId = (isAdmin && q.userId) || req.auth!.email;
    return { appId, userId, balance: await getBalance(appId, userId) };
  },
);

app.get(
  '/credits/transactions',
  {
    schema: {
      summary: "Get the current user's credit ledger (purchases + consumption)",
      tags: ['credits'],
      security: sec,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          userId: { type: 'string', maxLength: 320 },
          appId: { type: 'string', maxLength: 128 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          type: {
            type: 'string',
            enum: ['purchase', 'consumption', 'refund', 'grant'],
            description: 'Filter to one ledger entry type (e.g. only grants, for the credit audit).',
          },
        },
      },
    },
  },
  async (req) => {
    const q = req.query as { userId?: string; appId?: string; limit?: number; type?: LedgerEntryType };
    const isAdmin = req.auth!.role === 'admin';
    const appId = (isAdmin && q.appId) || req.auth!.appId;
    const userId = (isAdmin && q.userId) || req.auth!.email;
    return { transactions: await listTransactions(appId, userId, q.limit ?? 50, q.type) };
  },
);

app.get(
  '/plans',
  {
    schema: {
      summary: 'Public: purchasable plans/packs for an app (from Stripe)',
      description:
        'Lists the Stripe products whose metadata.appId matches (each by its default price) — no auth, for a ' +
        'public landing pricing section. The catalog (name, price, credits, and marketing metadata ' +
        'sub/popular/features, localized per `lang`) lives entirely in Stripe; nothing is hardcoded in the client.',
      tags: ['credits'],
      querystring: { type: 'object', additionalProperties: false, required: ['appId'], properties: { appId: { type: 'string', maxLength: 128 }, ...langQuery } },
    },
  },
  async (req, reply) => {
    const { appId } = req.query as { appId: string };
    const lang = reqLang(req);

    // Unauthenticated and it reaches Stripe, so it needs its own meter.
    // Its own burst window: this is a read-only catalog, and it must not be able
    // to exhaust the shared one and lock a whole NAT out of signing in.
    if (await publicLimit(req, reply, { route: 'plans', perIp: config.publicLimits.plansPerHourPerIp, isolatedBurst: true })) return reply;

    // Refuse an appId that isn't ours BEFORE touching Stripe. This is the actual
    // amplifier fix: an unknown app used to miss the cache by construction (empty
    // results were deliberately not stored), so a fresh appId per request bought a
    // live Stripe call per request. A Firestore read is orders of magnitude cheaper,
    // and unlike Stripe it is not a shared upstream whose throttling would also stop
    // customers from checking out.
    if (!isValidAppId(appId)) return reply.code(400).send({ error: 'Invalid appId.' });
    const appRec = await cached(`app:${appId}`, PUBLIC_EMPTY_TTL_MS, () => getApp(appId));
    if (!appRec || !appRec.active) return reply.code(404).send({ error: `Unknown or inactive app: ${appId}` });

    // Cache it (30min in-process). An empty catalog gets a SHORT ttl rather than
    // none, which keeps the original intent — a misconfigured catalog recovers
    // almost immediately — without handing out a guaranteed miss. Keyed by lang.
    // The BROWSER cache is short with stale-while-revalidate so a Stripe change
    // (which also busts the server cache via webhook) reaches clients within ~a minute.
    const plans = stripeConfigured()
      ? await cached(`plans:${appId}:${lang}`, PUBLIC_TTL_MS, () => listStripePlans(appId, lang), (p) => p.length > 0, PUBLIC_EMPTY_TTL_MS)
      : [];
    reply.header(
      'Cache-Control',
      plans.length ? `public, max-age=${PUBLIC_BROWSER_MAX_AGE}, stale-while-revalidate=${PUBLIC_BROWSER_SWR}` : 'no-store',
    );
    return { plans };
  },
);

app.get(
  '/credits/plans',
  {
    schema: {
      summary: 'List the purchasable credit packs for this app',
      tags: ['credits'],
      security: sec,
      querystring: { type: 'object', additionalProperties: false, properties: { ...langQuery } },
    },
  },
  async (req, reply) => {
    const appId = req.auth!.appId;
    const userId = req.auth!.email;
    if (!stripeConfigured()) return { plans: [] };

    // This route reaches Stripe, and it is the one the product UI actually calls —
    // the public `/plans` was metered first while this one was left open, which is
    // the more-used door. Metered PER USER, not per IP: a heavy client should slow
    // itself down, never everyone behind the same egress address.
    if (config.server.appEnv !== 'local') {
      const rl = await checkRateLimits([
        { key: `plans:${appId}:${userId}`, limit: config.publicLimits.plansPerHourPerUser, scope: 'user' },
      ]);
      if (!rl.allowed) {
        // The bucket is a CALENDAR hour, so `3600` told someone who could retry
        // in ninety seconds to come back in an hour — and the body never carried
        // `retryAfterSeconds` at all, which is the field the client reads to say
        // anything about when. The public limits were fixed and these two,
        // reached by the SAME buyer page, were left behind.
        const wait = secondsToNextHour();
        reply.header('Retry-After', String(wait));
        return reply.code(429).send({ error: tooManyRequestsNotice(errorLang(req)), code: 'rate_limited', retryAfterSeconds: wait });
      }
    }

    // Same cache line as the public route: same data, same key, so the two share
    // one Stripe call rather than one each.
    const lang = reqLang(req);
    const plans = await cached(
      `plans:${appId}:${lang}`,
      PUBLIC_TTL_MS,
      () => listStripePlans(appId, lang),
      (p) => p.length > 0,
      PUBLIC_EMPTY_TTL_MS,
    );
    return { plans };
  },
);

app.post(
  '/credits/checkout',
  {
    schema: {
      summary: 'Create a Stripe Checkout session to buy a credit pack',
      description: 'Returns a hosted Checkout URL. On success, the webhook grants the credits.',
      tags: ['credits'],
      security: sec,
      body: {
        type: 'object',
        required: ['planId', 'successUrl', 'cancelUrl'],
        additionalProperties: false,
        properties: {
          planId: { type: 'string', minLength: 1, maxLength: 128 },
          successUrl: { type: 'string', maxLength: 2048, pattern: '^https?://' },
          cancelUrl: { type: 'string', maxLength: 2048, pattern: '^https?://' },
        },
      },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const b = req.body as { planId: string; successUrl: string; cancelUrl: string };
    const appId = req.auth!.appId;
    const userId = req.auth!.email;

    // Blocked users cannot buy more credits.
    if (req.auth!.role !== 'admin') {
      const flags = await getUserFlags(appId, userId);
      if (flags.blocked) {
        return reply.code(403).send({ error: blockedMessage(errorLang(req)), code: 'account_blocked', reason: flags.blockedReason });
      }
    }

    // Two Stripe calls per request (resolve + create session) on an authenticated
    // route, so meter it by user. `checkRateLimits` is the atomic counter used
    // elsewhere; a rejected checkout has no side effect worth preserving.
    if (config.server.appEnv !== 'local') {
      const rl = await checkRateLimits([
        { key: `checkout:${appId}:${userId}`, limit: config.publicLimits.checkoutPerHourPerUser, scope: 'user' },
      ]);
      if (!rl.allowed) {
        // Same calendar-hour bucket, same missing field — and this one is the
        // button a buyer pressed to give us money, so "try again later" with no
        // figure is the worst place to leave them.
        const wait = secondsToNextHour();
        reply.header('Retry-After', String(wait));
        return reply.code(429).send({ error: tooManyRequestsNotice(errorLang(req), 'checkout'), code: 'rate_limited', retryAfterSeconds: wait });
      }
    }

    // Catalog is entirely in Stripe: resolve by Price metadata appId + planId.
    const plan = await resolveStripePlan(appId, b.planId);
    if (!plan) return reply.code(404).send({ error: `Unknown plan "${b.planId}" for app "${appId}".` });
    // Integer, because the ledger refuses anything else — and it refuses it inside
    // the WEBHOOK, where a throw is a 500 that Stripe retries for days and can
    // disable the endpoint, stopping every other customer's credits from landing.
    // Catch a bad plan here, where it only affects the person who chose it.
    if (!plan.credits || plan.credits <= 0 || !Number.isInteger(plan.credits)) {
      return reply.code(400).send({ error: `Plan "${b.planId}" has no credits in its Stripe metadata.` });
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      success_url: b.successUrl,
      cancel_url: b.cancelUrl,
      client_reference_id: userId,
      allow_promotion_codes: true, // Stripe-managed coupons/promo codes
      line_items: [{ price: plan.priceId, quantity: 1 }],
      // `lang` and `planName` are carried on the SESSION because the webhook has
      // no request to read them from: it is Stripe calling us, hours later for a
      // delayed method, with no Accept-Language and no catalog lookup in hand.
      // `errorLang(req)` is the language the buyer's SWITCHER is on — the client
      // sets `accept-language` from it on every call — so the receipt arrives in
      // the language they bought in rather than the language their browser is in.
      metadata: {
        appId,
        userId,
        planId: plan.planId,
        credits: String(plan.credits),
        planName: plan.name.slice(0, 200),
        lang: errorLang(req),
      },
    });
    return { url: session.url, sessionId: session.id, credits: plan.credits };
  },
);

/**
 * The receipt for a credit purchase — best-effort, and behind the GRANT's own
 * idempotency.
 *
 * Two rules are load-bearing here and both are one-line mistakes to make.
 *
 * 1. **It rides `res.applied`, not a second key.** Stripe delivers at least once
 *    and retries for days; `recordPurchase` is idempotent by `paymentId`, so a
 *    redelivery returns `applied: false` and grants nothing. A mail keyed on
 *    anything else — the event id, or nothing at all — sends a second receipt for
 *    one purchase, and a buyer who gets two receipts reasonably believes they were
 *    charged twice.
 * 2. **It cannot throw.** This runs inside the webhook, where a throw is a 500
 *    that Stripe retries for days and can disable the endpoint — which would stop
 *    every OTHER customer's credits from landing. Postmark being down must cost
 *    one missing receipt, never the billing path. So: caught, logged, 200 anyway.
 *
 * `balance` comes from the same transaction that granted, so it is the balance
 * this purchase produced rather than a re-read that a concurrent job may already
 * have spent against.
 */
async function sendPurchaseReceipt(input: {
  meta: Record<string, string>;
  credits: number;
  amountUsd: number;
  currency: string;
  balance: number;
  sessionId: string;
}): Promise<void> {
  const { meta: m } = input;
  const ctx = { jobId: input.sessionId, appId: m.appId ?? '-', userId: m.userId ?? '-' };
  try {
    const appRec = await getApp(m.appId!);
    // The same condition the worker's completion mail uses: an app with no sender
    // and no web URL is an app that does not do email, and a receipt with no link
    // back into the product is not the receipt this was approved as.
    if (!appRec?.emailFrom || !appRec.webUrl) {
      logEvent(ctx, 'INFO', 'credits.receipt_skipped', { reason: 'app has no emailFrom/webUrl' });
      return;
    }
    const tpl = creditsPurchasedTemplate(
      appRec.name,
      {
        credits: input.credits,
        balance: input.balance,
        planName: m.planName,
        amount: input.amountUsd,
        currency: input.currency,
      },
      `${appRec.webUrl}/app/credits`,
      m.lang,
    );
    await sendAppEmail({ app: appRec, to: m.userId!, subject: tpl.subject, htmlBody: tpl.html, textBody: tpl.text });
    logEvent(ctx, 'INFO', 'credits.receipt_sent', { credits: input.credits, balance: input.balance });
  } catch (err) {
    logEvent(ctx, 'ERROR', 'credits.receipt_failed', { message: (err as Error).message });
  }
}

app.post(
  '/credits/webhook',
  { schema: { hide: true } },
  async (req, reply) => {
    const sig = req.headers['stripe-signature'];
    if (!config.stripe.webhookSecret || typeof sig !== 'string') {
      return reply.code(400).send({ error: 'Missing signature or webhook not configured.' });
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(raw ?? Buffer.from(''), sig, config.stripe.webhookSecret);
    } catch (err) {
      return reply.code(400).send({ error: `Signature verification failed: ${(err as Error).message}` });
    }

    // Catalog changed in Stripe → drop the cached plans so every client sees the
    // new price/product on their next request (no waiting out the 30min TTL).
    // A payment that never landed. Nothing was credited (the guard below refuses an
    // unpaid session), so this only needs to be visible.
    if (event.type === 'checkout.session.async_payment_failed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = (s.metadata ?? {}) as Record<string, string>;
      logEvent(
        { jobId: s.id, appId: m.appId ?? '-', userId: m.userId ?? '-' },
        'WARNING',
        'credits.purchase_failed',
        { plan: m.planId, credits: m.credits },
      );
    }

    if (event.type.startsWith('product.') || event.type.startsWith('price.')) {
      const obj = event.data.object as { metadata?: Record<string, string> };
      const appId = obj.metadata?.appId;
      bustPublicCache(appId ? `plans:${appId}` : 'plans:');
      logEvent({ jobId: '-', appId: appId ?? '-', userId: '-' }, 'INFO', 'plans.cache_busted', { event: event.type });
    }

    // `checkout.session.completed` fires when the CHECKOUT finished, which is not
    // the same as the money arriving: with a delayed-notification method it arrives
    // `payment_status: 'unpaid'`, and crediting there hands out credits for a
    // payment that may still fail. `async_payment_succeeded` is the event that says
    // it landed — it carries the same session object, so one branch serves both.
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = (s.metadata ?? {}) as Record<string, string>;
      if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') {
        logEvent(
          { jobId: s.id, appId: m.appId ?? '-', userId: m.userId ?? '-' },
          'INFO',
          'credits.purchase_pending',
          { paymentStatus: s.payment_status, plan: m.planId },
        );
        return reply.code(200).send({ received: true });
      }
      if (m.appId && m.userId && m.credits) {
        const amountUsd = (s.amount_total ?? 0) / 100;
        const credits = Number(m.credits);
        const res = await recordPurchase({
          appId: m.appId,
          userId: m.userId,
          credits,
          plan: m.planId ?? 'unknown',
          paymentId: (typeof s.payment_intent === 'string' ? s.payment_intent : undefined) ?? s.id,
          amountUsd,
          currency: s.currency ?? 'usd',
        });
        // Only fold into analytics the first time (webhook is at-least-once).
        //
        // Everything in here runs AFTER the grant landed, and that is what decides
        // how it must fail. `recordPurchase` is idempotent by `paymentId`: a retry
        // of this event returns `applied: false` and skips this block entirely. So
        // a throw from anything below does not just lose itself — it loses itself
        // FOREVER, while returning a 500 that Stripe retries for days and that can
        // get the endpoint disabled, taking every other customer's credits with it.
        //
        // The specific bug this replaced: `recordPurchaseStats` was awaited bare,
        // one line above the receipt. A transient Firestore error there 500'd an
        // already-applied purchase, and the retry — `applied: false` — sent no
        // receipt and recorded no revenue, permanently. The receipt's own doc said
        // it could not throw; the line above it could.
        //
        // Caught INDIVIDUALLY, not as one block, so a failing stats write cannot
        // also cost the buyer their receipt. Both log loudly: the money already
        // moved, so silence here is an undercounted dashboard nobody knows about.
        if (res.applied) {
          await recordPurchaseStats({ appId: m.appId, userId: m.userId, amountUsd, credits }).catch((err) =>
            logEvent(
              { jobId: s.id, appId: m.appId!, userId: m.userId! },
              'ERROR',
              'credits.purchase_stats_failed',
              { message: (err as Error).message, amountUsd, credits, note: 'the grant APPLIED; these figures are lost for good — the retry skips this block' },
            ),
          );
          await sendPurchaseReceipt({ meta: m, credits, amountUsd, currency: s.currency ?? 'usd', balance: res.balance, sessionId: s.id });
        }
        logEvent(
          { jobId: s.id, appId: m.appId, userId: m.userId },
          'INFO',
          'credits.purchased',
          { credits, plan: m.planId, applied: res.applied },
        );
      } else {
        // Money arrived and we cannot say whose it is (N11). Every session OUR
        // checkout route creates carries the three fields, so this is unreachable
        // from the product — but a Payment Link made in the Stripe dashboard, or a
        // subscription invoice, reaches this same endpoint carrying none of them,
        // and the `if` above simply skipped and answered 200. A paid customer with
        // no credits and nothing in the logs is the worst version of this: support
        // has to find it from the Stripe side, if anyone reports it at all.
        //
        // ERROR, not WARNING, and still a 200: retrying the webhook would produce
        // the same unattributable session forever. What is needed is a person.
        logEvent(
          { jobId: s.id, appId: m.appId ?? '-', userId: m.userId ?? '-' },
          'ERROR',
          'credits.purchase_unattributed',
          {
            paymentStatus: s.payment_status,
            amountUsd: (s.amount_total ?? 0) / 100,
            plan: m.planId,
            credits: m.credits,
            message: 'a paid session carried no appId/userId/credits metadata; nothing was credited',
          },
        );
      }
    }
    return reply.code(200).send({ received: true });
  },
);

// --- Admin (backoffice) -----------------------------------------------------
app.post(
  '/admin/credits/grant',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Grant credits to a user (admin / promo / testing)',
      description:
        'Recorded in the credit ledger with attribution: `grantedBy` is taken from the admin token ' +
        '(never the body) and a `reason` is required for the audit trail.',
      tags: ['admin'],
      security: sec,
      body: {
        type: 'object',
        required: ['appId', 'userId', 'credits', 'reason'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', minLength: 1, maxLength: 128 },
          userId: { type: 'string', minLength: 1, maxLength: 320 },
          credits: { type: 'integer', minimum: 1, maximum: 1_000_000 },
          reason: { type: 'string', minLength: 1, maxLength: 500, description: 'Why the credits were granted (audit).' },
          idempotencyKey: { type: 'string', maxLength: 128, description: 'Optional: dedupes retries/double-clicks.' },
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
  async (req) => {
    const b = req.body as {
      appId: string;
      userId: string;
      credits: number;
      reason: string;
      idempotencyKey?: string;
      note?: string;
    };
    // Attribution comes from the verified admin token, never the request body.
    const grantedBy = req.auth!.email;
    const res = await grantCredits({
      appId: b.appId,
      userId: b.userId,
      credits: b.credits,
      reason: b.reason,
      grantedBy,
      ...(b.idempotencyKey ? { idempotencyKey: b.idempotencyKey } : {}),
      ...(b.note ? { note: b.note } : {}),
    });
    return { granted: res.applied ? b.credits : 0, applied: res.applied, grantedBy, balance: res.balance };
  },
);

app.get(
  '/admin/settings',
  { preHandler: requireAdmin, schema: { summary: 'Get general settings (default rate limits)', tags: ['admin'], security: sec } },
  async () => ({ settings: await getSettings() }),
);

app.patch(
  '/admin/settings',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Update general settings (default rate limits)',
      description: 'Set reports/hour defaults per app and per user. Use null to clear (unlimited).',
      tags: ['admin'],
      security: sec,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appRateLimitPerHour: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 },
          userRateLimitPerHour: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 },
        },
      },
    },
  },
  async (req) => {
    const body = (req.body ?? {}) as { appRateLimitPerHour?: number | null; userRateLimitPerHour?: number | null };
    return { settings: await updateSettings(body) };
  },
);

app.get(
  '/admin/apps',
  { preHandler: requireAdmin, schema: { summary: 'List apps', tags: ['admin'], security: sec } },
  async () => ({ apps: (await listApps()).map(toPublicApp) }),
);

app.post(
  '/admin/apps',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Create an app (returns the generated apiKey once)',
      tags: ['admin'],
      security: sec,
      body: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          role: { type: 'string', enum: ['admin', 'app'] },
          // Must stay within what `isValidAppId` accepts (apps/api/src/stripe.ts):
          // an app id outside it is silently unbillable — no catalog, no checkout —
          // which is a miserable thing to debug months after the app was created.
          appId: { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'Optional slug doc id (lowercase, digits and -); a UUID is generated if omitted. Underscores are not allowed: balances, credentials and stats are keyed `<appId>__<userId>`, so an appId containing `_` makes two different identities share one key.' },
          rateLimitPerHour: { type: 'integer', minimum: 1, maximum: 1_000_000, description: 'Optional reports/hour cap.' },
          allowedTemplates: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 128 }, description: 'If set, the only models this app may run (admin apps are exempt).' },
          googleClientId: { type: 'string', maxLength: 256 },
          adminEmails: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 320 } },
          emailFrom: { type: 'string', maxLength: 320, description: 'Verified Postmark From address for this app\'s account emails.' },
          webUrl: { type: 'string', maxLength: 512, description: 'Public web origin (for email links), no trailing slash.' },
        },
      },
    },
  },
  async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      role?: 'admin' | 'app';
      appId?: string;
      rateLimitPerHour?: number;
      allowedTemplates?: string[];
      googleClientId?: string;
      adminEmails?: string[];
      emailFrom?: string;
      webUrl?: string;
    };
    if (!body.name) return reply.code(400).send({ error: 'Missing "name".' });
    const created = await createApp({
      name: body.name,
      role: body.role ?? 'app',
      appId: body.appId,
      rateLimitPerHour: body.rateLimitPerHour,
      allowedTemplates: body.allowedTemplates,
      googleClientId: body.googleClientId,
      adminEmails: body.adminEmails,
      emailFrom: body.emailFrom,
      webUrl: body.webUrl,
    });
    // Return the full record (incl. apiKey) ONCE, at creation time.
    return reply.code(201).send({ app: created });
  },
);

app.patch(
  '/admin/apps/:appId',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Update an app (activate/deactivate, rename, set/clear rate limit)',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { appId: { type: 'string', maxLength: 128 } }, required: ['appId'] },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          active: { type: 'boolean' },
          rateLimitPerHour: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000, description: 'null clears the limit.' },
          allowedTemplates: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 128 }, description: 'Models this app may run (admin apps exempt).' },
          googleClientId: { type: 'string', maxLength: 256 },
          adminEmails: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 320 } },
          emailFrom: { type: 'string', maxLength: 320 },
          webUrl: { type: 'string', maxLength: 512 },
        },
      },
    },
  },
  async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const body = (req.body ?? {}) as {
      name?: string;
      active?: boolean;
      rateLimitPerHour?: number | null;
      allowedTemplates?: string[];
      googleClientId?: string;
      adminEmails?: string[];
      emailFrom?: string;
      webUrl?: string;
    };
    const updated = await updateApp(appId, body);
    if (!updated) return reply.code(404).send({ error: `Unknown app: ${appId}` });
    return { app: toPublicApp(updated) };
  },
);

app.delete(
  '/admin/apps/:appId',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Delete an app',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { appId: { type: 'string', maxLength: 128 } }, required: ['appId'] },
    },
  },
  async (req, reply) => {
    const { appId } = req.params as { appId: string };
    // Don't let an admin delete the app their own token belongs to.
    if (appId === req.auth!.appId) return reply.code(400).send({ error: 'Refusing to delete your own app.' });
    const existing = await getApp(appId);
    if (!existing) return reply.code(404).send({ error: `Unknown app: ${appId}` });
    await deleteApp(appId);
    return reply.code(200).send({ deleted: appId });
  },
);

app.get(
  '/admin/stats',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Cross-app dashboard stats (totals + per-app + daily series)',
      description: 'Global totals (errors = reportsFailed, avg/min/max total gen time), per-app rollups, and a merged daily series.',
      tags: ['admin'],
      security: sec,
      querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } } },
    },
  },
  async (req) => {
    const { days } = req.query as { days?: number };
    return getAdminStats(days ?? 30);
  },
);

app.get(
  '/admin/users',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Search / list users across apps (from the app-users rollup)',
      tags: ['admin'],
      security: sec,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appId: { type: 'string', maxLength: 128, description: 'Filter to one app.' },
          q: { type: 'string', maxLength: 320, description: 'Email/userId prefix match.' },
          neverPurchased: { type: 'boolean', description: 'Only users who signed up but never bought credits.' },
          blocked: { type: 'boolean', description: 'Only blocked users.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  },
  async (req) => {
    const { appId, q, neverPurchased, blocked, limit } = req.query as { appId?: string; q?: string; neverPurchased?: boolean; blocked?: boolean; limit?: number };
    return { users: await queryUsers({ appId, emailPrefix: q, neverPurchased, blocked, limit: limit ?? 50 }) };
  },
);

app.post(
  '/admin/users/block',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Block or unblock a user (report generation + credit purchases)',
      description: 'A blocked user can still log in and read past reports, but cannot generate new reports or buy credits. Unblocking also resets the moderation strike count.',
      tags: ['admin'],
      security: sec,
      body: {
        type: 'object',
        required: ['appId', 'userId', 'blocked'],
        additionalProperties: false,
        properties: {
          appId: { type: 'string', maxLength: 128 },
          userId: { type: 'string', maxLength: 320 },
          blocked: { type: 'boolean' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
  async (req, reply) => {
    const b = req.body as { appId: string; userId: string; blocked: boolean; reason?: string };
    await setUserBlocked(b.appId, b.userId, b.blocked, b.reason);
    logEvent({ jobId: '-', appId: b.appId, userId: b.userId }, 'INFO', 'admin.user_block', { blocked: b.blocked, by: req.auth!.email });
    return { appId: b.appId, userId: b.userId, blocked: b.blocked };
  },
);

app.get(
  '/admin/jobs',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'List / filter research jobs across apps',
      tags: ['admin'],
      security: sec,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appId: { type: 'string', maxLength: 128 },
          userId: { type: 'string', maxLength: 320 },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'incomplete', 'held'] },
          template: { type: 'string', maxLength: 128 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  },
  async (req) => {
    const q = req.query as { appId?: string; userId?: string; status?: JobStatus; template?: string; limit?: number };
    const jobs = await queryJobs({ appId: q.appId, userId: q.userId, status: q.status, template: q.template, limit: q.limit ?? 50 });
    return {
      jobs: jobs.map((j) => ({
        jobId: j.jobId,
        appId: j.appId,
        userId: j.userId,
        template: j.template,
        title: j.title ?? null,
        status: j.status,
        // Why it failed, when the reason is ours rather than the model's — a
        // cost-ceiling stop is a refunded job that still cost money, and it should
        // be findable in the list without opening each one.
        failureKind: j.failureKind ?? null,
        hold: j.hold ?? null,
        cost: j.cost ?? null,
        attempts: j.attempts ?? null,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        finishedAt: j.finishedAt ?? null,
      })),
    };
  },
);

app.post(
  '/admin/jobs/:jobId/retry',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Re-run a failed/incomplete job (manual retry)',
      description:
        'Resets the job to queued with a fresh retry budget and re-dispatches it to the worker. ' +
        'Credits are not re-charged. Rejects a job that is still queued or running.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    // Only a FAILED job. `queued`/`running` was the wrong shape of guard: it let
    // retry re-run a COMPLETED job (a whole report's infra cost, charged to
    // nobody, per click — the checkpoint is deleted on completion, so it starts
    // from zero), and it let a HELD job resume around `approve`, skipping the
    // approval transaction, the budget override and the slot claim while leaving
    // `hold` on the document so the admin still saw it as parked.
    if (job.status !== 'failed') {
      return reply.code(409).send({
        error: `Job is ${job.status}. Only a failed job can be retried${job.status === 'held' ? ' — approve it instead' : ''}.`,
      });
    }
    // A refunded job is an UNPAID job. Re-running it does not re-charge (that is
    // what makes retry safe for a job that is still paid for), so without this it
    // hands the owner a full report they were already given the credits back for —
    // a free report, created the moment refunds became a decision an admin makes.
    // Every job pays, so the way back is the owner paying: grant them credits and
    // let them submit again.
    if (await wasJobRefunded(jobId)) {
      return reply.code(409).send({
        error:
          'This job was refunded, so it is no longer paid for. Grant the owner credits and have them submit a new request.',
        code: 'job_refunded',
      });
    }
    // Transactional, and it re-checks the refund inside: the read above is a read,
    // so a `resolve{refund}` committing between the two would leave this job queued
    // and unpaid — the exact outcome the refund guard exists to prevent.
    if (!(await requeueJob(jobId, { onlyIfStatus: 'failed', refuseIfRefunded: true }))) {
      return reply.code(409).send({ error: 'Job is no longer retryable.', code: 'job_refunded' });
    }
    // A failed job gave its slot back. Running again means holding one again —
    // forced, like an approval, because an admin has decided this job runs.
    await claimJobSlot(job.appId, job.userId, MAX_CONCURRENT_JOBS_PER_USER, { force: true });
    // If the job ended between the claim and the flag, give the slot straight back
    // — otherwise the counter is stuck at one with no job left to release it.
    if (!(await setJobSlotHeld(jobId, true))) await releaseUnclaimedSlot(job.appId, job.userId).catch((err) =>
        logEvent({ jobId, appId: job.appId, userId: job.userId }, 'ERROR', 'slot.release_failed', { message: (err as Error).message }),
      );

    const { enqueueJob } = await import('./enqueue.js');
    await enqueueJob(jobId, { unique: true });
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'INFO', 'job.retry', { by: req.auth!.email });
    return reply.code(202).send({ jobId, status: 'queued' });
  },
);

app.post(
  '/admin/jobs/:jobId/approve',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Approve a held job to continue',
      description:
        'Lets a job that is PAUSED for a decision continue: it resumes from its checkpoint (finished steps are ' +
        'not re-run) with NO cost ceiling, and the credits already consumed are not re-charged. ' +
        'Only valid on a job whose status is `held`; 409 otherwise, including when another admin or the ' +
        'expiry sweep resolved it first.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    if (job.status !== 'held') return reply.code(409).send({ error: `Job is ${job.status}, not held.` });

    // The transaction is the gate: two admins clicking approve at once must
    // produce exactly one outcome.
    if (!(await approveHold(jobId, req.auth!.email))) {
      return reply.code(409).send({ error: 'Job is no longer held.' });
    }

    // Take the slot back for the resumed job, and take it whether or not the buyer
    // has something else running. An admin has already decided this job finishes;
    // refusing on the buyer's one-at-a-time cap would make the decision unactionable
    // exactly when the buyer got tired of waiting and started another (Javier,
    // 2026-07-31). The job carries the claim, so the release path is the usual one.
    await claimJobSlot(job.appId, job.userId, MAX_CONCURRENT_JOBS_PER_USER, { force: true });
    // If the job ended between the claim and the flag, give the slot straight back
    // — otherwise the counter is stuck at one with no job left to release it.
    if (!(await setJobSlotHeld(jobId, true))) await releaseUnclaimedSlot(job.appId, job.userId).catch((err) =>
        logEvent({ jobId, appId: job.appId, userId: job.userId }, 'ERROR', 'slot.release_failed', { message: (err as Error).message }),
      );

    const { enqueueJob } = await import('./enqueue.js');
    await enqueueJob(jobId, { unique: true });
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'WARNING', 'job.hold_approved', {
      by: req.auth!.email, reason: job.hold?.reason, spentUsd: job.hold?.spentUsd ?? 0,
    });
    return reply.code(202).send({ jobId, status: 'queued' });
  },
);

app.post(
  '/admin/jobs/:jobId/park',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Park a stuck job so it can be decided on',
      description:
        'Moves a `queued` or `running` job into the PAUSED state and frees the slot it was holding. ' +
        'For a job the queue has given up on: Cloud Tasks stops re-dispatching on its own schedule, and a ' +
        'job whose dispatches are slow can exhaust that window before the engine finalizes — leaving it ' +
        '`running` forever, with the buyer locked out of starting another and their credits spent. Once ' +
        'parked, the ordinary decision applies: approve, refund, or close. Safe on a job that really is ' +
        'still running: a straggler cannot deliver a job something else already resolved. 409 otherwise.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 500, description: 'Why (admin-only note).' } },
      },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });

    const parked = await parkJob(jobId, {
      reason: 'run_failed',
      heldAt: new Date().toISOString(),
      spentUsd: job.cost?.usd ?? 0,
      detail: (reason ?? 'Parked by an admin: the job stopped making progress.').slice(0, 500),
    });
    if (!parked) return reply.code(409).send({ error: `Job is ${job.status}, not queued or running.` });

    // Free the buyer immediately. A stuck job held their only slot, so they could
    // not start anything at all until someone noticed.
    await releaseJobSlot(jobId).catch(() => {});
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'WARNING', 'job.parked', {
      by: req.auth!.email, from: job.status, costUsd: job.cost?.usd ?? 0,
    });
    return { jobId, status: 'held' };
  },
);

app.post(
  '/admin/jobs/:jobId/resolve',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Close a held job — with or without a refund',
      description:
        'Resolves a PAUSED job against the buyer: it is marked failed, and `outcome` decides the money. ' +
        '`refund` returns the credits this job consumed; `dismiss` closes it without returning anything ' +
        '(use it when the buyer was topped up instead, or when the job was abusive). Either way the spend ' +
        'stays on the job and is booked in the stats — the money went out regardless. ' +
        'To top a buyer up instead, POST /admin/credits/grant and then dismiss. 409 if the job is not held.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
      body: {
        type: 'object',
        required: ['outcome'],
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['refund', 'dismiss'] },
          reason: { type: 'string', maxLength: 500, description: 'Why (audit; never shown to the buyer).' },
        },
      },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const { outcome, reason } = req.body as { outcome: 'refund' | 'dismiss'; reason?: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });

    const held = job.status === 'held';
    // A job that is no longer held can still be OWED its refund.
    //
    // The flip has to come first — it is what stops two admins both moving money —
    // so there is a window where the job reads `failed` and the credits have not
    // moved. A Firestore blip in that window (and a refund is the call that most
    // needs to survive one) used to be terminal: this handler 409'd on anything not
    // `held`, `retry` refuses a refunded job, and nothing else refunds. The money
    // was simply stuck. Finishing that refund is the one action still allowed here.
    // …and ONLY a refund that was actually decided on. Intent is not recoverable
    // from state: a dismissed job and one whose refund threw both read `failed` and
    // unrefunded, so without the recorded decision this path quietly reversed a
    // deliberate "close without refund" on a second click — and logged it as the
    // completion of the first decision. Measured, before this line existed.
    const owedRefund =
      !held &&
      job.status === 'failed' &&
      outcome === 'refund' &&
      job.hold?.resolvedOutcome === 'refund' &&
      !(await wasJobRefunded(jobId));
    if (!held && !owedRefund) {
      return reply.code(409).send({ error: `Job is ${job.status}, not held.` });
    }

    const lang = job.params?.language;
    if (held) {
      // The NEUTRAL note, always. Writing "the credits were returned" here promised
      // something that had not happened yet and could still fail — and `job.error`
      // is the buyer's field, not an internal one.
      if (!(await rejectHold(jobId, closedNotice(lang, false), { outcome, by: req.auth!.email }))) {
        return reply.code(409).send({ error: 'Job is no longer held.' });
      }
    }

    // `.catch` for the same reason the enqueue-failure refund has one: the likely
    // cause of a throw is Firestore being unavailable, and a 500 here would leave
    // the admin with a job they can no longer act on. `false` sends them back
    // around the `owedRefund` path above instead.
    // The throw and the `false` mean different things and were being conflated.
    // `false` with nothing in the ledger is "there is nothing to refund" — a job
    // that never consumed credits — and reporting THAT as a failure told the admin
    // to retry forever on a buyer who was never charged.
    let refunded = false;
    let refundThrew = false;
    if (outcome === 'refund') {
      try {
        refunded = await refundForJob(jobId, reason ?? 'admin resolved a held job');
      } catch {
        // Same reason the enqueue-failure refund has a catch: the likely cause is
        // Firestore being unavailable, and a 500 here leaves the admin with a job
        // they can no longer act on.
        refundThrew = true;
      }
    }
    const refundFailed = refundThrew || (outcome === 'refund' && !refunded && (await wasJobConsumed(jobId)));

    // Now that the money has actually moved, the buyer can be told so. Best-effort:
    // failing to upgrade the note leaves them under-promised, which is the safe
    // direction, and the ledger is the record either way.
    if (refunded) await noteJobResolution(jobId, closedNotice(lang, true)).catch(() => {});

    // Booked here, not in the worker: this is where the job actually finished. Only
    // on the real resolution — the recovery path is finishing that same decision,
    // not making a second one, and would otherwise book the failure twice.
    if (held) {
      try {
        await recordReportStats({
          appId: job.appId, userId: job.userId, template: job.template,
          status: 'failed', costUsd: job.cost?.usd ?? 0, durationMs: 0, refunded,
          ...(job.hold?.reason ? { failureKind: job.hold.reason } : {}),
        });
      } catch {
        /* analytics are best-effort; the decision already happened */
      }
    }

    // A resolved job holds nothing. `park` releases and `approve` compensates; this —
    // the path that ends a job for good — released nothing, so a held job whose own
    // best-effort release had failed stayed flagged with the counter at 1. With the
    // cap at one report the buyer could never start another, and `retry` cannot heal
    // it because a refunded job is refused.
    //
    // Only on the real resolution. On the recovery path the slot was released the
    // first time round, and a `retry` landing in the meantime has legitimately
    // claimed a NEW one — releasing that gave the buyer a run with no slot booked,
    // a one-time bypass of the one-at-a-time cap that this route introduced.
    if (held) await releaseJobSlot(jobId).catch(() => {});
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'WARNING', 'job.hold_resolved', {
      by: req.auth!.email, outcome, refunded, recovered: owedRefund, reason: job.hold?.reason,
      spentUsd: job.hold?.spentUsd ?? 0,
    });
    // `refundFailed` is the case an admin has to see: the job is closed, the buyer
    // has not been paid back, and calling this again with `outcome: 'refund'` is
    // what finishes it. A caller reading only the 200 would otherwise assume the
    // credits moved.
    return { jobId, status: 'failed', refunded, ...(refundFailed ? { refundFailed: true } : {}) };
  },
);

app.post(
  '/admin/jobs/:jobId/read-token',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Mint a read-only link to view a report in its app',
      description:
        'Returns a short-lived (15 min) token scoped to reading ONLY this one report, plus the ' +
        "job's appId. The admin front opens the app at /report/:jobId?rt=<token> so the report can " +
        'be viewed rendered, exactly as the user sees it. The token cannot launch jobs, spend ' +
        'credits, or read anything else, and expires quickly — leaking it does nothing lasting.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { jobId: { type: 'string', maxLength: 128 } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
    const token = await signReadToken({ email: job.userId, appId: job.appId, jobId });
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'INFO', 'job.read_token', { by: req.auth!.email });
    return { token, appId: job.appId, jobId, expiresInSeconds: 15 * 60 };
  },
);

/**
 * Shared value lists a client may offer for a param — see `paramsUi.catalog`.
 *
 * AUTHENTICATED, and not because the contents are secret: Florida's counties are a
 * matter of public record. It is that an unauthenticated endpoint is a surface with
 * its own rate limit, its own abuse story and its own place in every future review,
 * bought for a list only a logged-in buyer's form ever draws. `jwtAuth` already
 * guards everything that is not explicitly public, so this is the default rather
 * than a decision — worth stating because the temptation with reference data is to
 * open it.
 *
 * Two routes on purpose: a client picking a catalog does not need 124 rows to do it.
 */
app.get(
  '/catalogs',
  { schema: { summary: 'List the shared value catalogs', tags: ['templates'], security: sec } },
  async () => ({ catalogs: listCatalogs() }),
);

app.get(
  '/catalogs/:catalogId',
  {
    schema: {
      summary: 'One catalog’s values, for a param that points at it',
      tags: ['templates'],
      security: sec,
      params: { type: 'object', required: ['catalogId'], properties: { catalogId: { type: 'string', maxLength: 128 } } },
    },
  },
  async (req, reply) => {
    const { catalogId } = req.params as { catalogId: string };
    const catalog = getCatalog(catalogId);
    if (!catalog) return reply.code(404).send({ error: `Unknown catalog: ${catalogId}` });
    // Immutable in practice — the counties last changed in 1925 — so let a client
    // hold it. The manifest cache TTL is the shorter of the two anyway.
    reply.header('Cache-Control', `private, max-age=${PUBLIC_BROWSER_MAX_AGE}`);
    return catalog;
  },
);

// --- Admin: per-model credit pricing (Firestore overrides) ------------------

/**
 * Bring a model's stored credit floor in line with what its packs actually sell at.
 *
 * The floor is NEVER typed. It is `min(priceUsd / credits)` over the model's live
 * Stripe packs, and this is the only thing that writes it — called after every pack
 * write, after a retirement, and when the pricing page is read with an app in hand.
 *
 * It has to be STORED rather than computed on demand because the reader is the
 * WORKER, which resolves a job's cost ceiling and has no Stripe client. A figure
 * that only existed on an admin page would be a ceiling nobody could enforce.
 *
 * An unusable catalog changes nothing: `undefined` from `creditFloorFrom` means
 * Stripe is down, the app has no products, or a pack has no credits — none of which
 * is "credits are free". Storing 0 would derive a ceiling of 0 and hold every job
 * of the model.
 */
async function syncCreditFloor(templateId: string, appId: string): Promise<number | undefined> {
  if (!stripeConfigured() || !isValidAppId(appId)) return undefined;
  const packs = await listStripePlans(appId, 'en', { templateId }).catch(() => []);
  const floor = creditFloorFrom(packs);
  if (floor === undefined) return undefined;
  const stored = (await getModelPricing(templateId))?.creditFloorUsd;
  if (stored !== undefined && Math.abs(stored - floor) < 0.0001) return floor;
  await setModelPricing(templateId, { creditFloorUsd: floor });
  logEvent({ jobId: '-', appId }, 'INFO', 'pricing.credit_floor', { templateId, from: stored ?? null, to: floor });
  return floor;
}

function pricingView(templateId: string, override: ModelPricing | null) {
  const tmpl = getTemplate(templateId)!;
  const base = toManifest(tmpl); // code/template default credits + add-on catalog
  return {
    templateId,
    modes: base.modes.map((m) => ({
      key: m.key,
      defaultCredits: m.credits,
      credits: override?.modes?.[m.key as 'essential' | 'comprehensive'] ?? m.credits,
    })),
    // Add-ons are defined by the model; the admin only sets their price.
    addons: base.addons.map((a) => ({
      key: a.key,
      label: a.label,
      ...(a.description ? { description: a.description } : {}),
      defaultCredits: a.credits,
      credits: override?.addons?.[a.key] ?? a.credits,
    })),
    updatedAt: override?.updatedAt ?? null,
    /**
     * The economics, and the ceilings they produce. Both inputs are editable here
     * and neither is a code constant: a job may spend at most
     * `credits × creditFloorUsd × (1 − expectedProfitPct/100)` before it is HELD, so
     * a delivered job cannot be a loss however badly it goes (D1).
     *
     * `ceilingUsd` is returned rather than left for the client to recompute — it is
     * the number actually enforced, `MAX_JOB_COST_USD` clamp included, and an admin
     * changing a price needs to see what it did.
     */
    economics: {
      creditFloorUsd: override?.creditFloorUsd ?? config.pricing.creditFloorUsd,
      creditFloorSource: override?.creditFloorUsd != null ? 'stored' : 'default',
      expectedProfitPct: override?.expectedProfitPct ?? config.pricing.expectedProfitPct,
      maxJobCostUsd: config.workflow.maxJobCostUsd,
      // Per tier: what it earns, what a job of it may spend, and — the half an
      // admin could not see anywhere — what that money actually BUYS. `modeShapes`
      // is the engine's own filter and its own per-agent budget line, shared rather
      // than reimplemented, so a tier's turns here are the turns a job will get.
      ceilings: modeShapes(tmpl).map((shape) => {
        const credits = override?.modes?.[shape.key] ?? base.modes.find((m) => m.key === shape.key)?.credits ?? 0;
        return {
          ...shape,
          credits,
          earnsUsd: credits * (override?.creditFloorUsd ?? config.pricing.creditFloorUsd),
          ceilingUsd: resolveModeCeiling(override, resolveMode(tmpl.modes, shape.key).config, shape.key, config.workflow.maxJobCostUsd),
        };
      }),
    },
  };
}

app.get(
  '/admin/pricing/:templateId',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Get a model’s credit pricing (code default + Firestore override)',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { templateId: { type: 'string', maxLength: 128 } }, required: ['templateId'] },
      querystring: {
        type: 'object',
        properties: {
          appId: {
            type: 'string',
            maxLength: 128,
            description: 'Refresh the credit floor from this app’s live packs before answering.',
          },
        },
      },
    },
  },
  async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    if (!getTemplate(templateId)) return reply.code(404).send({ error: `Unknown model: ${templateId}` });
    // Self-healing: the packs are the source, so reading this page with an app in
    // hand is a chance to notice that someone edited a price in the Stripe
    // dashboard and the stored figure went stale. Nothing else can drift it.
    const { appId } = req.query as { appId?: string };
    if (appId) await syncCreditFloor(templateId, appId);
    return pricingView(templateId, await getModelPricing(templateId));
  },
);

app.put(
  '/admin/pricing/:templateId',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Set a model’s credit pricing override (per mode + add-ons)',
      description: 'Overrides the code default without a deploy. Omit a mode to keep its default.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', properties: { templateId: { type: 'string', maxLength: 128 } }, required: ['templateId'] },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Any mode key the MODEL declares — the two names used to be written out
          // here, so a model with flavours of its own could not be priced at all.
          // Unknown keys are dropped in the handler, the way add-on keys are.
          modes: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 1_000_000 } },
          addons: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 1_000_000 } },
          // No `creditFloorUsd`: it is derived from the model's packs and written
          // by `syncCreditFloor` alone. A hand-typed floor is a number that decides
          // every cost ceiling and matches nothing anyone sells.
          expectedProfitPct: {
            type: 'number',
            minimum: 0,
            maximum: 99,
            description: 'Gross margin a job must leave on its report. The cost ceiling is derived from it.',
          },
        },
      },
    },
  },
  async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const tmpl = getTemplate(templateId);
    if (!tmpl) return reply.code(404).send({ error: `Unknown model: ${templateId}` });
    const body = (req.body ?? {}) as {
      modes?: Record<string, number>;
      addons?: Record<string, number>;
      expectedProfitPct?: number;
    };
    // Add-on keys must exist in the model's catalog — the admin only prices them.
    const validAddons = new Set((tmpl.addons ?? []).map((a) => a.key));
    const addons = body.addons
      ? Object.fromEntries(Object.entries(body.addons).filter(([k]) => validAddons.has(k)))
      : undefined;
    // Same rule for modes, and it is new: the schema used to name the two flavours
    // so an unknown key could not arrive. Now any slug can, and a price stored for
    // a mode the model does not have would sit in Firestore forever, priced and
    // unreachable — or, worse, become live the day someone adds that flavour.
    const validModes = new Set(modesOf(tmpl.modes).map(([k]) => k));
    const modes = body.modes
      ? Object.fromEntries(Object.entries(body.modes).filter(([k]) => validModes.has(k)))
      : undefined;
    await setModelPricing(templateId, {
      modes: modes as ModelPricing['modes'],
      addons,
      ...(body.expectedProfitPct !== undefined ? { expectedProfitPct: body.expectedProfitPct } : {}),
    });
    // Drop the cached manifest for this model so the user front picks up the new
    // mode costs (the admin itself already reads uncached).
    bustPublicCache(`manifest:${templateId}:`);
    logEvent({ jobId: '-', appId: 'admin', userId: req.auth!.email }, 'INFO', 'pricing.updated', { templateId, modes: body.modes, addons });
    return pricingView(templateId, await getModelPricing(templateId));
  },
);

/**
 * What the pricing WOULD look like — the same view, computed and not stored.
 *
 * The alternative was recomputing the ceilings in the browser so an admin could see
 * a change before saving it, and that is a second implementation of the formula
 * that bills. This keeps one: the client sends the edit, the server answers with
 * the view it would produce.
 */
app.post(
  '/admin/pricing/:templateId/preview',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Compute a model’s pricing view for an unsaved edit (stores nothing)',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', required: ['templateId'], properties: { templateId: { type: 'string', maxLength: 128 } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          modes: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 1_000_000 } },
          creditFloorUsd: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
          expectedProfitPct: { type: 'number', minimum: 0, maximum: 99 },
        },
      },
    },
  },
  async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    if (!getTemplate(templateId)) return reply.code(404).send({ error: `Unknown model: ${templateId}` });
    const body = (req.body ?? {}) as ModelPricing;
    // Merged over what is STORED, so a preview of one field is not a preview of
    // that field against the code defaults for every other.
    const stored = await getModelPricing(templateId);
    return pricingView(templateId, { ...stored, ...body, modes: { ...stored?.modes, ...body.modes } });
  },
);

// --- Admin: the credit packs, written INTO Stripe --------------------------
//
// The catalog stays in Stripe — its reporting, its refunds, its review — but the
// fields the system depends on stop being typed by a person in the Stripe
// dashboard. `appId`, `templateId`, `planId` and `credits` are written by
// `upsertStripePlan`, because a pack created with `credits` missing takes someone's
// money and grants nothing, and is invisible until it does: a product with bad
// metadata simply never appears in `listStripePlans`.
//
// Which Stripe ACCOUNT is not a choice made here. The API only ever holds its own
// `STRIPE_SECRET_KEY` — the dev deploy gets `STRIPE_SECRET_KEY_DEV`, prod gets
// `_PROD` — so dev edits the sandbox and prod edits live, and neither can reach the
// other even by mistake.
app.get(
  '/admin/plans',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'List an app’s credit packs (optionally only a model’s)',
      tags: ['admin'],
      security: sec,
      querystring: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', maxLength: 128 },
          templateId: { type: 'string', maxLength: 128, description: 'Only packs sold for this model (plus the untagged ones).' },
        },
      },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const { appId, templateId } = req.query as { appId: string; templateId?: string };
    if (!isValidAppId(appId)) return reply.code(400).send({ error: `Invalid appId: ${appId}` });
    // `withCopy`: the editor needs every locale, not the resolved fallback.
    return { plans: await listStripePlans(appId, 'en', { templateId, withCopy: true }) };
  },
);

app.put(
  '/admin/plans/:planId',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Create or update a credit pack in Stripe',
      description:
        'Writes the Product + its default Price. Changing an amount requires `expectedPriceUsd` to match ' +
        'what Stripe currently charges — the confirmation is enforced here, not in the UI.',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', required: ['planId'], properties: { planId: { type: 'string', maxLength: 128 } } },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['appId', 'templateId', 'name', 'credits', 'priceUsd'],
        properties: {
          appId: { type: 'string', maxLength: 128 },
          templateId: { type: 'string', maxLength: 128 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          credits: { type: 'integer', minimum: 1, maximum: 1_000_000 },
          priceUsd: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
          popular: { type: 'boolean' },
          sub: { type: 'object', additionalProperties: { type: 'string', maxLength: 300 } },
          features: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 12 } },
          expectedPriceUsd: {
            type: 'number',
            minimum: 0,
            description: 'What the editor was shown. Required to CHANGE a price; ignored otherwise.',
          },
        },
      },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const { planId } = req.params as { planId: string };
    const b = req.body as {
      appId: string; templateId: string; name: string; credits: number; priceUsd: number;
      popular?: boolean; sub?: Record<string, string>; features?: Record<string, string[]>; expectedPriceUsd?: number;
    };
    if (!isValidAppId(b.appId)) return reply.code(400).send({ error: `Invalid appId: ${b.appId}` });
    if (!getTemplate(b.templateId)) return reply.code(404).send({ error: `Unknown model: ${b.templateId}` });
    try {
      const res = await upsertStripePlan(b.appId, b.templateId, { ...b, planId }, { expectedPriceUsd: b.expectedPriceUsd });
      logEvent({ jobId: '-', appId: b.appId, userId: req.auth!.email }, 'INFO', 'plan.saved', {
        planId, templateId: b.templateId, priceChanged: res.priceChanged, from: res.previousPriceUsd, to: b.priceUsd,
      });
      // The floor a model's ceilings derive from is a function of its packs, so a
      // price change moves it. Bust the manifest cache; the admin recomputes the
      // floor with the button when it wants the new number stored.
      // The packs ARE the floor. Recomputed here so the worker's ceilings follow a
      // price change without anyone opening the pricing page.
      await syncCreditFloor(b.templateId, b.appId);
      bustPublicCache('plans:');
      return res;
    } catch (err) {
      // 428 = "confirm this", 409 = "someone else changed it". Both are the price
      // guard, and both are the caller's to resolve rather than ours to override.
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 428 || code === 409) return reply.code(code).send({ error: (err as Error).message });
      throw err;
    }
  },
);

app.post(
  '/admin/plans/:planId/archive',
  {
    preHandler: requireAdmin,
    schema: {
      summary: 'Retire a credit pack (Stripe `active: false`, never a delete)',
      tags: ['admin'],
      security: sec,
      params: { type: 'object', required: ['planId'], properties: { planId: { type: 'string', maxLength: 128 } } },
      body: { type: 'object', required: ['appId'], additionalProperties: false, properties: { appId: { type: 'string', maxLength: 128 } } },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const { planId } = req.params as { planId: string };
    const { appId } = req.body as { appId: string };
    if (!isValidAppId(appId)) return reply.code(400).send({ error: `Invalid appId: ${appId}` });
    const ok = await archiveStripePlan(appId, planId);
    if (!ok) return reply.code(404).send({ error: `No pack "${planId}" for app "${appId}".` });
    // Retiring the cheapest pack RAISES the floor, which raises every ceiling. The
    // direction that is easy to forget, and the one that costs money.
    for (const t of listTemplates()) await syncCreditFloor(t.id, appId);
    bustPublicCache('plans:');
    logEvent({ jobId: '-', appId, userId: req.auth!.email }, 'INFO', 'plan.archived', { planId });
    return { archived: true, planId };
  },
);

// --- Start ------------------------------------------------------------------
export { app };

const start = async () => {
  try {
    if (config.server.appEnv === 'local') {
      app.log.warn('APP_ENV=local — auth is DISABLED (identity from x-app-id/x-user-id/x-role).');
    }
    await app.listen({ host: '0.0.0.0', port: config.server.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Don't bind a port under test — tests drive routes via app.inject().
if (!process.env.VITEST) start();
