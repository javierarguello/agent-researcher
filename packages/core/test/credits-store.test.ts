import { describe, it, expect } from 'vitest';
import {
  grantCredits,
  getBalance,
  consumeCredits,
  recordPurchase,
  refundForJob,
  listTransactions,
} from '../src/credits/store.js';
import { InsufficientCreditsError } from '../src/credits/types.js';

const A = 'app1';
const U = 'u@x.com';

describe('credits store', () => {
  it('grants credits and reflects the balance', async () => {
    await grantCredits({ appId: A, userId: U, credits: 5 });
    expect(await getBalance(A, U)).toBe(5);
  });

  it('consumes credits and is idempotent per jobId', async () => {
    await grantCredits({ appId: A, userId: U, credits: 5 });
    await consumeCredits(A, U, 2, 'job1');
    await consumeCredits(A, U, 2, 'job1'); // same jobId → no double charge
    expect(await getBalance(A, U)).toBe(3);
  });

  it('throws InsufficientCreditsError when the balance is too low', async () => {
    await grantCredits({ appId: A, userId: U, credits: 1 });
    await expect(consumeCredits(A, U, 5, 'jobX')).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(A, U)).toBe(1); // unchanged
  });

  it('refunds only a consumed job, once', async () => {
    await grantCredits({ appId: A, userId: U, credits: 5 });
    await consumeCredits(A, U, 2, 'job2');
    expect(await refundForJob(A, U, 'job2')).toBe(true);
    expect(await refundForJob(A, U, 'job2')).toBe(false); // already refunded
    expect(await refundForJob(A, U, 'never-consumed')).toBe(false);
    expect(await getBalance(A, U)).toBe(5);
  });

  it('records a purchase idempotently by paymentId', async () => {
    await recordPurchase({ appId: A, userId: U, credits: 15, plan: 'investor', paymentId: 'pi_1', amountUsd: 49 });
    await recordPurchase({ appId: A, userId: U, credits: 15, plan: 'investor', paymentId: 'pi_1', amountUsd: 49 });
    expect(await getBalance(A, U)).toBe(15);
    const ledger = await listTransactions(A, U, 10);
    expect(ledger.filter((e) => e.type === 'purchase')).toHaveLength(1);
  });
});
