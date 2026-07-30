import { describe, it, expect } from 'vitest';
import {
  recordReportStats,
  recordPurchaseStats,
  recordRequestLlmCost,
  getAppStats,
  getDailyStats,
  queryUsers,
} from '../src/stats/store.js';

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

  it('tracks total errors, degraded reports, and min/max/avg gen time', async () => {
    await recordReportStats({ appId: A, userId: 'u1@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 500_000 });
    await recordReportStats({ appId: A, userId: 'u2@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 900_000, degraded: true });
    await recordReportStats({ appId: A, userId: 'u3@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 700_000 });
    await recordReportStats({ appId: A, userId: 'u4@x.com', template: 't', status: 'failed', costUsd: 0.2, durationMs: 0 });

    const s = (await getAppStats(A))!;
    expect(s.reportsFailed).toBe(1); // total errors
    expect(s.degradedReports).toBe(1);
    expect(s.genTimeMsMin).toBe(500_000);
    expect(s.genTimeMsMax).toBe(900_000);
    expect((s.genTimeMsTotal as number) / (s.genCount as number)).toBe(700_000); // avg
  });

  it('counts a user whose first contact is a request-path model call', async () => {
    // Moderation and the assisted review run BEFORE any report exists, so this is
    // often the first write a user ever gets. Creating their doc with a plain set()
    // would leave them permanently uncounted: `ensureUserSeen` only bumps the
    // distinct-user counters when the doc does not exist yet, so nothing later —
    // not a login, not a report — would ever count them.
    const app = 'app-req';
    await recordRequestLlmCost({ appId: app, userId: 'p1@x.com', usd: 0.0004, inputTokens: 400, outputTokens: 120 });

    const s = (await getAppStats(app))!;
    expect(s.users).toBe(1);
    expect(s.requestLlmUsd).toBeCloseTo(0.0004, 9);
    expect(s.requestLlmCalls).toBe(1);

    const users = await queryUsers({ appId: app });
    expect(users[0]!.firstSeenAt).toBeTruthy();

    // …and a later report does not double-count them.
    await recordReportStats({ appId: app, userId: 'p1@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 1000 });
    expect((await getAppStats(app))!.users).toBe(1);
  });

  it('finds a user by email prefix — the lookup support needs to unblock someone', async () => {
    // Three reviewers in a row have read this query as `>= X AND < X` (an empty
    // range, so the search would always return nothing) because the upper bound's
    // sentinel is U+F8FF, which renders as nothing in a terminal. It is a real
    // character and the range is real; this test is here so the next reader gets an
    // answer from the suite instead of from squinting at the source.
    const app = 'app-find';
    for (const u of ['ana@corp.com', 'andres@corp.com', 'zoe@corp.com']) {
      await recordReportStats({ appId: app, userId: u, template: 't', status: 'completed', costUsd: 1, durationMs: 1000 });
    }

    const found = await queryUsers({ appId: app, emailPrefix: 'an' });
    expect(found.map((u) => u.userId).sort()).toEqual(['ana@corp.com', 'andres@corp.com']);
    expect(await queryUsers({ appId: app, emailPrefix: 'ana@corp.com' })).toHaveLength(1);
    expect(await queryUsers({ appId: app, emailPrefix: 'nobody' })).toHaveLength(0);
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
