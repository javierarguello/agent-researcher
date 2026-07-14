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
  createJob,
  getJob,
  getSettings,
  listApps,
  listJobs,
  queryJobs,
  getAdminStats,
  queryUsers,
  listTemplates,
  getTemplate,
  logEvent,
  signJobFiles,
  toManifest,
  toPublicApp,
  updateApp,
  updateSettings,
  validateRequest,
  resolveMode,
  creditsForMode,
  consumeCredits,
  getBalance,
  listTransactions,
  grantCredits,
  recordPurchase,
  recordPurchaseStats,
  signSession,
  verifyGoogleIdToken,
  InsufficientCreditsError,
  type RateLimitEntry,
  type LedgerEntryType,
  type JobStatus,
} from '@agent-researcher/core';
import type Stripe from 'stripe';
import { jwtAuth, requireAdmin } from './auth.js';
import { stripe, stripeConfigured, listStripePlans, resolveStripePlan } from './stripe.js';

const app = Fastify({ logger: { level: config.server.logLevel } });

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
      description:
        'Deep-research API. Submit a research request against a template ("model"); poll the job; ' +
        'download the generated Markdown report + executive summary via signed URLs.',
      version: '0.1.0',
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'auth', description: 'Login: exchange a provider identity for a session token' },
      { name: 'templates', description: 'Supported research templates ("models")' },
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
      summary: 'Log in / sign up: verify a provider identity, return a session JWT',
      description:
        "Send { appId, provider, ...credentials }. provider='google' takes an `idToken`. " +
        'Regular apps allow any Google account; the admin app only its whitelisted emails.',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['appId', 'provider'],
        properties: {
          appId: { type: 'string' },
          provider: { type: 'string', enum: ['google', 'password'] },
          idToken: { type: 'string', description: "Google id_token (provider='google')." },
        },
      },
    },
  },
  async (req, reply) => {
    const b = req.body as { appId?: string; provider?: string; idToken?: string };
    if (!b.appId || !b.provider) return reply.code(400).send({ error: 'appId and provider are required.' });

    const appRec = await getApp(b.appId);
    if (!appRec || !appRec.active) return reply.code(404).send({ error: `Unknown or inactive app: ${b.appId}` });

    // Verify identity (dispatch on provider — add 'password' etc. here later).
    let identity;
    if (b.provider === 'google') {
      if (!appRec.googleClientId) return reply.code(400).send({ error: 'App has no googleClientId configured.' });
      if (!b.idToken) return reply.code(400).send({ error: 'idToken is required for provider "google".' });
      try {
        identity = await verifyGoogleIdToken(b.idToken, appRec.googleClientId);
      } catch (err) {
        return reply.code(401).send({ error: `Google verification failed: ${(err as Error).message}` });
      }
    } else {
      return reply.code(501).send({ error: `Auth provider "${b.provider}" is not enabled yet.` });
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
    logEvent({ jobId: '-', appId: appRec.appId, userId: identity.email }, 'INFO', 'auth.login', { provider: b.provider, role });
    return {
      token,
      user: { email: identity.email, name: identity.name ?? null, role, appId: appRec.appId },
      expiresInSeconds: config.auth.jwtTtlSeconds,
    };
  },
);

// --- Templates --------------------------------------------------------------
app.get(
  '/templates',
  { schema: { summary: 'List supported research templates', tags: ['templates'], security: sec } },
  async () => ({ templates: listTemplates().map(toManifest) }),
);

app.get(
  '/templates/:id',
  {
    schema: {
      summary: 'Get one template + its JSON-Schema params',
      tags: ['templates'],
      security: sec,
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getTemplate(id);
    if (!t) return reply.code(404).send({ error: `Unknown template: ${id}` });
    return toManifest(t);
  },
);

// --- Research ---------------------------------------------------------------
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
      body: {
        type: 'object',
        required: ['template'],
        properties: {
          template: { type: 'string', description: 'Template id, e.g. "florida-business-for-sale".' },
          params: { type: 'object', additionalProperties: true, description: 'Template-specific params.' },
        },
      },
    },
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

    // Rate limits (reports per hour) — per app and per user. Skipped in local dev.
    if (config.server.appEnv !== 'local') {
      const settings = await getSettings();
      const appLimit = req.appRecord?.rateLimitPerHour ?? settings.appRateLimitPerHour;
      const entries: RateLimitEntry[] = [
        { key: `app:${appId}`, limit: appLimit, scope: 'app' },
        { key: `user:${userId}`, limit: settings.userRateLimitPerHour, scope: 'user' },
      ];
      const rl = await checkRateLimits(entries);
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

    // Credits gate: consume the mode's credit cost up front (refunded if the job fails).
    if (config.server.appEnv !== 'local') {
      const tmpl = getTemplate(validated.template);
      const mode = resolveMode(tmpl?.modes, (validated.params as Record<string, unknown>).mode);
      const cost = creditsForMode(mode.config, mode.key);
      try {
        await consumeCredits(appId, userId, cost, jobId);
        logEvent(logCtx, 'INFO', 'credits.consumed', { credits: cost, mode: mode.key });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return reply.code(402).send({ error: 'Insufficient credits.', required: err.required, balance: err.balance });
        }
        throw err;
      }
    }

    await createJob({ jobId, appId, userId, template: validated.template, params: validated.params });
    logEvent(logCtx, 'INFO', 'job.created', { params: validated.params });

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
        properties: {
          userId: { type: 'string', description: 'Admin only: list another user (defaults to the token user).' },
          appId: { type: 'string', description: 'Admin only: another app (defaults to the token app).' },
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
        cost: j.cost ?? null,
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
      params: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    },
  },
  async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await getJob(jobId);
    if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });

    // Admins can read any job; a regular user only their own (same app + email).
    if (req.auth!.role !== 'admin' && (job.appId !== req.auth!.appId || job.userId !== req.auth!.email)) {
      return reply.code(403).send({ error: 'Forbidden: not your report.' });
    }

    const base = {
      jobId: job.jobId,
      appId: job.appId,
      userId: job.userId,
      template: job.template,
      title: job.title ?? null,
      shortDescription: job.shortDescription ?? null,
      status: job.status,
      progress: job.progress ?? null,
      cost: job.cost ?? null,
      summary: job.summary ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error ?? null,
    };

    if (job.status !== 'completed') return base;

    const files = await signJobFiles(job.files);
    return {
      ...base,
      finishedAt: job.finishedAt ?? null,
      bucketPath: job.bucketPath,
      files: files.map((f) => ({
        name: f.name,
        contentType: f.contentType,
        size: f.size ?? null,
        url: f.url,
        expiresAt: f.expiresAt,
      })),
    };
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
        properties: { userId: { type: 'string' }, appId: { type: 'string' } },
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
        properties: {
          userId: { type: 'string' },
          appId: { type: 'string' },
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
  '/credits/plans',
  { schema: { summary: 'List the purchasable credit packs for this app', tags: ['credits'], security: sec } },
  async (req) => {
    const appId = req.auth!.appId;
    if (!stripeConfigured()) return { plans: [] };
    return { plans: await listStripePlans(appId) };
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
        properties: {
          planId: { type: 'string' },
          successUrl: { type: 'string' },
          cancelUrl: { type: 'string' },
        },
      },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const b = req.body as { planId: string; successUrl: string; cancelUrl: string };
    const appId = req.auth!.appId;
    const userId = req.auth!.email;

    // Catalog is entirely in Stripe: resolve by lookup_key `<appId>_<planId>`.
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
        properties: {
          appId: { type: 'string' },
          userId: { type: 'string' },
          credits: { type: 'integer', minimum: 1 },
          reason: { type: 'string', minLength: 1, description: 'Why the credits were granted (audit).' },
          idempotencyKey: { type: 'string', description: 'Optional: dedupes retries/double-clicks.' },
          note: { type: 'string' },
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
        properties: {
          appRateLimitPerHour: { type: ['integer', 'null'], minimum: 1 },
          userRateLimitPerHour: { type: ['integer', 'null'], minimum: 1 },
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
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'app'] },
          appId: { type: 'string', description: 'Optional slug doc id; a UUID is generated if omitted.' },
          rateLimitPerHour: { type: 'integer', minimum: 1, description: 'Optional reports/hour cap.' },
          allowedTemplates: { type: 'array', items: { type: 'string' }, description: 'If set, the only models this app may run (admin apps are exempt).' },
          googleClientId: { type: 'string' },
          adminEmails: { type: 'array', items: { type: 'string' } },
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
      params: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          active: { type: 'boolean' },
          rateLimitPerHour: { type: ['integer', 'null'], minimum: 1, description: 'null clears the limit.' },
          allowedTemplates: { type: 'array', items: { type: 'string' }, description: 'Models this app may run (admin apps exempt).' },
          googleClientId: { type: 'string' },
          adminEmails: { type: 'array', items: { type: 'string' } },
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
      params: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] },
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
        properties: {
          appId: { type: 'string', description: 'Filter to one app.' },
          q: { type: 'string', description: 'Email/userId prefix match.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  },
  async (req) => {
    const { appId, q, limit } = req.query as { appId?: string; q?: string; limit?: number };
    return { users: await queryUsers({ appId, emailPrefix: q, limit: limit ?? 50 }) };
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
        properties: {
          appId: { type: 'string' },
          userId: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'incomplete'] },
          template: { type: 'string' },
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
