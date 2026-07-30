/**
 * What happens to the money when a job hits the cost ceiling.
 *
 * The decision (Javier, 2026-07-30): the job FAILS and the buyer is refunded,
 * rather than completing with degraded sections and keeping the credits. That cuts
 * against us for anyone provoking the spend on purpose — they get their credits
 * back while we keep the bill — so the second half of the decision is that such a
 * job has to be *visible*: its own mark on the job, its own counter, and the spend
 * booked apart from spend that earned a report.
 *
 * This runs the real engine end-to-end through `runJob`, because every part of that
 * — refund, mark, stats — lives outside the engine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));
vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
  downloadObject: async () => undefined,
  deleteObject: async () => {},
  signJobFiles: async (f: unknown) => f,
  listJobFiles: async () => [],
  signRead: async () => '',
}));

import { config } from '../src/config.js';
import { runJob } from '../src/engine/run-job.js';
import { getJob } from '../src/jobs/firestore.js';
import { grantCredits, consumeCredits, getBalance, listTransactions } from '../src/credits/store.js';
import { getAppStats } from '../src/stats/store.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';

const APP = 'fbizlab';
const USER = 'u@x.com';
const template = getTemplate('florida-business-for-sale')!;
const params = () => template.paramsSchema.parse({ mode: 'essential', industry: 'Laundromats' }) as Record<string, unknown>;

describe('a job stopped by the cost ceiling', () => {
  const original = config.workflow.maxJobCostUsd;
  beforeEach(() => __setProviderForTests('gemini-vertex', new MockLlmProvider()));
  afterEach(() => {
    config.workflow.maxJobCostUsd = original;
  });

  it('fails, refunds the buyer, and still shows what it cost us', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'jb1');
    expect(await getBalance(APP, USER)).toBe(4);

    // Low enough to trip a few calls in, so there is real spend to account for.
    config.workflow.maxJobCostUsd = 0.01;

    const lines: string[] = [];
    const l = vi.spyOn(console, 'log').mockImplementation((x) => void lines.push(String(x)));
    const e = vi.spyOn(console, 'error').mockImplementation((x) => void lines.push(String(x)));
    const result = await runJob({ jobId: 'jb1', appId: APP, userId: USER, template: template.id, params: params() });
    l.mockRestore();
    e.mockRestore();
    const logs = lines.map((s) => { try { return JSON.parse(s); } catch { return {} as Record<string, unknown>; } });

    expect(result.status).toBe('failed');

    const job = (await getJob('jb1'))!;
    expect(job.status).toBe('failed');
    // The mark. Without it a cost-ceiling stop is indistinguishable in the admin
    // from a model that returned bad JSON — and the two need opposite responses.
    expect(job.failureKind).toBe('budget_exceeded');
    // The money is on the job, because it was spent whatever the outcome.
    expect(job.cost?.usd).toBeGreaterThan(0);
    // …but not in the message the buyer reads.
    expect(String(job.error)).toMatch(/cost ceiling/i);
    expect(String(job.error)).not.toMatch(/\$\s?\d/);

    // The buyer is whole again.
    expect(await getBalance(APP, USER)).toBe(5);
    const ledger = await listTransactions(APP, USER, 10);
    expect(ledger.some((t) => t.type === 'refund' && t.jobId === 'jb1')).toBe(true);

    // Its own ERROR event, with the figures — this is an incident, not the ordinary
    // "one agent couldn't finish" degradation.
    const ev = logs.find((x) => x.event === 'job.budget_exceeded');
    expect(ev).toBeTruthy();
    expect(ev!.severity).toBe('ERROR');
    expect(Number(ev!.costUsd)).toBeGreaterThan(0);
    expect(Number(ev!.limitUsd)).toBe(0.01);
  });

  it('books the spend as refunded, apart from spend that earned a report', async () => {
    config.workflow.maxJobCostUsd = 0.01;
    await runJob({ jobId: 'jb2', appId: APP, userId: USER, template: template.id, params: params() });

    const stats = (await getAppStats(APP))!;
    // `costUsd` alone cannot answer "what did our failures cost us" — inside it,
    // money that produced a report and money we gave back look identical.
    expect(Number(stats.failedCostUsd)).toBeGreaterThan(0);
    expect(Number(stats.failedCostUsd)).toBeLessThanOrEqual(Number(stats.costUsd));
    expect(Number(stats.budgetStoppedReports)).toBe(1);
  });
});
