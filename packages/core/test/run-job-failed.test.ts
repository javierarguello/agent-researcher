import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyCost } from '../src/cost.js';

vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
  downloadObject: async () => undefined,
  deleteObject: async () => {},
  signJobFiles: async (f: unknown) => f,
  listJobFiles: async () => [],
  signRead: async () => '',
}));

// Force a hard job failure by mocking the engine to return a failed trace.
const failedOutput = {
  report: {},
  sources: [],
  language: 'es',
  turnsUsed: 0,
  meta: {
    title: 't', template: 'florida-business-for-sale', templateVersion: 1, schemaVersion: 'x@1',
    jobId: 'j2', language: 'es', mode: 'essential', depth: 'light', generatedAt: '2026-07-10',
    contentFormat: 'markdown', cost: emptyCost(),
  },
  trace: {
    jobId: 'j2', template: 'x', templateVersion: 1, language: 'es', brief: '', waves: [['a']],
    agents: [{ id: 'a', role: 'producer', wave: 1, produces: ['market_overview'], enriches: [], model: 'pro', status: 'failed', turnsUsed: 0, cost: emptyCost(), notes: [], error: 'boom', startedAt: '2026', finishedAt: '2026' }],
    cost: emptyCost(), status: 'failed', error: 'Assembled report failed schema validation', startedAt: '2026', finishedAt: '2026',
  },
};
vi.mock('../src/engine/research-engine.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, runResearch: vi.fn(async () => failedOutput) };
});

import { runJob } from '../src/engine/run-job.js';
import { getJob } from '../src/jobs/firestore.js';
import { grantCredits, consumeCredits, getBalance, listTransactions } from '../src/credits/store.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';

describe('run-job — a job that cannot finish is parked, not refunded', () => {
  beforeEach(() => __setProviderForTests('gemini-vertex', new MockLlmProvider()));

  it('holds the job for a decision, keeps the credits, and logs it as an incident', async () => {
    // Simulate the API gate: a credit was consumed for this job.
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 5 });
    await consumeCredits('fbizlab', 'u@x.com', 1, 'j2');
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(4);

    const lines: string[] = [];
    const l = vi.spyOn(console, 'log').mockImplementation((x) => void lines.push(String(x)));
    const e = vi.spyOn(console, 'error').mockImplementation((x) => void lines.push(String(x)));

    const params = getTemplate('florida-business-for-sale')!.paramsSchema.parse({ mode: 'essential', industry: 'Laundromats' }) as Record<string, unknown>;
    const result = await runJob({ jobId: 'j2', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params });

    l.mockRestore();
    e.mockRestore();
    const logs = lines.map((s) => { try { return JSON.parse(s); } catch { return {} as Record<string, unknown>; } });

    // Held, not failed: a job that could not be assembled is a decision waiting to
    // be made, not an outcome. Nothing in this system refunds on its own.
    expect(result.status).toBe('held');
    const job = (await getJob('j2'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.reason).toBe('run_failed');
    // The admin gets the real reason. `research-engine` is mocked wholesale here,
    // so the exact words come from this file's own fixture — asserting them proves
    // the string was copied, not that anything produced it. What only `run-job` can
    // do is CARRY the engine's error onto the hold, so that is what is checked:
    // the fixture's error, and nothing generic in its place.
    expect(job.hold?.detail).toBe(failedOutput.trace.error);
    expect(String(job.hold?.detail)).not.toMatch(/^Unknown|^Job /);

    // Credits untouched — an approval has to have something to spend, and the
    // refund is a call someone makes.
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(4);
    expect((await listTransactions('fbizlab', 'u@x.com', 10)).some((t) => t.type === 'refund')).toBe(false);

    // Logged at ERROR, bound to the ids, so it surfaces as an incident.
    const held = logs.find((x) => x.event === 'job.held');
    expect(held).toBeTruthy();
    expect(held!.severity).toBe('ERROR');
    expect(held!.jobId).toBe('j2');
  });
});
