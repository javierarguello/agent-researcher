/**
 * The one-report-at-a-time cap, as a claim rather than a look (C6/C7).
 *
 * It used to be a plain `count()` of the user's queued/running jobs, read at the
 * top of `POST /research` — and the job document that would make the count go up
 * is not written until the very end of the handler, after the balance read, after
 * a moderation model call, after the rate-limit transaction. Between the look and
 * the write there is a network round trip to a model, so requests arriving a
 * second apart all read zero and all pass. The cap was advisory, and the spend
 * model that rested on it ("bounded by 1 in flight and 20/hour") was only half
 * true.
 *
 * So the slot is now taken, not observed: one transaction on one document per
 * (app, user), which serializes against every other claim for that same user.
 * Claiming it BEFORE the moderation call is also what stops a burst from each
 * paying for a billed classifier call on the way to a 409 (C7).
 *
 * The hard part is not the claim, it is the release. A slot that leaks locks a
 * buyer out of the product permanently, which is exactly the bug E2 fixed — so
 * every release goes through the job document (`slotHeld`) inside a transaction,
 * making it exactly-once no matter how many times, or from how many places, it is
 * called.
 */
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import type { ResearchJob } from './types.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}

const slots = () => firestore().collection(config.jobs.slotsCollection);
const jobs = () => firestore().collection(config.jobs.collection);
const slotKey = (appId: string, userId: string) => `${appId}__${userId}`;

export interface SlotClaim {
  ok: boolean;
  /** In-flight count after the claim (or the count that refused it). */
  inFlight: number;
}

/**
 * Take a slot, or refuse. `force` takes it regardless of the cap — an admin
 * resuming a held job has already decided this job runs, and the buyer having
 * something else in flight is not that admin's problem.
 */
export async function claimJobSlot(
  appId: string,
  userId: string,
  max: number,
  opts: { force?: boolean } = {},
): Promise<SlotClaim> {
  const ref = slots().doc(slotKey(appId, userId));
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const inFlight = (snap.exists ? ((snap.data()?.inFlight as number) ?? 0) : 0) || 0;
    if (!opts.force && inFlight >= max) return { ok: false, inFlight };
    tx.set(ref, { appId, userId, inFlight: inFlight + 1, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, inFlight: inFlight + 1 };
  });
}

/**
 * Release the slot a JOB holds. Idempotent: the flag on the job is the record, so
 * a second call — a retry, a worker and an admin racing, a re-dispatch — is a
 * no-op rather than a double decrement.
 */
export async function releaseJobSlot(jobId: string): Promise<boolean> {
  const jobRef = jobs().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return false;
    const job = snap.data() as ResearchJob;
    if (!job.slotHeld) return false;
    tx.set(jobRef, { slotHeld: false }, { merge: true });
    tx.set(
      slots().doc(slotKey(job.appId, job.userId)),
      { inFlight: FieldValue.increment(-1), updatedAt: new Date().toISOString() },
      { merge: true },
    );
    return true;
  });
}

/**
 * Release a slot claimed for a job that was never created.
 *
 * The claim happens early (before the model call, deliberately) and the job
 * document is written at the very end, so every rejection in between — no credits,
 * rate-limited, refused by moderation — owes a slot back with nothing to hang the
 * bookkeeping on. Floored at zero: a stray extra call must not lend the user a slot.
 */
export async function releaseUnclaimedSlot(appId: string, userId: string): Promise<void> {
  const ref = slots().doc(slotKey(appId, userId));
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const inFlight = (snap.exists ? ((snap.data()?.inFlight as number) ?? 0) : 0) || 0;
    tx.set(ref, { appId, userId, inFlight: Math.max(0, inFlight - 1), updatedAt: new Date().toISOString() }, { merge: true });
  });
}

/** Current in-flight count for a user (diagnostics; the claim is the enforcement). */
export async function inFlightSlots(appId: string, userId: string): Promise<number> {
  const snap = await slots().doc(slotKey(appId, userId)).get();
  return (snap.exists ? ((snap.data()?.inFlight as number) ?? 0) : 0) || 0;
}

/**
 * Record (or clear) the fact that a job holds a slot. Used when a job re-enters
 * the queue after being parked: the claim happened outside `createJob`, and the
 * flag is what makes the eventual release exactly-once.
 */
export async function setJobSlotHeld(jobId: string, held: boolean): Promise<boolean> {
  const ref = jobs().doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const status = (snap.data() as { status?: string }).status;
    // Never flag a slot on a job that has already ended. Blind, a straggler
    // finishing between the claim and this write left a `completed` job holding
    // `slotHeld: true` and the counter at 1 — forever, because release goes
    // through the job and the job is done. With the cap at one report, that is a
    // permanent lockout, and no admin endpoint reaches the slots collection.
    if (held && (status === 'completed' || status === 'failed')) return false;
    tx.set(ref, { slotHeld: held }, { merge: true });
    return true;
  });
}
