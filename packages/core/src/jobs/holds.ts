/**
 * Holds: a job parked for an admin decision, and the sweep that stops it being
 * parked forever.
 *
 * A hold keeps the buyer's credits consumed — that is the whole point, since an
 * approval must not depend on the buyer still having a balance they were given
 * back. The cost of that choice is that a hold nobody resolves is a buyer who paid
 * and got nothing, so every hold carries an expiry, and this is what enforces it:
 * past `expiresAt`, the job fails and the credits go back.
 *
 * Resolution is one-way and raced-proof: `rejectHold` flips the status inside a
 * transaction and answers whether it won, and only the winner refunds. An admin
 * approving at the same moment as the sweep cannot produce both an approval and a
 * refund.
 */
import { config } from '../config.js';
import { refundForJob } from '../credits/store.js';
import { listExpiredHolds, rejectHold } from './firestore.js';
import { jobLogger } from '../obs/log.js';
import type { JobFailureKind } from './types.js';

/** Why an expired hold failed, per reason. Reaches the buyer, so: no figures, no jargon. */
const EXPIRY_ERROR: Record<JobFailureKind, string> = {
  budget_exceeded: 'Stopped by the per-job cost ceiling and not approved to continue in time; the credits were refunded.',
  upload_failed: 'The report could not be stored and was not recovered in time; the credits were refunded.',
};

export interface ExpireHoldsResult {
  /** Holds that were past their expiry when the sweep ran. */
  found: number;
  /** Of those, the ones this sweep resolved (the rest were resolved by someone else). */
  expired: number;
  refunded: number;
}

/**
 * Resolve every hold whose expiry has passed: fail the job, refund the buyer.
 *
 * Idempotent and safe to call from anywhere, as often as you like — a hold already
 * resolved by an admin loses the transaction and is skipped. Bounded per call so a
 * backlog drains over several runs instead of one very long request.
 */
export async function expireHolds(opts: { now?: Date; limit?: number } = {}): Promise<ExpireHoldsResult> {
  const now = (opts.now ?? new Date()).toISOString();
  const jobs = await listExpiredHolds(now, opts.limit ?? 100);
  const result: ExpireHoldsResult = { found: jobs.length, expired: 0, refunded: 0 };

  for (const job of jobs) {
    const log = jobLogger({ jobId: job.jobId, appId: job.appId, userId: job.userId, template: job.template });
    const reason: JobFailureKind = job.hold?.reason ?? 'budget_exceeded';
    try {
      // Flip first, refund second. If the refund throws we have a failed job that
      // was not refunded — visible, and fixable by hand. The other order can refund
      // a job an admin just approved, which is money gone with nothing recording it.
      const won = await rejectHold(job.jobId, EXPIRY_ERROR[reason]);
      if (!won) continue;
      result.expired += 1;
      log.warn('job.hold_expired', { reason, heldAt: job.hold?.heldAt, spentUsd: job.hold?.spentUsd ?? 0 });

      if (await refundForJob(job.appId, job.userId, job.jobId, `hold expired (${reason})`)) {
        result.refunded += 1;
        log.info('credits.refunded', { jobId: job.jobId, reason: 'hold_expired' });
      }
    } catch (err) {
      // One bad job must not stop the sweep — the next run picks it up again.
      log.warn('job.hold_expire_failed', { message: (err as Error).message });
    }
  }
  return result;
}

/** When a hold placed now should expire (see `HOLD_TTL_HOURS`). */
export function holdExpiryFrom(now: Date = new Date()): string {
  return new Date(now.getTime() + config.workflow.holdTtlHours * 3_600_000).toISOString();
}
