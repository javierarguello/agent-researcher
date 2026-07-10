import { describe, it, expect } from 'vitest';
import { recordReportStats, recordPurchaseStats, getAppStats, getDailyStats } from '../src/stats/store.js';

const A = 'app1';

describe('per-app stats', () => {
  it('aggregates reports, distinct users, cost, gen time, and by-template', async () => {
    await recordReportStats({ appId: A, userId: 'u1@x.com', template: 'florida', status: 'completed', costUsd: 3, durationMs: 900_000 });
    await recordReportStats({ appId: A, userId: 'u1@x.com', template: 'florida', status: 'failed', costUsd: 0.5, durationMs: 0 });
    await recordReportStats({ appId: A, userId: 'u2@x.com', template: 'florida', status: 'completed', costUsd: 1, durationMs: 700_000 });

    const s = (await getAppStats(A))!;
    expect(s.users).toBe(2); // distinct
    expect(s.reports).toBe(3);
    expect(s.reportsCompleted).toBe(2);
    expect(s.reportsFailed).toBe(1);
    expect((s.reportsByTemplate as Record<string, number>).florida).toBe(3);
    expect(s.costUsd).toBeCloseTo(4.5, 6);
    // avg gen time = total / count
    expect((s.genTimeMsTotal as number) / (s.genCount as number)).toBe(800_000);
  });

  it('folds purchases into revenue + a daily bucket', async () => {
    await recordPurchaseStats({ appId: A, userId: 'u1@x.com', amountUsd: 49, credits: 15 });
    const s = (await getAppStats(A))!;
    expect(s.revenueUsd).toBe(49);
    expect(s.purchases).toBe(1);
    expect(s.creditsPurchased).toBe(15);

    const daily = await getDailyStats(A, 60);
    expect(daily.length).toBe(1);
    expect((daily[0] as { revenueUsd: number }).revenueUsd).toBe(49);
    expect((daily[0] as { newUsers: number }).newUsers).toBe(1);
  });
});
