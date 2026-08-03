/**
 * Firestore-backed job store. One document per research job, keyed by jobId.
 */
import { FieldValue, Firestore, type Query } from '@google-cloud/firestore';
import { config } from '../config.js';
import type { Cost } from '../cost.js';
import type { JobFailureKind, JobFile, JobHold, JobProgress, JobStatus, JobSummary, ResearchJob } from './types.js';

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
  mode?: string;
  creditsSpent?: number;
  /** True when the caller claimed an in-flight slot for this job (see slots.ts). */
  slotHeld?: boolean;
}

export async function createJob(input: CreateJobInput): Promise<ResearchJob> {
  const now = nowIso();
  const job: ResearchJob = {
    jobId: input.jobId,
    appId: input.appId,
    userId: input.userId,
    template: input.template,
    params: input.params,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.creditsSpent != null ? { creditsSpent: input.creditsSpent } : {}),
    ...(input.slotHeld ? { slotHeld: true } : {}),
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

export interface UserJobStats { total: number; ready: number; inProgress: number; held: number; failed: number; }

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
  const [queued = 0, running = 0, completed = 0, failed = 0, incomplete = 0, held = 0] = await Promise.all(
    (['queued', 'running', 'completed', 'failed', 'incomplete', 'held'] as JobStatus[]).map(countOf),
  );
  return {
    total: queued + running + completed + failed + incomplete + held,
    ready: completed + incomplete,
    // `held` is NOT in flight. It is waiting on US, and the one-job-at-a-time cap
    // exists to bound concurrent spend — a parked job spends nothing. Counting it
    // would lock a buyer out of the product until an admin got around to it, which
    // is the shape of the bug E2 fixed.
    inProgress: queued + running,
    held,
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

/**
 * Claim the job for THIS dispatch, and say which one.
 *
 * Cloud Tasks is at-least-once, and `running` is deliberately not in the worker's
 * skip list — resume depends on that. So a duplicate delivery arriving while a
 * dispatch is still in flight starts a second engine on the same checkpoint, and
 * the two overwrite each other's saves last-writer-wins: the agents one of them
 * finished are simply lost, and re-run on the next dispatch.
 *
 * The token does not stop the second engine from running — bounding that needs a
 * heartbeat, and a lease without one strands a job whose worker died, which is the
 * failure this file has just spent a round removing. It stops the two from
 * corrupting each other's work, which is the half that costs the buyer.
 */
export async function markRunning(jobId: string, dispatchId?: string): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    // Never resurrect a job that ended. The worker reads the status before calling
    // in, but that read is two round-trips before this write — a duplicate delivery
    // slipping through that window turned `completed` back into `running`, re-ran
    // the whole research from zero after the checkpoint was deleted, booked a second
    // completed report, sent the ready email twice, and made the delivered report
    // undownloadable while it did.
    const status = (snap.data() as ResearchJob).status;
    if (status === 'completed' || status === 'failed' || status === 'held') return false;
    tx.set(ref, { status: 'running', startedAt: nowIso(), ...(dispatchId ? { dispatchId } : {}), updatedAt: nowIso() }, { merge: true });
    return true;
  });
}

/** Whether this dispatch is still the one the job belongs to. */
export async function isCurrentDispatch(jobId: string, dispatchId: string): Promise<boolean> {
  const snap = await collection().doc(jobId).get();
  if (!snap.exists) return false;
  const current = (snap.data() as ResearchJob & { dispatchId?: string }).dispatchId;
  // No token at all means nothing else has claimed it — an older job document, or a
  // path that predates this. Refusing there would break resume for no gain.
  return !current || current === dispatchId;
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

/**
 * Deliver the report — unless something already ended this job.
 *
 * Transactional, because a blind write here hands out a free report. If
 * `enqueueJob` throws AFTER Cloud Tasks accepted the task, the API refunds the
 * buyer and marks the job failed while the worker is already running it; the
 * worker then finished and overwrote `failed` with `completed`, and every download
 * route gates on that status. The buyer kept the refund and got the report.
 *
 * Returns false when the job was already resolved, so the caller can say so.
 */
/**
 * Whether a write from `dispatchId` still speaks for this job.
 *
 * The status checks alone are not enough, because every admin decision to RUN a
 * job produces `queued` — which is not terminal. A run that was parked and then
 * approved is still executing; when it reaches one of its own hold paths it flipped
 * the freshly-approved job back to `held` and the admin's decision evaporated
 * silently. The token is the only thing that distinguishes "the run that owns this
 * job" from "a run nobody stopped".
 *
 * Permissive when either side has no token: an older job document, an admin action,
 * or any path that predates this.
 */
function ownedByDispatch(job: { dispatchId?: string }, dispatchId: string | undefined): boolean {
  return !job.dispatchId || !dispatchId || job.dispatchId === dispatchId;
}

export async function markCompleted(jobId: string, files: JobFile[], dispatchId?: string): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (!ownedByDispatch(snap.data() as ResearchJob, dispatchId)) return false;
    const status = (snap.data() as ResearchJob).status;
    // `held` too: a parked job is resolved by a person, never by a straggler run.
    if (status === 'failed' || status === 'completed' || status === 'held') return false;
    tx.set(ref, { status: 'completed', files, finishedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return true;
  });
}

export async function markFailed(
  jobId: string,
  error: string,
  files?: JobFile[],
  failureKind?: JobFailureKind,
): Promise<void> {
  // Persist any diagnostic files (e.g. trace.json) even on failure.
  await patch(jobId, {
    status: 'failed', error, finishedAt: nowIso(),
    ...(files ? { files } : {}),
    ...(failureKind ? { failureKind } : {}),
  });
}

/**
 * Park a job for an admin decision. NOT terminal: no `finishedAt`, no refund, and
 * the checkpoint is deliberately left in storage — an approval resumes the work
 * rather than restarting it.
 */
export async function markHeld(jobId: string, hold: JobHold, files?: JobFile[], dispatchId?: string): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    // A run that no longer owns this job does not get to park it. Without this, a
    // straggler flipped an approved job (`queued`) straight back to `held` and the
    // approval's own dispatch then acked-skipped it.
    if (!ownedByDispatch(snap.data() as ResearchJob, dispatchId)) return false;
    // A job somebody already RESOLVED stays resolved. Blind, this write let a
    // straggler run flip `failed` back to `held` — overwriting the `hold` that
    // recorded the resolution, so `approve` (which assumes held implies never
    // refunded) re-dispatched it and the report was delivered with the refund kept.
    const status = (snap.data() as ResearchJob).status;
    // `held` too. Protecting only `completed`/`failed` left the admin's own record
    // rewritable: park a running job with a note and a real `spentUsd`, and the run
    // nobody stopped reaches one of its own hold paths and replaces the whole `hold`
    // — with `spentUsd: 0` from `parkAndRethrow`, so the job reads as having cost
    // nothing. Worse, `approveHold` grants `budgetOverride` only for
    // `budget_exceeded`, so a straggler flipping the reason to that turns an
    // ordinary approval into an uncapped run.
    //
    // `markCompleted` already said it, in this file: a parked job is resolved by a
    // person, never by a straggler run.
    if (status === 'completed' || status === 'failed' || status === 'held') return false;
    // `merge` deep-merges nested maps, so a new hold inherited `approvedBy` and
    // `approvedAt` from the one it replaced — a fresh hold that reads as already
    // approved. Clear them explicitly unless this hold carries its own.
    const replaced = {
      ...hold,
      ...(hold.approvedBy ? {} : { approvedBy: FieldValue.delete() }),
      ...(hold.approvedAt ? {} : { approvedAt: FieldValue.delete() }),
    };
    tx.set(ref, { status: 'held', hold: replaced, updatedAt: nowIso(), ...(files ? { files } : {}) }, { merge: true });
    return true;
  });
}

/**
 * Let a held job continue. Transactional and status-checked: two admins clicking
 * approve, or an approval racing the expiry sweep, must not both win — the loser
 * gets `false` and no second dispatch is enqueued.
 *
 * Approval clears the ceiling for THIS job only (`budgetOverride`). The retry
 * budget is reset the same way the manual retry does it, because a job resuming
 * from a checkpoint has its finished agents behind it and needs room for the rest.
 */
export async function approveHold(jobId: string, by: string): Promise<boolean> {
  const ref = collection().doc(jobId);
  const refundRef = firestore().collection(config.credits.ledgerCollection).doc(`refund_${jobId}`);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.exists ? (snap.data() as ResearchJob) : undefined;
    if (!job || job.status !== 'held') return false;
    // A refunded job is an UNPAID job, and approving it runs it. `requeueJob` has
    // said this since the free-report fix; `approveHold` never asked, and
    // `wasJobRefunded` was called from exactly one route in the codebase. Any
    // refunded job that ends up back in `held` — and several paths put one there —
    // was a free report one click away, with nothing on the admin list to show it.
    if ((await tx.get(refundRef)).exists) return false;
    // Uncap ONLY a job that was parked for money. Approving is the admin answering
    // "is this worth finishing?" — for a transient failure or an upload that could
    // not complete, that is not also an answer to "may it spend without limit?",
    // and the ceiling is the only thing bounding 3 attempts × 8 dispatches.
    const uncap = job.hold?.reason === 'budget_exceeded';
    tx.set(
      ref,
      {
        status: 'queued',
        attempts: 0,
        ...(uncap ? { budgetOverride: true } : {}),
        hold: { ...job.hold, approvedBy: by, approvedAt: nowIso() },
        error: FieldValue.delete(),
        finishedAt: FieldValue.delete(),
        // …and the progress line, which said "Paused while we review it. Nothing
        // more is being spent" — to a buyer watching an approved job run, for the
        // whole queue wait, under a live spinner. `error` and `finishedAt` were
        // cleared and this was not.
        progress: FieldValue.delete(),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return true;
  });
}

/**
 * Park a job that is queued or running, so a stuck one can be decided on.
 *
 * The queue gives up on its own schedule (`--max-retry-duration`), and a job whose
 * dispatches are slow can exhaust that window before the engine's own finalize
 * pass. The worker returned a retryable status, the queue dropped the task, and
 * nothing ever touched the job again: `running` forever, the buyer's slot held, the
 * credits spent, and `retry` refusing because the job looks alive. It was the one
 * path that ended without a decision — which is the thing the hold exists to
 * prevent. This is the way back in.
 *
 * Safe against a job that IS still running: `markCompleted` refuses to deliver a
 * job something else already resolved.
 */
export async function parkJob(jobId: string, hold: JobHold): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.exists ? (snap.data() as ResearchJob) : undefined;
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return false;
    tx.set(ref, { status: 'held', hold, updatedAt: nowIso() }, { merge: true });
    return true;
  });
}

/**
 * Resolve a held job as failed (an admin rejected it, or the hold expired).
 * Transactional for the same reason as `approveHold` — the caller refunds only
 * when this returns true, so a lost race cannot refund twice.
 */
export async function rejectHold(
  jobId: string,
  error: string,
  decision?: { outcome: 'refund' | 'dismiss'; by: string },
): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.exists ? (snap.data() as ResearchJob) : undefined;
    if (!job || job.status !== 'held') return false;
    tx.set(
      ref,
      {
        status: 'failed',
        error,
        failureKind: job.hold?.reason,
        // The DECISION, recorded in the same transaction that acts on it. Without
        // it a dismissed job is indistinguishable from one whose refund failed —
        // both are `failed` and unrefunded — and "finish the interrupted refund"
        // silently becomes "overrule the admin who dismissed it".
        ...(decision
          ? { hold: { ...(job.hold ?? {}), resolvedOutcome: decision.outcome, resolvedBy: decision.by, resolvedAt: nowIso() } }
          : {}),
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return true;
  });
}

/**
 * Rewrite the buyer-facing note on a job that is already resolved.
 *
 * Used for one thing: saying that the credits came back, once they actually have.
 * `rejectHold` writes the neutral note before the refund runs, because the flip is
 * what stops two admins moving money at the same time — so the sentence that makes
 * a promise can only be written afterwards, by whoever kept it.
 *
 * Status-checked like every other terminal write: a job that is not `failed` is
 * not one this has anything to say about.
 */
export async function noteJobResolution(jobId: string, error: string): Promise<boolean> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const job = snap.exists ? (snap.data() as ResearchJob) : undefined;
    if (!job || job.status !== 'failed') return false;
    tx.set(ref, { error, updatedAt: nowIso() }, { merge: true });
    return true;
  });
}

export function setJobStatus(jobId: string, status: JobStatus): Promise<void> {
  return patch(jobId, { status });
}

/**
 * Append files to a completed job WITHOUT touching status/finishedAt — used for
 * artifacts generated after the fact (e.g. an on-demand report.pdf). Transactional
 * and idempotent: a file whose name already exists is not duplicated, so a repeated
 * render is a no-op.
 */
export async function addJobFiles(jobId: string, files: JobFile[]): Promise<ResearchJob | undefined> {
  const ref = collection().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return undefined;
    const job = snap.data() as ResearchJob;
    const existing = job.files ?? [];
    const merged = [...existing];
    for (const f of files) {
      const at = merged.findIndex((e) => e.name === f.name);
      if (at >= 0) merged[at] = f;
      else merged.push(f);
    }
    tx.set(ref, { files: merged, updatedAt: nowIso() }, { merge: true });
    return { ...job, files: merged };
  });
}

/**
 * Reset a terminal job for a manual retry: back to `queued`, attempt count
 * cleared (fresh retry budget), and the prior error/finish time removed. The
 * caller re-enqueues it. Credits are NOT re-charged (consumption is idempotent
 * by jobId).
 */
/**
 * Put a job back in the queue. Transactional and precondition-checked, because the
 * caller's own status read happened in an earlier request: without this, a
 * `resolve{refund}` committing in between leaves a refunded job queued and unpaid.
 *
 * Returns false when a precondition no longer holds, so the caller can refuse
 * rather than enqueue.
 */
export async function requeueJob(
  jobId: string,
  opts: { onlyIfStatus?: JobStatus; refuseIfRefunded?: boolean } = {},
): Promise<boolean> {
  const ref = collection().doc(jobId);
  const refundRef = firestore().collection(config.credits.ledgerCollection).doc(`refund_${jobId}`);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (opts.onlyIfStatus && (snap.data() as ResearchJob).status !== opts.onlyIfStatus) return false;
    if (opts.refuseIfRefunded && (await tx.get(refundRef)).exists) return false;
    tx.set(
      ref,
      { status: 'queued', attempts: 0, error: FieldValue.delete(), finishedAt: FieldValue.delete(), updatedAt: nowIso() },
      { merge: true },
    );
    return true;
  });
}
