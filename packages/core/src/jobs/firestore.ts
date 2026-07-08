/**
 * Firestore-backed job store. One document per research job, keyed by jobId.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import type { Cost } from '../cost.js';
import type { JobFile, JobProgress, JobStatus, JobSummary, ResearchJob } from './types.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}

function collection() {
  return firestore().collection(config.jobs.collection);
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateJobInput {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  params: Record<string, unknown>;
}

export async function createJob(input: CreateJobInput): Promise<ResearchJob> {
  const now = nowIso();
  const job: ResearchJob = {
    jobId: input.jobId,
    appId: input.appId,
    userId: input.userId,
    template: input.template,
    params: input.params,
    status: 'queued',
    files: [],
    bucketPath: `${config.storage.rootPrefix}/${input.jobId}`,
    createdAt: now,
    updatedAt: now,
  };
  await collection().doc(input.jobId).set(job);
  return job;
}

export async function getJob(jobId: string): Promise<ResearchJob | undefined> {
  const snap = await collection().doc(jobId).get();
  return snap.exists ? (snap.data() as ResearchJob) : undefined;
}

/** List an app's jobs for one user, newest first (for the report inbox).
 *  Requires a composite index on (appId, userId, createdAt desc). */
export async function listJobs(appId: string, userId: string, limit = 50): Promise<ResearchJob[]> {
  const snap = await collection()
    .where('appId', '==', appId)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as ResearchJob);
}

async function patch(jobId: string, data: Partial<ResearchJob>): Promise<void> {
  await collection().doc(jobId).set({ ...data, updatedAt: nowIso() }, { merge: true });
}

export async function markRunning(jobId: string): Promise<void> {
  await patch(jobId, { status: 'running', startedAt: nowIso() });
}

export async function setProgress(jobId: string, progress: JobProgress): Promise<void> {
  await patch(jobId, { progress });
}

/** Store the running total cost on the job doc (updated as agents finish). */
export async function setJobCost(jobId: string, cost: Cost): Promise<void> {
  await patch(jobId, { cost });
}

/** Store the denormalized summary (metrics + errors) on the job doc. */
export async function setJobSummary(jobId: string, summary: JobSummary): Promise<void> {
  await patch(jobId, { summary });
}

/** Store the auto-generated title + short description (for dashboards). */
export async function setJobHeadline(jobId: string, headline: { title: string; shortDescription: string }): Promise<void> {
  await patch(jobId, { title: headline.title, shortDescription: headline.shortDescription });
}

export async function markCompleted(jobId: string, files: JobFile[]): Promise<void> {
  await patch(jobId, { status: 'completed', files, finishedAt: nowIso() });
}

export async function markFailed(jobId: string, error: string, files?: JobFile[]): Promise<void> {
  // Persist any diagnostic files (e.g. trace.json) even on failure.
  await patch(jobId, { status: 'failed', error, finishedAt: nowIso(), ...(files ? { files } : {}) });
}

export function setJobStatus(jobId: string, status: JobStatus): Promise<void> {
  return patch(jobId, { status });
}
