/**
 * Worker — a Cloud Run Service (scale-to-0) that runs ONE research job per HTTP
 * request and returns when it finishes. Cloud Tasks pushes jobs here with a
 * bounded `maxConcurrentDispatches`, so the queue's concurrency == the number of
 * jobs running at once (the real global throttle for Vertex quota). Retries and
 * backpressure come from the queue.
 *
 * The request is authenticated at the platform level (Cloud Run
 * `--no-allow-unauthenticated` + the queue's OIDC token), so no app-level auth.
 * Concurrency per instance is 1 (deploy `--concurrency=1`); Cloud Run scales
 * instances up to the queue's cap.
 */
import Fastify from 'fastify';
import { config, getJob, runJob } from '@agent-researcher/core';
import { renderJobPdf } from './pdf.js';

const app = Fastify({ logger: { level: config.server.logLevel } });

app.get('/health', async () => ({ ok: true }));

// On-demand PDF: the API enqueues this the first time a user downloads the report
// PDF. Renders `report.pdf` (idempotent — a second request for an existing PDF is a
// no-op) and appends it to the job's files so the API can serve it like any file.
app.post('/render-pdf', async (req, reply) => {
  const body = (req.body ?? {}) as { jobId?: string; force?: boolean };
  const jobId = body.jobId?.trim();
  if (!jobId) return reply.code(400).send({ error: 'Missing jobId.' }); // 4xx = no retry

  const job = await getJob(jobId);
  if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` });
  if (job.status !== 'completed') return reply.code(409).send({ error: `Report not ready (status: ${job.status}).` }); // no retry

  try {
    const file = await renderJobPdf(job, { force: !!body.force });
    app.log.info({ jobId, size: file.size }, 'worker: pdf ready');
    return reply.code(200).send({ status: 'ready', name: file.name });
  } catch (err) {
    // Retryable — Cloud Tasks re-dispatches with backoff (transient Chromium/GCS error).
    app.log.error({ err, jobId }, 'worker: pdf render failed');
    return reply.code(503).send({ error: (err as Error).message });
  }
});

app.post('/run', async (req, reply) => {
  const body = (req.body ?? {}) as { jobId?: string };
  const jobId = body.jobId?.trim();
  if (!jobId) return reply.code(400).send({ error: 'Missing jobId.' }); // 4xx = no retry

  const job = await getJob(jobId);
  if (!job) return reply.code(404).send({ error: `Unknown job: ${jobId}` }); // permanent

  // Idempotency: Cloud Tasks is at-least-once. A finished job is acked, not re-run.
  if (job.status === 'completed' || job.status === 'failed') {
    return reply.code(200).send({ status: job.status, skipped: true });
  }

  app.log.info({ jobId, template: job.template, appId: job.appId }, 'worker: starting job');
  try {
    const result = await runJob({
      jobId,
      appId: job.appId,
      userId: job.userId,
      template: job.template,
      params: job.params,
    });
    // 'incomplete' → some steps still failing; return a RETRYABLE status so Cloud
    // Tasks re-dispatches with backoff and runJob resumes from its checkpoint.
    if (result.status === 'incomplete') {
      return reply.code(503).send({ status: 'incomplete' });
    }
    // Ack (200) on completed/failed — runJob already recorded the outcome. Retrying
    // a finished job would just burn tokens.
    return reply.code(200).send({ status: result.status, sourcesFound: result.sourcesFound });
  } catch (err) {
    // Unexpected engine error — runJob marked the job failed. Ack to avoid re-runs.
    app.log.error({ err, jobId }, 'worker: job errored');
    return reply.code(200).send({ status: 'failed', error: (err as Error).message });
  }
});

const start = async () => {
  try {
    await app.listen({ host: '0.0.0.0', port: config.server.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
