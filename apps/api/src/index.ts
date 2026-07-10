/**
 * agent-researcher API (Cloud Run Service, scale-to-0).
 *
 * Lightweight: validates requests, records jobs in Firestore, and triggers the
 * long-running worker (a Cloud Run Job). It never runs research inline, so
 * requests return in milliseconds and the service can scale to zero.
 *
 * Auth: API key resolved against the Firestore `apps` registry (x-api-key or
 * Bearer). Admin-role keys can manage apps (backoffice). Docs: Swagger at /docs.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  config,
  createApp,
  checkRateLimits,
  createJob,
  getJob,
  getSettings,
  listApps,
  listJobs,
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
  InsufficientCreditsError,
  type RateLimitEntry,
} from '@agent-researcher/core';
import type Stripe from 'stripe';
import { apiKeyAuth, requireAdmin } from './auth.js';
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
    components: { securitySchemes: { apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' } } },
    security: [{ apiKey: [] }],
    tags: [
      { name: 'templates', description: 'Supported research templates ("models")' },
      { name: 'research', description: 'Create, list, and poll research jobs' },
      { name: 'credits', description: 'Credit balance + ledger (shared billing)' },
      { name: 'admin', description: 'App management (admin key required)' },
    ],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs' });

// --- Auth (after swagger so /docs stays public) -----------------------------
app.addHook('onRequest', apiKeyAuth);

const sec = [{ apiKey: [] }];

// --- Health -----------------------------------------------------------------
app.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));

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
        required: ['appId', 'userId', 'template'],
        properties: {
          appId: { type: 'string', description: 'Calling app id (must match the API key).', maxLength: 128 },
          userId: { type: 'string', description: 'Calling user — a UUID or an email.', maxLength: 320 },
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

    // In production the app is resolved from the API key; the body appId must match it.
    const appRecord = req.appRecord;
    if (appRecord && validated.appId !== appRecord.appId) {
      return reply.code(403).send({ error: 'Forbidden: appId does not match the API key.' });
    }

    // Rate limits (reports per hour) — per app and per user. Defaults come from
    // the general settings; an app may override its own cap. Skipped in local dev.
    if (config.server.appEnv !== 'local') {
      const settings = await getSettings();
      const appLimit = appRecord?.rateLimitPerHour ?? settings.appRateLimitPerHour;
      const entries: RateLimitEntry[] = [
        { key: `app:${validated.appId}`, limit: appLimit, scope: 'app' },
        { key: `user:${validated.userId}`, limit: settings.userRateLimitPerHour, scope: 'user' },
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
    const logCtx = { jobId, appId: validated.appId, userId: validated.userId, template: validated.template };

    // Credits gate: consume the mode's credit cost up front (refunded if the job fails).
    if (config.server.appEnv !== 'local') {
      const tmpl = getTemplate(validated.template);
      const mode = resolveMode(tmpl?.modes, (validated.params as Record<string, unknown>).mode);
      const cost = creditsForMode(mode.config, mode.key);
      try {
        await consumeCredits(validated.appId, validated.userId, cost, jobId);
        logEvent(logCtx, 'INFO', 'credits.consumed', { credits: cost, mode: mode.key });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return reply.code(402).send({ error: 'Insufficient credits.', required: err.required, balance: err.balance });
        }
        throw err;
      }
    }

    await createJob({
      jobId,
      appId: validated.appId,
      userId: validated.userId,
      template: validated.template,
      params: validated.params,
    });
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
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
          appId: { type: 'string', description: 'Only needed when auth is off (local dev).' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
  },
  async (req, reply) => {
    const q = req.query as { userId?: string; appId?: string; limit?: number };
    const appId = req.appRecord?.appId ?? q.appId;
    if (!appId || !q.userId) return reply.code(400).send({ error: 'appId and userId are required.' });
    const jobs = await listJobs(appId, q.userId, q.limit ?? 50);
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

    // A non-admin app may only read its own jobs.
    if (req.appRecord && req.appRecord.role !== 'admin' && job.appId !== req.appRecord.appId) {
      return reply.code(403).send({ error: 'Forbidden: job belongs to another app.' });
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
      summary: "Get a user's credit balance",
      tags: ['credits'],
      security: sec,
      querystring: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' }, appId: { type: 'string' } },
      },
    },
  },
  async (req, reply) => {
    const q = req.query as { userId?: string; appId?: string };
    const appId = req.appRecord?.appId ?? q.appId;
    if (!appId || !q.userId) return reply.code(400).send({ error: 'appId and userId are required.' });
    return { appId, userId: q.userId, balance: await getBalance(appId, q.userId) };
  },
);

app.get(
  '/credits/transactions',
  {
    schema: {
      summary: "Get a user's credit ledger (purchases + consumption)",
      tags: ['credits'],
      security: sec,
      querystring: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
          appId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  },
  async (req, reply) => {
    const q = req.query as { userId?: string; appId?: string; limit?: number };
    const appId = req.appRecord?.appId ?? q.appId;
    if (!appId || !q.userId) return reply.code(400).send({ error: 'appId and userId are required.' });
    return { transactions: await listTransactions(appId, q.userId, q.limit ?? 50) };
  },
);

app.get(
  '/credits/plans',
  { schema: { summary: 'List the purchasable credit packs for this app', tags: ['credits'], security: sec } },
  async (req, reply) => {
    const appId = req.appRecord?.appId ?? (req.query as { appId?: string }).appId;
    if (!appId) return reply.code(400).send({ error: 'appId is required.' });
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
        required: ['planId', 'userId', 'successUrl', 'cancelUrl'],
        properties: {
          planId: { type: 'string' },
          userId: { type: 'string' },
          successUrl: { type: 'string' },
          cancelUrl: { type: 'string' },
          appId: { type: 'string' },
        },
      },
    },
  },
  async (req, reply) => {
    if (!stripeConfigured()) return reply.code(503).send({ error: 'Billing is not configured.' });
    const b = req.body as { planId: string; userId: string; successUrl: string; cancelUrl: string; appId?: string };
    const appId = req.appRecord?.appId ?? b.appId;
    if (!appId) return reply.code(400).send({ error: 'appId is required.' });

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
      client_reference_id: b.userId,
      allow_promotion_codes: true, // Stripe-managed coupons/promo codes
      line_items: [{ price: plan.priceId, quantity: 1 }],
      metadata: { appId, userId: b.userId, planId: plan.planId, credits: String(plan.credits) },
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
      tags: ['admin'],
      security: sec,
      body: {
        type: 'object',
        required: ['appId', 'userId', 'credits'],
        properties: {
          appId: { type: 'string' },
          userId: { type: 'string' },
          credits: { type: 'integer', minimum: 1 },
          note: { type: 'string' },
        },
      },
    },
  },
  async (req) => {
    const b = req.body as { appId: string; userId: string; credits: number; note?: string };
    await grantCredits(b);
    return { granted: b.credits, balance: await getBalance(b.appId, b.userId) };
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
          appId: { type: 'string', description: 'Optional; a UUID is generated if omitted.' },
          rateLimitPerHour: { type: 'integer', minimum: 1, description: 'Optional reports/hour cap.' },
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
    };
    if (!body.name) return reply.code(400).send({ error: 'Missing "name".' });
    const created = await createApp({
      name: body.name,
      role: body.role ?? 'app',
      appId: body.appId,
      rateLimitPerHour: body.rateLimitPerHour,
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
        },
      },
    },
  },
  async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const body = (req.body ?? {}) as { name?: string; active?: boolean; rateLimitPerHour?: number | null };
    const updated = await updateApp(appId, body);
    if (!updated) return reply.code(404).send({ error: `Unknown app: ${appId}` });
    return { app: toPublicApp(updated) };
  },
);

// --- Start ------------------------------------------------------------------
const start = async () => {
  try {
    if (config.server.appEnv === 'local') {
      app.log.warn('APP_ENV=local — API-key auth is DISABLED.');
    }
    await app.listen({ host: '0.0.0.0', port: config.server.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
