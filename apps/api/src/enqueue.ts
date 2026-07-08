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

export async function enqueueJob(jobId: string): Promise<void> {
  if (!config.worker.serviceUrl) throw new Error('WORKER_SERVICE_URL is not configured.');
  if (!config.tasks.invokerServiceAccount) throw new Error('TASKS_INVOKER_SA is not configured.');

  const parent = client.queuePath(config.gcp.projectId, config.tasks.region, config.tasks.queue);
  const url = `${config.worker.serviceUrl}${config.worker.runPath}`;

  try {
    await client.createTask({
      parent,
      task: {
        name: `${parent}/tasks/${jobId}`, // dedup by jobId
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
