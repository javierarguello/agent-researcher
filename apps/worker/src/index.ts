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

const app = Fastify({ logger: { level: config.server.logLevel } });

app.get('/health', async () => ({ ok: true }));

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
