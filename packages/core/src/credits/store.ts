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
  const id = idempotencyKey ? `grant_${idempotencyKey}` : `grant_${ledger().doc().id}`;
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

/** Refund the credits a job consumed (only if it was consumed and not already refunded). */
export async function refundForJob(appId: string, userId: string, jobId: string, note?: string): Promise<boolean> {
  const consumeRef = ledger().doc(`consume_${jobId}`);
  const refundRef = ledger().doc(`refund_${jobId}`);
  const balRef = balances().doc(balKey(appId, userId));
  return firestore().runTransaction(async (tx) => {
    const consumeSnap = await tx.get(consumeRef);
    const refundSnap = await tx.get(refundRef);
    const balSnap = await tx.get(balRef);
    if (!consumeSnap.exists || refundSnap.exists) return false; // nothing consumed, or already refunded
    const credits = (consumeSnap.data() as CreditLedgerEntry).credits;
    const current = balSnap.exists ? (balSnap.data() as CreditBalance).balance : 0;
    tx.set(refundRef, {
      id: `refund_${jobId}`,
      appId,
      userId,
      type: 'refund',
      credits,
      jobId,
      ...(note ? { note } : {}),
      createdAt: nowIso(),
    } as CreditLedgerEntry);
    tx.set(balRef, { appId, userId, balance: current + credits, updatedAt: nowIso() }, { merge: true });
    return true;
  });
}
