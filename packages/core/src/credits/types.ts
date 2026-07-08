/**
 * Shared credits/billing types. Credits are scoped per (appId, userId): each
 * product/web keeps its own balance for the same user. The ledger is an
 * append-only log of every purchase, consumption, refund, and grant.
 */
export type LedgerEntryType = 'purchase' | 'consumption' | 'refund' | 'grant';

export interface CreditLedgerEntry {
  /** Deterministic where idempotency matters (purchase_<paymentId>, consume_<jobId>, refund_<jobId>). */
  id: string;
  appId: string;
  userId: string;
  type: LedgerEntryType;
  /** Absolute amount of credits (always positive); `type` gives the direction. */
  credits: number;
  /** Purchase: which plan was selected. */
  plan?: string;
  /** Purchase: payment/session id from the provider (dedup key). */
  paymentId?: string;
  provider?: string;
  /** Purchase: money paid. */
  amountUsd?: number;
  currency?: string;
  /** Consumption/refund: the job this relates to. */
  jobId?: string;
  note?: string;
  createdAt: string;
}

export interface CreditBalance {
  appId: string;
  userId: string;
  balance: number;
  updatedAt: string;
}

/** Thrown by `consumeCredits` when the balance is too low. */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super(`Insufficient credits: have ${balance}, need ${required}.`);
    this.name = 'InsufficientCreditsError';
  }
}
