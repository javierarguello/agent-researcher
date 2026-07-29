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
  getJob,
  getSettings,
  listApps,
  listJobs,
  getUserJobStats,
  queryJobs,
  requeueJob,
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
  moderateResearchParams,
  moderationMessage,
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
  getBalance,
  listTransactions,
  grantCredits,
  recordPurchase,
  recordPurchaseStats,
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
  InsufficientCreditsError,
  type RateLimitEntry,
  type LedgerEntryType,
  type JobStatus,
} from '@agent-researcher/core';
import type Stripe from 'stripe';
import { jwtAuth, requireAdmin } from './auth.js';
import { stripe, stripeConfigured, listStripePlans, resolveStripePlan, isValidAppId } from './stripe.js';
import { cached, bustPublicCache, PUBLIC_TTL_MS, PUBLIC_EMPTY_TTL_MS, PUBLIC_BROWSER_MAX_AGE, PUBLIC_BROWSER_SWR } from './cache.js';
import { publicLimit, clientIp } from './public-limit.js';
import { requireCaptcha, captchaBodyProperties } from './captcha.js';

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
        '   = collapsed fields), `modes` (report tiers with their **credit cost**), and `sections`/`reportSchema`',
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
    preHandler: requireCaptcha('login', { when: (req) => (req.body as { provider?: string } | undefined)?.provider === 'password' }),
  },
  async (req, reply) => {
    const b = req.body as { appId?: string; provider?: string; idToken?: string; email?: string; password?: string };
    if (!b.appId || !b.provider) return reply.code(400).send({ error: 'appId and provider are required.' });

    // Unauthenticated + does password hashing → limit per IP and per target email
    // so neither a spray across accounts nor a brute force on one is cheap.
    if (
      await publicLimit(req, reply, {
        route: 'login',
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
          ...captchaBodyProperties,
        },
      },
    },
    preHandler: requireCaptcha('register'),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; email: string; password: string; name?: string };
    const email = normalizeEmail(b.email);
    if (!email.includes('@')) return reply.code(400).send({ error: 'A valid email is required.' });

    // Every registration sends an email on our Postmark account — the most
    // expensive unauthenticated action in the API, and to an address the caller
    // chose. Cap both dimensions: per IP, and per target inbox so it cannot be
    // bombed from many IPs. `email` is normalized, so the bucket can't be split
    // by adding dots or a +tag.
    if (
      await publicLimit(req, reply, {
        route: 'register',
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
      await setPassword(appRec.appId, email, passwordHash); // stuck unverified → update + resend
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
    const tpl = verifyEmailTemplate(appRec.name, link);
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
      summary: 'Verify an email address from the emailed link, then log in',
      description: 'Consumes the `verify-email` token from the link, marks the address verified, and returns a login session.',
      tags: ['auth'],
      body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', maxLength: 4096 } } },
    },
  },
  async (req, reply) => {
    if (await publicLimit(req, reply, { route: 'token', perIp: config.publicLimits.tokenPerHourPerIp })) return reply;
    const { token } = req.body as { token: string };
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
    await setEmailVerified(claims.appId, claims.email);
    logEvent({ jobId: '-', appId: claims.appId, userId: claims.email }, 'INFO', 'auth.email_verified', {});
    return issueSession(appRec, claims.email, cred.name);
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
        properties: { appId: { type: 'string', maxLength: 128 }, email: { type: 'string', maxLength: 320 }, ...captchaBodyProperties },
      },
    },
    preHandler: requireCaptcha('password-reset'),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; email: string };
    const email = normalizeEmail(b.email);
    // Sends an email to an address the caller chooses → limit per IP and per
    // target, so it can't be used to mail-bomb someone else's inbox.
    if (
      await publicLimit(req, reply, {
        route: 'reset',
        perIp: config.publicLimits.resetPerHourPerIp,
        perKey: { limit: config.publicLimits.resetPerHourPerEmail, value: email },
      })
    ) return reply;
    const appRec = await getApp(b.appId);
    // Only send for an existing password account with email configured; but always
    // return 202 so callers can't probe which emails are registered.
    if (appRec && appRec.active && appRec.emailFrom && appRec.webUrl) {
      const cred = await getCredential(appRec.appId, email);
      if (cred && cred.passwordHash) {
        const token = await signActionToken({ email, appId: appRec.appId, scope: 'reset-password' }, config.auth.resetTtlSeconds);
        const link = `${appRec.webUrl}/reset?token=${encodeURIComponent(token)}`;
        const tpl = resetPasswordTemplate(appRec.name, link);
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
    if (await publicLimit(req, reply, { route: 'token', perIp: config.publicLimits.tokenPerHourPerIp })) return reply;
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
    const passwordHash = await hashPassword(b.password);
    await setPassword(claims.appId, claims.email, passwordHash);
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
    preHandler: requireCaptcha('contact'),
  },
  async (req, reply) => {
    const b = req.body as { appId: string; subject?: string; name: string; email: string; message: string };
    // Anonymous + sends an email on our account.
    if (await publicLimit(req, reply, { route: 'contact', perIp: config.publicLimits.contactPerHourPerIp })) return reply;
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
        replyTo: b.email,
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
function reqLang(req: { query?: unknown }): string {
  const l = (req.query as { lang?: string } | undefined)?.lang;
  return l && SUPPORTED_LANGS.includes(l) ? l : DEFAULT_LANG;
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
        '`paramsUi` (layout, per-field help, suggestions, ranges, advanced section), `modes` (report tiers with ' +
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
const MAX_CONCURRENT_JOBS_PER_USER = 1;

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
  if (verdict.ok) return null;
  const strike = await recordModerationStrike(appId, userId, verdict.categories);
  logEvent({ jobId: '-', appId, userId }, 'WARNING', 'research.params_rejected', { categories: verdict.categories, strikes: strike.strikes, blocked: strike.blocked });
  if (strike.blocked) {
    return { code: 403, body: { error: strike.blockedReason, code: 'account_blocked', reason: strike.blockedReason } };
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
    preHandler: requireCaptcha('research'),
  },
  async (req, reply) => {
    let validated;
    try {
      validated = validateRequest(req.body);
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
          error: flags.blockedReason ?? 'Your account is blocked from generating reports.',
          code: 'account_blocked',
          reason: flags.blockedReason,
        });
      }
    }

    // Concurrency: at most N reports in flight per user (queued/running). Enforced
    // before consuming credits so a rejected request costs nothing. Admins exempt.
    if (req.auth!.role !== 'admin') {
      const { inProgress } = await getUserJobStats(appId, userId);
      if (inProgress >= MAX_CONCURRENT_JOBS_PER_USER) {
        return reply.code(409).send({
          error: 'You already have a report in progress. Please wait for it to finish before starting another.',
          code: 'concurrency_limit',
          limit: MAX_CONCURRENT_JOBS_PER_USER,
          inProgress,
        });
      }
    }

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
      if (!rl.allowed && rl.violation) {
        reply.header('Retry-After', '3600');
        return reply.code(429).send({
          error: `Rate limit exceeded: ${rl.violation.limit} reports/hour per ${rl.violation.scope}.`,
          scope: rl.violation.scope,
          limit: rl.violation.limit,
          used: rl.violation.count,
        });
      }
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
    // this read is only here so a caller who provably cannot pay doesn't cost us a
    // model call on the way to the same 402 they were always going to get.
    if (config.server.appEnv !== 'local' && req.auth!.role !== 'admin') {
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
    if (config.server.appEnv !== 'local') {
      const rl = await checkRateLimits(rateEntries);
      if (!rl.allowed && rl.violation) {
        reply.header('Retry-After', '3600');
        return reply.code(429).send({
          error: `Rate limit exceeded: ${rl.violation.limit} reports/hour per ${rl.violation.scope}.`,
          scope: rl.violation.scope,
          limit: rl.violation.limit,
          used: rl.violation.count,
        });
      }
    }

    // Credits gate: consume the mode's credit cost up front (refunded if the job fails).
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

    await createJob({ jobId, appId, userId, template: validated.template, params: validated.params, mode: mode.key, creditsSpent });
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
      return reply.code(202).send({
        jobId,
        status: 'queued',
        warning: 'Job recorded but enqueue failed; retry the request.',
      });
    }

    logEvent(logCtx, 'INFO', 'job.queued', {});
    return reply.code(202).send({ jobId, status: 'queued' });
  },
);

// --- Research: pre-flight validation (moderation + AI preview) ---------------
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
    preHandler: requireCaptcha('preflight'),
  },
  async (req, reply) => {
    let validated;
    try {
      validated = validateRequest(req.body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const appId = req.auth!.appId;
    const userId = req.auth!.email;
    const params = validated.params as Record<string, unknown>;
    const lang = paramsLang(params);
    const tpl = getTemplate(validated.template)!;
    const mode = resolveMode(tpl.modes, params.mode);

    // Which layers may run. Admins always get the assisted one.
    let assist: AssistState = config.validation.llm ? 'on' : 'off_disabled';

    if (req.auth!.role !== 'admin') {
      // 1. Account state. A blocked user previews nothing.
      const flags = await getUserFlags(appId, userId);
      if (flags.blocked) {
        return reply.code(403).send({ error: flags.blockedReason ?? 'Your account is blocked.', code: 'account_blocked', reason: flags.blockedReason });
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

      // 3. Moderation. The deterministic pre-screen always runs and still records
      //    strikes/blocks; the classifier is billed against the allowance above.
      //    Skipping it here is safe because /research moderates in full — and that
      //    is the call that actually spends credits.
      const rej = await moderateParams(appId, userId, params, lang, { llm: assist === 'on' });
      if (rej) return reply.code(rej.code).send(rej.body);
    }

    const outcome = await runPreflight({
      template: tpl,
      params,
      lang,
      modeLabel: modeLabel(tpl, mode.key, lang),
      assist,
    });

    logEvent({ jobId: '-', appId, userId }, 'INFO', 'research.preflight', {
      assist: outcome.assist.state,
      quality: outcome.quality,
      issues: outcome.issues.map((i) => i.code),
      corrections: outcome.corrections.map((c) => c.field),
      ...(outcome.usage ? { inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens } : {}),
    });
    // `usage` is internal metering — it stays in the log, like job cost does.
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
        progress: j.progress ? { phase: j.progress.phase, message: j.progress.message } : null,
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
    // per-agent internals. Progress keeps the current phase + message; summary
    // keeps only what a client should see (whether the report was degraded).
    const isAdmin = req.auth!.role === 'admin';
    const progress = job.progress
      ? isAdmin
        ? job.progress
        : { phase: job.progress.phase, message: job.progress.message, updatedAt: job.progress.updatedAt }
      : null;
    const s = job.summary;
    const summary = s
      ? isAdmin
        ? s
        : { ...(s.warnings ? { warnings: s.warnings } : {}), ...(s.degradedSections ? { degradedSections: s.degradedSections } : {}) }
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
      ...(isAdmin ? { cost: job.cost ?? null } : {}),
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
      files: (job.files ?? []).map((f) => ({
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
    return reply.type('application/json').header('Cache-Control', 'no-store').send(raw);
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
    // Binary files (PDF) must be streamed as bytes, not decoded as UTF-8 text.
    if (name.endsWith('.pdf')) {
      const bytes = await downloadObjectBytes(jobId, name);
      if (!bytes) return reply.code(404).send({ error: 'File not found.' });
      return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(bytes);
    }
    const raw = await downloadObject(jobId, name);
    if (!raw) return reply.code(404).send({ error: 'File not found.' });
    const ct = name.endsWith('.json') ? 'application/json' : name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/octet-stream';
    return reply.type(ct).header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(raw);
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
    const [stats, flags] = await Promise.all([
      getUserJobStats(req.auth!.appId, req.auth!.email),
      getUserFlags(req.auth!.appId, req.auth!.email),
    ]);
    return { ...stats, blocked: flags.blocked, blockedReason: flags.blockedReason ?? null };
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
    if (await publicLimit(req, reply, { route: 'plans', perIp: config.publicLimits.plansPerHourPerIp })) return reply;

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
  async (req) => {
    const appId = req.auth!.appId;
    if (!stripeConfigured()) return { plans: [] };
    return { plans: await listStripePlans(appId, reqLang(req)) };
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
        return reply.code(403).send({ error: flags.blockedReason ?? 'Your account is blocked.', code: 'account_blocked', reason: flags.blockedReason });
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
        reply.header('Retry-After', '3600');
        return reply.code(429).send({ error: 'Too many checkout attempts. Please try again later.', code: 'rate_limited' });
      }
    }

    // Catalog is entirely in Stripe: resolve by Price metadata appId + planId.
    const plan = await resolveStripePlan(appId, b.planId);
    if (!plan) return reply.code(404).send({ error: `Unknown plan "${b.planId}" for app "${appId}".` });
    if (!plan.credits || plan.credits <= 0) {
      return reply.code(400).send({ error: `Plan "${b.planId}" has no credits in its Stripe metadata.` });
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      success_url: b.successUrl,
      cancel_url: b.cancelUrl,
      client_reference_id: userId,
      allow_promotion_codes: true, // Stripe-managed coupons/promo codes
      line_items: [{ price: plan.priceId, quantity: 1 }],
      metadata: { appId, userId, planId: plan.planId, credits: String(plan.credits) },
    });
    return { url: session.url, sessionId: session.id, credits: plan.credits };
  },
);

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
    if (event.type.startsWith('product.') || event.type.startsWith('price.')) {
      const obj = event.data.object as { metadata?: Record<string, string> };
      const appId = obj.metadata?.appId;
      bustPublicCache(appId ? `plans:${appId}` : 'plans:');
      logEvent({ jobId: '-', appId: appId ?? '-', userId: '-' }, 'INFO', 'plans.cache_busted', { event: event.type });
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = (s.metadata ?? {}) as Record<string, string>;
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
        if (res.applied) {
          await recordPurchaseStats({ appId: m.appId, userId: m.userId, amountUsd, credits });
        }
        logEvent(
          { jobId: s.id, appId: m.appId, userId: m.userId },
          'INFO',
          'credits.purchased',
          { credits, plan: m.planId, applied: res.applied },
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
          appId: { type: 'string', maxLength: 128, pattern: '^[a-zA-Z0-9._-]+$', description: 'Optional slug doc id; a UUID is generated if omitted.' },
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
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'incomplete'] },
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
    if (job.status === 'queued' || job.status === 'running') {
      return reply.code(409).send({ error: `Job is already ${job.status}.` });
    }
    await requeueJob(jobId);
    const { enqueueJob } = await import('./enqueue.js');
    await enqueueJob(jobId, { unique: true });
    logEvent({ jobId, appId: job.appId, userId: job.userId }, 'INFO', 'job.retry', { by: req.auth!.email });
    return reply.code(202).send({ jobId, status: 'queued' });
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

// --- Admin: per-model credit pricing (Firestore overrides) ------------------
function pricingView(templateId: string, override: ModelPricing | null) {
  const base = toManifest(getTemplate(templateId)!); // code/template default credits + add-on catalog
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
    },
  },
  async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    if (!getTemplate(templateId)) return reply.code(404).send({ error: `Unknown model: ${templateId}` });
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
          modes: {
            type: 'object',
            additionalProperties: false,
            properties: {
              essential: { type: 'integer', minimum: 1, maximum: 1_000_000 },
              comprehensive: { type: 'integer', minimum: 1, maximum: 1_000_000 },
            },
          },
          addons: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 1_000_000 } },
        },
      },
    },
  },
  async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const tmpl = getTemplate(templateId);
    if (!tmpl) return reply.code(404).send({ error: `Unknown model: ${templateId}` });
    const body = (req.body ?? {}) as { modes?: Record<string, number>; addons?: Record<string, number> };
    // Add-on keys must exist in the model's catalog — the admin only prices them.
    const validAddons = new Set((tmpl.addons ?? []).map((a) => a.key));
    const addons = body.addons
      ? Object.fromEntries(Object.entries(body.addons).filter(([k]) => validAddons.has(k)))
      : undefined;
    await setModelPricing(templateId, { modes: body.modes as ModelPricing['modes'], addons });
    // Drop the cached manifest for this model so the user front picks up the new
    // mode costs (the admin itself already reads uncached).
    bustPublicCache(`manifest:${templateId}:`);
    logEvent({ jobId: '-', appId: 'admin', userId: req.auth!.email }, 'INFO', 'pricing.updated', { templateId, modes: body.modes, addons });
    return pricingView(templateId, await getModelPricing(templateId));
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
