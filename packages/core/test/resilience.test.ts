import { describe, it, expect } from 'vitest';

import { vi } from 'vitest';
vi.mock('../src/tools/web-search.js', () => ({
  searchWeb: async () => [{ title: 't', url: `https://x.com/${Math.random()}`, snippet: 's' }],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'page' })),
}));

import { runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';

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
    const run2Agents = second.trace.agents.map((a) => a.id);
    expect(run2Agents).not.toContain('deal-scout'); // done in run 1 → skipped
    expect(run2Agents).toContain('market-analyst'); // was failing → retried in run 2
    expect(Object.keys(second.report)).toHaveLength(12); // full essential report
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
