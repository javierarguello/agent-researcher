import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyCost } from '../src/cost.js';

vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
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

describe('run-job — a hard failure is recorded + credits refunded', () => {
  beforeEach(() => __setProviderForTests('gemini-vertex', new MockLlmProvider()));

  it('marks the job failed, refunds the consumed credit, and logs job.failed', async () => {
    // Simulate the API gate: credit was consumed for this job.
    await grantCredits({ appId: 'fbizlab', userId: 'u@x.com', credits: 5 });
    await consumeCredits('fbizlab', 'u@x.com', 1, 'j2');
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(4);

    const lines: string[] = [];
    const l = vi.spyOn(console, 'log').mockImplementation((x) => void lines.push(String(x)));
    const e = vi.spyOn(console, 'error').mockImplementation((x) => void lines.push(String(x)));

    const params = getTemplate('florida-business-for-sale')!.paramsSchema.parse({ mode: 'essential' }) as Record<string, unknown>;
    const result = await runJob({ jobId: 'j2', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params });

    l.mockRestore();
    e.mockRestore();
    const logs = lines.map((s) => { try { return JSON.parse(s); } catch { return {}; } });

    // Job doc records the failure.
    expect(result.status).toBe('failed');
    const job = (await getJob('j2'))!;
    expect(job.status).toBe('failed');
    expect(String(job.error)).toContain('schema validation');

    // Credit refunded (idempotent refund ledger entry).
    expect(await getBalance('fbizlab', 'u@x.com')).toBe(5);
    const ledger = await listTransactions('fbizlab', 'u@x.com', 10);
    expect(ledger.some((t) => t.type === 'refund' && t.jobId === 'j2')).toBe(true);

    // Failure logged at ERROR severity, bound to the ids.
    const jf = logs.find((x) => x.event === 'job.failed');
    expect(jf).toBeTruthy();
    expect(jf!.severity).toBe('ERROR');
    expect(jf!.jobId).toBe('j2');
  });
});
