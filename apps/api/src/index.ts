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
  listTemplates,
  getTemplate,
  logEvent,
  signJobFiles,
  toManifest,
  toPublicApp,
  updateApp,
  updateSettings,
  validateRequest,
  type RateLimitEntry,
} from '@agent-researcher/core';
import { apiKeyAuth, requireAdmin } from './auth.js';

const app = Fastify({ logger: { level: config.server.logLevel } });

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
      { name: 'research', description: 'Create and poll research jobs' },
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

// --- Admin (backoffice) -----------------------------------------------------
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
