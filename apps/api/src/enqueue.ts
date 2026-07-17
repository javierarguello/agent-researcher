/**
 * Enqueue a research job onto the Cloud Tasks queue. The queue (not this call)
 * bounds how many jobs run at once — it dispatches to the worker Cloud Run
 * Service with `maxConcurrentDispatches` = the global concurrency cap, and
 * retries with backoff on failure.
 *
 * The task carries an OIDC token minted as the invoker SA so the (authenticated)
 * worker service accepts it. The task name is the jobId → idempotent enqueue
 * (a duplicate request for the same job is a no-op).
 */
import { CloudTasksClient } from '@google-cloud/tasks';
import { config } from '@agent-researcher/core';

const client = new CloudTasksClient();

/**
 * @param opts.unique  Omit the deduped task name so the task always dispatches.
 *   Used for a manual retry: the original `jobId` task name is retained by Cloud
 *   Tasks for a while after completion, so reusing it would be a silent no-op.
 */
export async function enqueueJob(jobId: string, opts: { unique?: boolean } = {}): Promise<void> {
  if (!config.worker.serviceUrl) throw new Error('WORKER_SERVICE_URL is not configured.');
  if (!config.tasks.invokerServiceAccount) throw new Error('TASKS_INVOKER_SA is not configured.');

  const parent = client.queuePath(config.gcp.projectId, config.tasks.region, config.tasks.queue);
  const url = `${config.worker.serviceUrl}${config.worker.runPath}`;

  try {
    await client.createTask({
      parent,
      task: {
        // Deduped by jobId normally; a manual retry uses an auto-generated name.
        ...(opts.unique ? {} : { name: `${parent}/tasks/${jobId}` }),
        dispatchDeadline: { seconds: config.tasks.dispatchDeadlineSeconds },
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
          oidcToken: {
            serviceAccountEmail: config.tasks.invokerServiceAccount,
            audience: config.worker.serviceUrl,
          },
        },
      },
    });
  } catch (err) {
    // ALREADY_EXISTS (gRPC code 6) — the job is already queued; treat as success.
    if ((err as { code?: number }).code === 6) return;
    throw err;
  }
}

/**
 * Enqueue an on-demand PDF render for a completed job. Deduped by a `${jobId}-pdf`
 * task name so repeated download clicks don't spawn parallel renders (and the
 * retained task name after completion means the PDF isn't re-rendered).
 */
export async function enqueuePdf(jobId: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!config.worker.serviceUrl) throw new Error('WORKER_SERVICE_URL is not configured.');
  if (!config.tasks.invokerServiceAccount) throw new Error('TASKS_INVOKER_SA is not configured.');

  const parent = client.queuePath(config.gcp.projectId, config.tasks.region, config.tasks.queue);
  const url = `${config.worker.serviceUrl}${config.worker.pdfPath}`;

  try {
    await client.createTask({
      parent,
      task: {
        // Deduped by jobId normally; a forced re-render (design change) always
        // dispatches with an auto-generated name and overwrites report.pdf.
        ...(opts.force ? {} : { name: `${parent}/tasks/${jobId}-pdf` }),
        dispatchDeadline: { seconds: config.tasks.dispatchDeadlineSeconds },
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ jobId, force: !!opts.force })).toString('base64'),
          oidcToken: {
            serviceAccountEmail: config.tasks.invokerServiceAccount,
            audience: config.worker.serviceUrl,
          },
        },
      },
    });
  } catch (err) {
    // ALREADY_EXISTS (gRPC code 6) — a render is already queued/in flight; no-op.
    if ((err as { code?: number }).code === 6) return;
    throw err;
  }
}
