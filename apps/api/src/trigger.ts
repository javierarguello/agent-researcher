/**
 * Triggers a Cloud Run Job execution for one research job, passing JOB_ID as a
 * per-execution env override. Uses ADC (the API service account) — that SA needs
 * run.jobs.run and act-as on the worker's runtime service account.
 */
import { GoogleAuth } from 'google-auth-library';
import { config } from '@agent-researcher/core';

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

export async function triggerWorker(jobId: string): Promise<void> {
  const client = await auth.getClient();
  const url =
    `https://run.googleapis.com/v2/projects/${config.gcp.projectId}` +
    `/locations/${config.worker.jobRegion}/jobs/${config.worker.jobName}:run`;

  await client.request({
    url,
    method: 'POST',
    data: {
      overrides: {
        containerOverrides: [{ env: [{ name: 'JOB_ID', value: jobId }] }],
      },
    },
  });
}
