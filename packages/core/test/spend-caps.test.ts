/**
 * Monthly spend caps (global and per app), the admin's pause, and the alerts.
 *
 * What has to hold:
 *   - the rule: pause first, then the global cap, then the app's — and an app's
 *     cap counts only that app's spend;
 *   - the ledger counts a job ONCE however many times its cost is re-saved, and
 *     never books a negative when a stale dispatch writes an older total;
 *   - an alert is one mail per threshold per month, not one per booking;
 *   - a job that starts while capped spends nothing and is parked `spend_cap`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ to: string; subject: string }> = [];
vi.mock('../src/email/postmark.js', async (orig) => ({
  ...(await orig<typeof import('../src/email/postmark.js')>()),
  sendAppEmail: async (input: { to: string; subject: string }) => void sent.push({ to: input.to, subject: input.subject }),
}));
vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
  downloadObject: async () => undefined,
  deleteObject: async () => {},
  listJobFiles: async () => [],
}));

import { bookSpend, getMonthSpend, monthKey, spendBlockFor, type MonthSpend } from '../src/spend/store.js';
import { updateSettings } from '../src/settings/store.js';
import { createApp, updateApp } from '../src/apps/store.js';
import { createJob, getJob, setJobCost } from '../src/jobs/firestore.js';
import { emptyCost } from '../src/cost.js';
import { runJob } from '../src/engine/run-job.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';

const spend = (totalUsd: number, apps: Record<string, number> = {}): MonthSpend => ({ month: '2026-10', totalUsd, apps, searchUsd: 0, searchCalls: 0, appsSearchUsd: {} });
const open = { jobsPaused: false, globalMonthlySpendCapUsd: 200 };

beforeEach(() => {
  sent.length = 0;
});

describe('spendBlockFor — the rule', () => {
  it('blocks at the global cap, not one cent before', () => {
    expect(spendBlockFor(spend(199.99), open, undefined)).toBeNull();
    expect(spendBlockFor(spend(200), open, undefined)).toEqual({ scope: 'global', spentUsd: 200, capUsd: 200 });
  });

  it('counts only the app’s own spend against the app cap', () => {
    const app = { appId: 'a', monthlySpendCapUsd: 50 };
    // $150 spent in total, $10 of it by `a`: under a's $50.
    expect(spendBlockFor(spend(150, { a: 10, b: 140 }), open, app)).toBeNull();
    expect(spendBlockFor(spend(150, { a: 50, b: 100 }), open, app)).toEqual({ scope: 'app', spentUsd: 50, capUsd: 50 });
  });

  it('the pause wins over everything, with no spend at all', () => {
    expect(spendBlockFor(spend(0), { ...open, jobsPaused: true }, undefined)?.scope).toBe('paused');
  });

  it('null, 0 and negative caps mean no cap', () => {
    for (const cap of [null, 0, -5]) {
      expect(spendBlockFor(spend(1e6, { a: 1e6 }), { jobsPaused: false, globalMonthlySpendCapUsd: cap }, { appId: 'a', monthlySpendCapUsd: cap as number })).toBeNull();
    }
  });
});

describe('the ledger', () => {
  it('books a job once across re-saves, and never a negative', async () => {
    await createJob({ jobId: 'j', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params: {} });
    await setJobCost('j', { ...emptyCost(), usd: 1.0 });
    await setJobCost('j', { ...emptyCost(), usd: 1.0 }); // same total re-saved
    await setJobCost('j', { ...emptyCost(), usd: 1.5 }); // the next dispatch
    await setJobCost('j', { ...emptyCost(), usd: 1.2 }); // a stale dispatch's older view
    const m = await getMonthSpend();
    expect(m.totalUsd).toBeCloseTo(1.5, 10);
    expect(m.apps.fbizlab).toBeCloseTo(1.5, 10);
    // The job doc still shows what was last written — the ledger is what refused to go down.
    expect((await getJob('j'))!.cost?.usd).toBe(1.2);
    expect(m.month).toBe(monthKey());
  });
});

describe('the ledger’s search slice', () => {
  it('books the provider’s USD and calls apart from the model, per app', async () => {
    await createJob({ jobId: 's', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params: {} });
    await setJobCost('s', { ...emptyCost(), usd: 1.0, llmUsd: 0.84, searchUsd: 0.16, searchCalls: 10 });
    await setJobCost('s', { ...emptyCost(), usd: 1.5, llmUsd: 1.18, searchUsd: 0.32, searchCalls: 20 });
    await setJobCost('s', { ...emptyCost(), usd: 1.5, llmUsd: 1.18, searchUsd: 0.32, searchCalls: 20 }); // re-save
    const m = await getMonthSpend();
    expect(m.totalUsd).toBeCloseTo(1.5, 10);
    expect(m.searchUsd).toBeCloseTo(0.32, 10);
    expect(m.searchCalls).toBe(20);
    expect(m.appsSearchUsd.fbizlab).toBeCloseTo(0.32, 10);
  });

  it('a job in flight across the deploy catches its search up without re-booking its total', async () => {
    await createJob({ jobId: 'old', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params: {} });
    // What the previous release left on the job: the total booked, no search fields.
    const { Firestore } = await import('@google-cloud/firestore');
    await new Firestore().collection('jobs').doc('old').set({ costBookedUsd: 2.0 }, { merge: true });
    await setJobCost('old', { ...emptyCost(), usd: 2.5, searchUsd: 0.4, searchCalls: 25 });
    const m = await getMonthSpend();
    expect(m.totalUsd).toBeCloseTo(0.5, 10); // only the new $0.50
    expect(m.searchUsd).toBeCloseTo(0.4, 10);
    expect(m.searchCalls).toBe(25);
  });
});

describe('alerts', () => {
  it('sends one mail per threshold per month, to the configured recipients', async () => {
    await createApp({ name: 'fbizlab', role: 'app', appId: 'fbizlab', emailFrom: 'no-reply@x.com' } as never);
    await updateSettings({ globalMonthlySpendAlertUsd: 10, globalMonthlySpendCapUsd: 20, spendAlertEmails: ['ops@x.com'] });

    await bookSpend('fbizlab', 9);
    expect(sent).toHaveLength(0);
    await bookSpend('fbizlab', 2); // crosses $10
    await bookSpend('fbizlab', 2); // still past $10 — no second mail
    expect(sent.map((s) => s.subject)).toEqual([expect.stringContaining('Global monthly spend alert')]);
    expect(sent[0]!.to).toBe('ops@x.com');

    await bookSpend('fbizlab', 10); // crosses the $20 cap
    expect(sent.map((s) => s.subject)).toEqual([
      expect.stringContaining('Global monthly spend alert'),
      expect.stringContaining('Global monthly spend CAP reached'),
    ]);
  });

  it('alerts on an app’s own threshold', async () => {
    await createApp({ name: 'fbizlab', role: 'app', appId: 'fbizlab', emailFrom: 'no-reply@x.com' } as never);
    await updateApp('fbizlab', { monthlySpendAlertUsd: 5 });
    await updateSettings({ globalMonthlySpendAlertUsd: null, spendAlertEmails: ['ops@x.com'] });
    await bookSpend('fbizlab', 6);
    expect(sent.map((s) => s.subject)).toEqual([expect.stringContaining('App "fbizlab" monthly spend alert')]);
  });
});

describe('a job that starts while capped', () => {
  const template = getTemplate('florida-business-for-sale')!;
  const params = () => template.paramsSchema.parse({ industry: 'laundromats', mode: 'essential' }) as Record<string, unknown>;

  it('is parked spend_cap and calls no model', async () => {
    const mock = new MockLlmProvider();
    const calls = vi.spyOn(mock, 'generate');
    __setProviderForTests('gemini-vertex', mock);
    await createJob({ jobId: 'jc', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params: params() });
    await updateSettings({ globalMonthlySpendCapUsd: 5 });
    await bookSpend('fbizlab', 5);

    const result = await runJob({ jobId: 'jc', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params: params() });

    expect(result.status).toBe('held');
    const job = (await getJob('jc'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.reason).toBe('spend_cap');
    expect(job.hold?.detail).toContain('global monthly spend cap was reached: $5.00 of $5.00');
    expect(job.attempts ?? 0).toBe(0); // no attempt used — approval is a clean start
    expect(calls).not.toHaveBeenCalled();
  });

  it('is parked when an admin paused jobs, even with no spend', async () => {
    __setProviderForTests('gemini-vertex', new MockLlmProvider());
    await createJob({ jobId: 'jp', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params: params() });
    await updateSettings({ jobsPaused: true });
    const result = await runJob({ jobId: 'jp', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params: params() });
    expect(result.status).toBe('held');
    expect((await getJob('jp'))!.hold?.detail).toBe('Jobs are paused by an admin (Limits).');
  });
});
