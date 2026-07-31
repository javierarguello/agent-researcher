/**
 * What a retry buys again, and what it should not (C2).
 *
 * An agent has two halves: a budgeted research loop that buys searches and page
 * bodies, and one structured call that writes the sections. The retry loop wraps
 * BOTH — so a write that failed re-ran the whole loop, buying fresh searches and
 * fresh fetches for evidence that was already paid for and still sitting in the
 * shared store. Three in-run attempts × eight dispatches made that up to 24
 * research loops for one agent.
 *
 * The cost ceiling bounds the damage in dollars; it does nothing about the waste,
 * and every dollar spent re-buying is a dollar not spent finishing the report.
 *
 * These tests count CALLS, not dollars: the point is what was bought, and a rate
 * that changes must not quietly change the meaning of the assertion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { web } = vi.hoisted(() => ({
  web: { searches: 0, fetches: 0 },
}));

vi.mock('../src/tools/web-search.js', () => ({
  searchCostPerCall: () => 0.01,
  canExtractPages: () => true,
  searchWeb: async (query: string) => {
    web.searches += 1;
    return [{ title: `Result for ${query}`, url: `https://example.com/${web.searches}`, snippet: 'snippet' }];
  },
  extractPages: async (urls: string[]) => {
    web.fetches += urls.length;
    return urls.map((url) => ({ url, ok: true, content: 'Full page content.' }));
  },
}));

import { runResearch, type Checkpoint } from '../src/engine/research-engine.js';
import { compactModel } from './fixtures/compact-model.js';
import { installMockProvider, MockLlmProvider } from './mocks/llm.js';

const params = () => compactModel.paramsSchema.parse({}) as Record<string, unknown>;

/** The scout's sections, i.e. the structured write we can make fail. */
const WRITES_FINDINGS = (schema: unknown) => JSON.stringify(schema).includes('findings');

/**
 * A provider whose structured WRITE fails `times` calls.
 *
 * Note the unit: `synthesizeStructured` already repairs once on its own, so TWO
 * failed calls is what it takes to fail an attempt and reach the engine's retry —
 * the thing under test here.
 */
function failingWrites(times: number): MockLlmProvider {
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  let failed = 0;
  mock.generate = async (opts) => {
    if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && failed < times) {
      failed += 1;
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
  return mock;
}

beforeEach(() => {
  web.searches = 0;
  web.fetches = 0;
});

describe('a retry after a failed WRITE does not re-buy the research', () => {
  it('runs the research loop once, however many times the write fails', async () => {
    installMockProvider();
    const clean = await runResearch({ template: compactModel, params: params(), jobId: 'w1', generatedAt: 't' });
    const oneLoop = web.searches;
    expect(clean.trace.status).toBe('completed');
    expect(oneLoop).toBeGreaterThan(0);

    web.searches = 0;
    failingWrites(2);
    const retried = await runResearch({ template: compactModel, params: params(), jobId: 'w2', generatedAt: 't' });

    // The second attempt reuses the evidence the first one bought. Re-running the
    // loop would not recover anything — it would go and buy more of the same.
    expect(retried.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBe(oneLoop);
  });

  it('still finishes the report, using the evidence already bought', async () => {
    failingWrites(2);
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w3', generatedAt: 't' });

    expect(out.trace.status).toBe('completed');
    expect(out.meta.degradedSections).toBeUndefined();
    expect(out.sources.length).toBeGreaterThan(0);
  });

  it('says so in the trace, so the saving is visible', async () => {
    failingWrites(2);
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w4', generatedAt: 't' });
    const notes = out.trace.agents.find((a) => a.id === 'scout')!.notes.join(' ');
    expect(notes).toMatch(/reusing evidence already gathered/i);
  });
});

describe('but a retry after a failed SEARCH still researches', () => {
  it('re-runs the loop when the loop itself threw', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let blown = false;
    mock.generate = async (opts) => {
      // Throw from a tool-calling turn: that is the research loop failing, not the
      // write. Recovery has to still mean "go and research".
      if (opts.tools?.length && !blown) {
        blown = true;
        throw new Error('provider blew up mid-loop');
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w5', generatedAt: 't' });

    expect(out.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBeGreaterThan(0); // it did research, on the retry
    expect(out.trace.status).toBe('completed');
  });

  it('re-runs the loop when the last pass found nothing at all', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let researching = false; // becomes true once the first attempt has given up
    let writes = 0;

    mock.generate = async (opts) => {
      // Attempt 1's whole research loop answers with prose and no tool calls, so
      // `gather` ends having spent no turns and bought nothing at all.
      if (opts.tools?.length && !researching) {
        return { text: 'Nothing to look up.', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && writes < 2) {
        writes += 1;
        // Two failed writes end attempt 1 (synthesize repairs once on its own).
        if (writes === 2) researching = true;
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w6', generatedAt: 't' });

    // Reusing "nothing" would hand the write an empty dossier for good. An empty
    // pass is not evidence, so it does not count as research already done.
    expect(out.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBeGreaterThan(0);
  });
});

describe('a re-dispatch does not re-download pages this job already has', () => {
  it('carries fetched page bodies in the checkpoint', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let fetched = false;
    mock.generate = async (opts) => {
      // The shared mock only ever searches; make one turn fetch a page too.
      if (opts.tools?.length && !fetched) {
        fetched = true;
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 'f1', name: 'fetch_page', args: { url: 'https://example.com/page-1' } }],
        };
      }
      return base(opts);
    };

    const first = await runResearch({ template: compactModel, params: params(), jobId: 'w7', generatedAt: 't' });
    expect(web.fetches).toBe(1);
    expect(first.checkpoint.extracted?.length).toBe(1);

    // Resume with the same page requested again: the shared cache answers it.
    web.fetches = 0;
    const mock2 = installMockProvider();
    const base2 = mock2.generate.bind(mock2);
    let again = false;
    mock2.generate = async (opts) => {
      if (opts.tools?.length && !again) {
        again = true;
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 'f1', name: 'fetch_page', args: { url: 'https://example.com/page-1' } }],
        };
      }
      return base2(opts);
    };

    const resume: Checkpoint = { ...first.checkpoint, doneAgentIds: [], report: {} };
    await runResearch({ template: compactModel, params: params(), jobId: 'w7', generatedAt: 't', resume });

    // A page fetch is the most expensive call in the loop. Carrying only `sources`
    // meant every resumed dispatch bought all of them again.
    expect(web.fetches).toBe(0);
  });

  it('bounds what it carries, so the checkpoint cannot grow without limit', async () => {
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: 'c' }));
    const resume = { report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [] } as Checkpoint;
    installMockProvider();

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w8', generatedAt: 't', resume });
    // It is written after every agent, so unbounded growth is a real cost of its own.
    expect(out.checkpoint.extracted!.length).toBeLessThanOrEqual(60);
  });
});
