/**
 * What a broken search provider costs, and whether anyone can tell it happened.
 *
 * The turn and the charge are taken BEFORE the call — deliberately, since a
 * provider that accepted the request may well have billed it. What was wrong is
 * that the failure then went into a tool result and nowhere else: no note, no
 * log, nothing in the trace an admin reads. A degraded provider burned the whole
 * search budget and the whole estimated search spend on queries that all failed,
 * and the only evidence was a thin report.
 */
import { describe, it, expect, vi } from 'vitest';

const { RATE, web } = vi.hoisted(() => ({
  RATE: { search: 0.002, extract: 0.05 },
  /** Mutable: which call numbers fail. `null` = every one of them. */
  web: { failOn: null as Set<number> | null, calls: 0 },
}));

vi.mock('../src/tools/web-search.js', () => ({
  searchCostPerCall: (operation: 'search' | 'extract') => RATE[operation],
  canExtractPages: () => true,
  searchWeb: async () => {
    web.calls += 1;
    if (web.failOn === null || web.failOn.has(web.calls)) throw new Error('search backend unavailable');
    return [{ title: 'A listing', url: `https://a.example/${web.calls}`, snippet: 's' }];
  },
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'full text' })),
}));

import { gather, createEvidence } from '../src/engine/gather.js';
import { createCostSink } from '../src/cost.js';
import type { ResolvedModel } from '../src/llm/index.js';
import type { GenerateResult, LlmProvider } from '../src/llm/provider.js';

/** Asks for a search on every turn it is given, forever. */
class AlwaysSearches implements LlmProvider {
  readonly name = 'scripted';
  private n = 0;
  async generate(): Promise<GenerateResult> {
    this.n += 1;
    if (this.n > 12) return { text: 'done', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
    return {
      text: '',
      toolCalls: [{ id: `t${this.n}`, name: 'web_search', args: { query: `query ${this.n}` } }],
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }
}

const run = async (failOn: number[] | null, maxTurns = 10) => {
  web.failOn = failOn === null ? null : new Set(failOn);
  web.calls = 0;
  const notes: string[] = [];
  const spend = createCostSink();
  const model: ResolvedModel = { alias: 'gather', provider: new AlwaysSearches(), model: 'scripted', inPerM: 0, outPerM: 0 };
  const result = await gather({
    spend, model, system: 's', messages: [{ role: 'user', text: 'go' }],
    maxTurns, evidence: createEvidence(), onNote: async (m) => { notes.push(m); },
  });
  return { ...result, cost: spend.total(), notes, backendCalls: web.calls };
};

describe('a search provider that is down', () => {
  it('stops paying after three consecutive failures', async () => {
    // Ten turns of budget, a model that asks for a search every turn, and a
    // backend that never answers. Every one of those turns used to be charged and
    // spent: the full search budget and the full estimated search spend, on
    // nothing.
    const { cost, backendCalls } = await run(null, 10);

    expect(backendCalls, 'it kept calling a backend that had failed three times').toBe(3);
    expect(cost.searchUsd).toBeCloseTo(RATE.search * 3, 9);
    expect(cost.searchCalls).toBe(3);
  });

  it('leaves the research budget for something that can still work', async () => {
    // The turns matter as much as the dollars: a search we do not make must not
    // spend a turn the agent could use to fetch a page it already has a URL for.
    const { turns } = await run(null, 10);
    expect(turns, 'the budget was burned on a backend that was refusing').toBe(3);
  });

  it('says so in the trace, with the query and the reason', async () => {
    // The trace is what an admin reads to decide about a job. This was the most
    // expensive silently-swallowed catch in the job path — charged, failed, and
    // invisible.
    const { notes } = await run(null, 10);
    const failed = notes.filter((n) => /search failed/i.test(n));
    expect(failed).toHaveLength(3);
    expect(failed[0], 'the query that failed').toContain('query 1');
    expect(failed[0], 'and why').toContain('search backend unavailable');
  });

  it('forgets the failures as soon as one search works', async () => {
    // The control, and the reason this counts CONSECUTIVE failures rather than
    // total ones: bad queries spread across a long research loop are not a broken
    // provider, and cutting the agent off after them is a worse report for no
    // reason.
    //
    // The pattern matters. Two failures then success would pass on a counter that
    // never resets, because it never reaches three either way. This one fails
    // FIVE times in total — 1, 2, 4, 5, 7 — and never three in a row, so a total
    // counter trips on call 4 and a consecutive one never does.
    const { cost, backendCalls, turns } = await run([1, 2, 4, 5, 7], 10);

    expect(backendCalls, 'five failures, none of them three in a row').toBe(10);
    expect(cost.searchCalls).toBe(10);
    expect(turns).toBe(10);
  });
});
