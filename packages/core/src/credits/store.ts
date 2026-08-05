/**
 * Firestore-backed credits store, shared by every model and web app.
 *
 * - `credit-balances/{appId__userId}` — materialized current balance.
 * - `credit-ledger/{id}` — append-only log; deterministic ids give idempotency
 *   (purchase_<paymentId>, consume_<jobId>, refund_<jobId>).
 *
 * Every mutation runs in a transaction that reads the balance + the ledger entry
 * (idempotency check) before writing both, so balance and log never diverge.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import {
  InsufficientCreditsError,
  type CreditBalance,
  type CreditLedgerEntry,
  type LedgerEntryType,
} from './types.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const ledger = () => firestore().collection(config.credits.ledgerCollection);
const balances = () => firestore().collection(config.credits.balancesCollection);

const nowIso = () => new Date().toISOString();
const balKey = (appId: string, userId: string) => `${appId}__${userId}`;

// --- Balance + history reads ------------------------------------------------

export async function getBalance(appId: string, userId: string): Promise<number> {
  const snap = await balances().doc(balKey(appId, userId)).get();
  return snap.exists ? (snap.data() as CreditBalance).balance : 0;
}

export async function listTransactions(
  appId: string,
  userId: string,
  limit = 50,
  type?: LedgerEntryType,
): Promise<CreditLedgerEntry[]> {
  // Requires a composite index on (appId, userId, createdAt desc); adding a
  // `type` filter needs (appId, userId, type, createdAt desc).
  let q = ledger().where('appId', '==', appId).where('userId', '==', userId);
  if (type) q = q.where('type', '==', type);
  const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as CreditLedgerEntry);
}

// --- Mutations (transactional) ----------------------------------------------

interface DeltaInput {
  id: string;
  appId: string;
  userId: string;
  type: LedgerEntryType;
  credits: number;
  plan?: string;
  paymentId?: string;
  provider?: string;
  amountUsd?: number;
  currency?: string;
  jobId?: string;
  grantedBy?: string;
  reason?: string;
  note?: string;
}

/** Apply one ledger entry + balance change atomically. Idempotent by entry id. */
async function applyEntry(entry: DeltaInput): Promise<{ applied: boolean; balance: number }> {
  // Every amount in this file is a COUNT of credits, and the sign is carried by the
  // entry type, not the number. Without this a "consumption" of -5 raises the
  // balance by five: the `current < entry.credits` check passes trivially and the
  // delta flips. Unreachable through the API today — the admin route's schema is
  // `integer, minimum 1` and the mode costs are code — so this is the invariant
  // being stated rather than left to hold by convention.
  if (!Number.isInteger(entry.credits) || entry.credits <= 0) {
    throw new Error(`Credit amounts must be positive whole numbers; got ${entry.credits}`);
  }
  const balRef = balances().doc(balKey(entry.appId, entry.userId));
  const ledRef = ledger().doc(entry.id);
  return firestore().runTransaction(async (tx) => {
    const ledSnap = await tx.get(ledRef);
    const balSnap = await tx.get(balRef);
    const current = balSnap.exists ? (balSnap.data() as CreditBalance).balance : 0;
    if (ledSnap.exists) return { applied: false, balance: current }; // already processed

    if (entry.type === 'consumption' && current < entry.credits) {
      throw new InsufficientCreditsError(current, entry.credits);
    }
    const delta = entry.type === 'consumption' ? -entry.credits : entry.credits;
    const newBalance = current + delta;

    const full: CreditLedgerEntry = { ...entry, createdAt: nowIso() };
    // Firestore rejects `undefined` — strip absent optionals.
    for (const k of Object.keys(full) as (keyof CreditLedgerEntry)[]) if (full[k] === undefined) delete full[k];
    tx.set(ledRef, full);
    tx.set(
      balRef,
      { appId: entry.appId, userId: entry.userId, balance: newBalance, updatedAt: nowIso() },
      { merge: true },
    );
    return { applied: true, balance: newBalance };
  });
}

/**
 * Grant free credits (admin / promo). Recorded in the append-only ledger with
 * attribution (`grantedBy` = the admin, `reason` = why) for audit. Pass an
 * `idempotencyKey` to make the grant idempotent (else each call is a new entry).
 */
export function grantCredits(input: {
  appId: string;
  userId: string;
  credits: number;
  grantedBy?: string;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
}) {
  const { idempotencyKey, ...rest } = input;
  // Scoped to the recipient. A bare `grant_<key>` is one global namespace, so the
  // same key for two different users silently no-ops the second — the admin sees
  // `applied: false` if they look, and nothing at all if they don't. A key means
  // "this grant, to this person", never "this key, anywhere".
  const id = idempotencyKey
    ? `grant_${balKey(input.appId, input.userId)}_${idempotencyKey}`
    : `grant_${ledger().doc().id}`;
  return applyEntry({ id, type: 'grant', ...rest });
}

/** Record a purchase (idempotent by paymentId). */
export function recordPurchase(input: {
  appId: string;
  userId: string;
  credits: number;
  plan: string;
  paymentId: string;
  amountUsd?: number;
  currency?: string;
  provider?: string;
}) {
  return applyEntry({ id: `purchase_${input.paymentId}`, type: 'purchase', provider: 'stripe', ...input });
}

/** Consume credits for a job. Throws InsufficientCreditsError if too low. Idempotent by jobId. */
export function consumeCredits(appId: string, userId: string, credits: number, jobId: string) {
  return applyEntry({ id: `consume_${jobId}`, appId, userId, type: 'consumption', credits, jobId });
}

// Plans are NOT stored in Firestore — the catalog lives entirely in Stripe
// (Products/Prices with lookup_key `<appId>_<planId>` + metadata { app, credits }).

/**
 * Have this job's credits been given back?
 *
 * The question a caller must ask before RE-RUNNING someone's job: a refunded job
 * is an unpaid job, and re-running it hands out a report nobody paid for. The
 * refund marker is the record, so this is a single read.
 */
/**
 * Did this job ever consume credits?
 *
 * Distinguishes "the refund failed" from "there was nothing to refund" —
 * `refundForJob` returns `false` for both, so a caller reporting a failure on
 * `false` tells the admin to retry forever on a buyer who was never charged.
 */
export async function wasJobConsumed(jobId: string): Promise<boolean> {
  return (await ledger().doc(`consume_${jobId}`).get()).exists;
}

export async function wasJobRefunded(jobId: string): Promise<boolean> {
  return (await ledger().doc(`refund_${jobId}`).get()).exists;
}

/**
 * Refund the credits a job consumed (only if it was consumed and not already
 * refunded).
 *
 * Takes no `appId`/`userId`, and that is the point. It used to, long after the
 * body stopped reading them: the recipient comes from the CONSUME ENTRY, because
 * a job's credits are charged to and returned to the job's OWNER — never to the
 * admin who pressed the button, and never to whoever the caller passed. A
 * signature that asks for a recipient it then ignores invites exactly the belief
 * the rule forbids, and one caller already passed a mismatched pair.
 *
 * Every refund in this system is a decision a person made (Javier, 2026-07-31);
 * nothing refunds automatically, so there is no path where the owner is unknown.
 */
export async function refundForJob(jobId: string, note?: string): Promise<boolean> {
  const consumeRef = ledger().doc(`consume_${jobId}`);
  const refundRef = ledger().doc(`refund_${jobId}`);
  const jobRef = firestore().collection(config.jobs.collection).doc(jobId);
  return firestore().runTransaction(async (tx) => {
    const consumeSnap = await tx.get(consumeRef);
    const refundSnap = await tx.get(refundRef);
    const jobSnap = await tx.get(jobRef);
    if (!consumeSnap.exists || refundSnap.exists) return false; // nothing consumed, or already refunded

    // A job that is going to RUN is not refundable. `resolve` flips the job to
    // failed and then refunds; an admin retry landing between those two awaits
    // re-queues it, and this write would then leave a job that is both queued and
    // refunded — the free report the refund guard exists to prevent, arrived at
    // from the other direction.
    const status = jobSnap.exists ? (jobSnap.data() as { status?: string }).status : undefined;
    if (status === 'queued' || status === 'running') return false;

    // The owner comes from the CONSUME ENTRY, never from the caller. The amount
    // already did; taking the identity from anywhere else means a mismatched pair
    // credits one account for another's debit and burns the payer's only refund.
    const entry = consumeSnap.data() as CreditLedgerEntry;
    const credits = entry.credits;
    const balRef = balances().doc(balKey(entry.appId, entry.userId));
    const balSnap = await tx.get(balRef);
    const current = balSnap.exists ? (balSnap.data() as CreditBalance).balance : 0;
    tx.set(refundRef, {
      id: `refund_${jobId}`,
      appId: entry.appId,
      userId: entry.userId,
      type: 'refund',
      credits,
      jobId,
      ...(note ? { note } : {}),
      createdAt: nowIso(),
    } as CreditLedgerEntry);
    tx.set(
      balRef,
      { appId: entry.appId, userId: entry.userId, balance: current + credits, updatedAt: nowIso() },
      { merge: true },
    );
    return true;
  });
}
