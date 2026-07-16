/**
 * Firestore-backed job store. One document per research job, keyed by jobId.
 */
import { FieldValue, Firestore, type Query } from '@google-cloud/firestore';
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

export interface UserJobStats { total: number; ready: number; inProgress: number; failed: number; }

/**
 * Per-user report counters by status, computed with Firestore `count()`
 * aggregations (no documents are read back). This is the source for the user
 * dashboard's stat tiles — accurate over ALL of the user's jobs, not a tally of
 * the (paginated) inbox list. Equality-only filters need only single-field
 * indexes, so no composite index is required.
 */
export async function getUserJobStats(appId: string, userId: string): Promise<UserJobStats> {
  const base = () => collection().where('appId', '==', appId).where('userId', '==', userId);
  const countOf = async (status: JobStatus) => (await base().where('status', '==', status).count().get()).data().count;
  const [queued = 0, running = 0, completed = 0, failed = 0, incomplete = 0] = await Promise.all(
    (['queued', 'running', 'completed', 'failed', 'incomplete'] as JobStatus[]).map(countOf),
  );
  return {
    total: queued + running + completed + failed + incomplete,
    ready: completed + incomplete,
    inProgress: queued + running,
    failed,
  };
}

/**
 * Admin cross-app job query: any combination of appId/userId/status/template,
 * newest first. Each filter combination needs a composite index in prod
 * (e.g. (appId, createdAt desc), (status, createdAt desc), …).
 */
export async function queryJobs(opts: {
  appId?: string;
  userId?: string;
  status?: JobStatus;
  template?: string;
  limit?: number;
} = {}): Promise<ResearchJob[]> {
  let q: Query = collection();
  if (opts.appId) q = q.where('appId', '==', opts.appId);
  if (opts.userId) q = q.where('userId', '==', opts.userId);
  if (opts.status) q = q.where('status', '==', opts.status);
  if (opts.template) q = q.where('template', '==', opts.template);
  const snap = await q.orderBy('createdAt', 'desc').limit(opts.limit ?? 50).get();
  return snap.docs.map((d) => d.data() as ResearchJob);
}

async function patch(jobId: string, data: Partial<ResearchJob>): Promise<void> {
  await collection().doc(jobId).set({ ...data, updatedAt: nowIso() }, { merge: true });
}

export async function markRunning(jobId: string): Promise<void> {
  await patch(jobId, { status: 'running', startedAt: nowIso() });
}

/** Record the dispatch/attempt count on the job (resumable retries). */
export async function setJobAttempts(jobId: string, attempts: number): Promise<void> {
  await patch(jobId, { attempts });
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

/**
 * Reset a terminal job for a manual retry: back to `queued`, attempt count
 * cleared (fresh retry budget), and the prior error/finish time removed. The
 * caller re-enqueues it. Credits are NOT re-charged (consumption is idempotent
 * by jobId).
 */
export async function requeueJob(jobId: string): Promise<void> {
  await collection()
    .doc(jobId)
    .set(
      { status: 'queued', attempts: 0, error: FieldValue.delete(), finishedAt: FieldValue.delete(), updatedAt: nowIso() },
      { merge: true },
    );
}
