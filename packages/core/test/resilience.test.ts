import { describe, it, expect } from 'vitest';

import { vi } from 'vitest';
vi.mock('../src/tools/web-search.js', () => ({
  // The engine asks the search module what a call costs, so a mock of it must
  // answer too. Free here: these tests assert behaviour, not spend.
  searchCostPerCall: () => 0,
  searchWeb: async () => [{ title: 't', url: `https://x.com/${Math.random()}`, snippet: 's' }],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'page' })),
}));

import { runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';
import { config } from '../src/config.js';

const template = getTemplate('florida-business-for-sale')!;
const params = () => template.paramsSchema.parse({ industry: 'x', mode: 'essential' }) as Record<string, unknown>;

/** Mock that returns invalid JSON for sections matching `key` for the first `fails` generate calls. */
function failingMock(key: string, fails: number): MockLlmProvider {
  const mock = new MockLlmProvider();
  const base = mock.generate.bind(mock);
  let count = 0;
  mock.generate = async (opts) => {
    if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes(key) && count < fails) {
      count++;
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
  return mock;
}

describe('resilience — per-step retry, resume, degrade', () => {
  it('retries a failing agent (backoff) and completes without degrading', async () => {
    // Fail both internal calls of attempt 1 (repair too), succeed on agent attempt 2.
    __setProviderForTests('gemini-vertex', failingMock('market_overview', 2));
    const out = await runResearch({ template, params: params(), jobId: 'r1', generatedAt: 't' });
    expect(out.trace.status).toBe('completed');
    expect(out.meta.degradedSections).toBeUndefined();
    const ma = out.trace.agents.find((a) => a.id === 'market-analyst')!;
    expect(ma.status).toBe('ok');
    expect(ma.attempts).toBe(2); // one retry
    expect(ma.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns INCOMPLETE (checkpoint) when a step keeps failing and finalize is off', async () => {
    __setProviderForTests('gemini-vertex', failingMock('market_overview', 999));
    const out = await runResearch({ template, params: params(), jobId: 'r2', generatedAt: 't', finalize: false });
    expect(out.trace.status).toBe('incomplete');
    expect(out.checkpoint.doneAgentIds.length).toBeGreaterThan(0); // independent agents finished
    expect(out.checkpoint.doneAgentIds).not.toContain('market-analyst');
    expect(out.checkpoint.report).toHaveProperty('shortlist'); // deal-scout's output checkpointed
  });

  it('RESUMES from a checkpoint and completes, skipping already-done agents', async () => {
    __setProviderForTests('gemini-vertex', failingMock('market_overview', 999));
    const first = await runResearch({ template, params: params(), jobId: 'r3', generatedAt: 't', finalize: false });
    expect(first.trace.status).toBe('incomplete');

    // API recovers: healthy mock, resume with finalize.
    __setProviderForTests('gemini-vertex', new MockLlmProvider());
    const second = await runResearch({ template, params: params(), jobId: 'r3', generatedAt: 't', resume: first.checkpoint, finalize: true });

    expect(second.trace.status).toBe('completed');
    expect(second.meta.degradedSections).toBeUndefined();
    expect(Object.keys(second.report)).toHaveLength(12); // full essential report

    // The trace covers the WHOLE job, not just this dispatch: every agent appears
    // exactly once, whichever dispatch ran it. An agent that re-ran must replace
    // its checkpointed entry, never sit next to it as a second, stale row.
    const ids = second.trace.agents.map((a) => a.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]); // no duplicates
    expect(second.trace.agents.every((a) => a.status === 'ok')).toBe(true);

    // deal-scout succeeded in run 1, so run 2 skipped it: its entry is the one
    // restored from the checkpoint, which carries no output (slimmed when saved).
    // market-analyst was the failing one, so run 2 really did execute it.
    const scout = second.trace.agents.find((a) => a.id === 'deal-scout')!;
    const analyst = second.trace.agents.find((a) => a.id === 'market-analyst')!;
    expect(scout.output).toBeUndefined(); // carried over, not re-run
    expect(analyst.output).toBeDefined(); // ran in this dispatch
    expect(second.report).toHaveProperty('shortlist'); // …and run 1's work survived
  });

  it('charges failed attempts, not just the ones that worked', async () => {
    // The most expensive jobs in the system are the ones that retry and degrade:
    // every failed attempt still ran its whole research loop and its synthesis
    // calls. Booking cost only on the success path made those jobs report ~$0,
    // which meant no dashboard could see the money and no fix could be measured.
    __setProviderForTests('gemini-vertex', failingMock('market_overview', 999));
    const out = await runResearch({ template, params: params(), jobId: 'r5', generatedAt: 't', finalize: true });

    const analyst = out.trace.agents.find((a) => a.id === 'market-analyst')!;
    expect(analyst.status).toBe('failed');
    expect(analyst.attempts).toBe(config.workflow.agentMaxAttempts); // it tried, and paid, every time
    expect(analyst.cost.outputTokens).toBeGreaterThan(0);
    expect(analyst.cost.usd).toBeGreaterThan(0);

    // …and that spend reaches the job total, which is what anyone actually reads.
    const summed = out.trace.agents.reduce((n, a) => n + a.cost.usd, 0);
    expect(out.trace.cost.usd).toBeGreaterThanOrEqual(summed - 1e-9);
    expect(out.meta.cost.usd).toBeGreaterThan(0);
  });

  it('DEGRADES + WARNS after exhausting retries on the final attempt', async () => {
    __setProviderForTests('gemini-vertex', failingMock('market_overview', 999));
    const out = await runResearch({ template, params: params(), jobId: 'r4', generatedAt: 't', finalize: true });
    expect(out.trace.status).toBe('completed'); // deliver the rest
    expect(out.meta.degradedSections).toContain('market_overview');
    expect(out.trace.warnings?.some((w) => w.includes('market-analyst'))).toBe(true);
    expect(out.trace.durationMs).toBeGreaterThanOrEqual(0);
  });
});
