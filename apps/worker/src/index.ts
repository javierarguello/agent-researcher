/**
 * Cloud Run Job entrypoint. Runs exactly one research job to completion, then
 * exits. Scales to zero naturally: it only runs when the API triggers an
 * execution. Long-running by design (job task timeout up to 24h).
 *
 * Input: JOB_ID env var (set as a per-execution override by the API). The job
 * document (template + params) is read from Firestore.
 */
import { getJob, runJob } from '@agent-researcher/core';

async function main() {
  const jobId = process.env.JOB_ID?.trim();
  if (!jobId) {
    console.error('JOB_ID env var is required.');
    process.exit(1);
  }

  const job = await getJob(jobId);
  if (!job) {
    console.error(`Job ${jobId} not found in Firestore.`);
    process.exit(1);
  }

  console.log(`[worker] starting job ${jobId} (template=${job.template}, app=${job.appId})`);
  const result = await runJob({
    jobId,
    appId: job.appId,
    userId: job.userId,
    template: job.template,
    params: job.params,
  });
  console.log(
    `[worker] job ${jobId} completed: ${result.files.length} files, ` +
      `${result.sourcesFound} sources, ${result.reportBytes} report bytes`,
  );
}

main().catch((err) => {
  // Non-zero exit marks the Cloud Run Job execution as failed (and enables retry).
  // runJob has already recorded status=failed in Firestore.
  console.error('[worker] job failed:', err);
  process.exit(1);
});
