/**
 * What `gather` actually charges, per tool call.
 *
 * `search-pricing.test.ts` proves the pricing FUNCTION answers correctly. This file
 * proves the research loop asks it the right question — the call site is where the
 * money moves, and it was executed by no test at all: the shared mocks return 0 for
 * every operation, and none of them ever issues `fetch_page`. So the whole extract
 * branch (which operation is priced, the empty-url guard, the free cached path)
 * could regress with the suite green.
 *
 * The two rates here are deliberately different and deliberately nonzero: a fixture
 * that prices both operations the same cannot tell an extraction booked at the
 * search rate from a correct one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted with the mock factory: the factory runs while `gather.js` is being
// imported, before any plain top-level const in this file exists.
const { RATE, web, PAGE } = vi.hoisted(() => ({
  RATE: { search: 0.002, extract: 0.05 },
  /** Mutable so a test can take the extract backend away. */
  web: { canExtract: true },
  PAGE: 'https://a.example/listing-1',
}));

vi.mock('../src/tools/web-search.js', () => ({
  searchCostPerCall: (operation: 'search' | 'extract') => RATE[operation],
  canExtractPages: () => web.canExtract,
  searchWeb: async () => [{ title: 'A listing', url: PAGE, snippet: 's' }],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'full text' })),
}));

import { gather, createEvidence } from '../src/engine/gather.js';
import { createCostSink } from '../src/cost.js';
import type { ResolvedModel } from '../src/llm/index.js';
import type { GenerateResult, LlmProvider } from '../src/llm/provider.js';

type Step = { name: string; args: Record<string, unknown> } | 'stop';

/** Plays a fixed sequence of tool calls, then stops. */
class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  private step = 0;
  constructor(private readonly script: Step[]) {}
  async generate(): Promise<GenerateResult> {
    const usage = { inputTokens: 10, outputTokens: 5 };
    const step = this.script[this.step++] ?? 'stop';
    if (step === 'stop') return { text: 'done', toolCalls: [], usage };
    return { text: '', toolCalls: [{ id: `t${this.step}`, name: step.name, args: step.args }], usage };
  }
}

/** Zero token prices, so `searchUsd` is the only thing moving in these assertions. */
const modelFor = (script: Step[]): ResolvedModel => ({
  alias: 'gather',
  provider: new ScriptedProvider(script),
  model: 'scripted',
  inPerM: 0,
  outPerM: 0,
});

const run = async (script: Step[]) => {
  const spend = createCostSink();
  const result = await gather({
    spend,
    model: modelFor(script),
    system: 's',
    messages: [{ role: 'user', text: 'go' }],
    maxTurns: 6,
    evidence: createEvidence(),
  });
  return { ...result, cost: spend.total() };
};

describe('gather charges per operation, and only for calls that happen', () => {
  beforeEach(() => {
    web.canExtract = true;
  });

  it('prices an extraction as an extraction, not as a search', async () => {
    const { cost, turns } = await run([
      { name: 'update_plan', args: { steps: [{ task: 'look', status: 'doing' }] } },
      { name: 'web_search', args: { query: 'laundromats' } },
      { name: 'fetch_page', args: { url: PAGE } },
      'stop',
    ]);

    // One search + one extraction, each at ITS OWN rate. Passing 'search' at the
    // fetch_page call site would make this 2 × 0.002; passing 'extract' at the
    // web_search one, 2 × 0.05.
    expect(cost.searchUsd).toBeCloseTo(RATE.search + RATE.extract, 9);
    expect(cost.searchCalls).toBe(2);
    expect(turns).toBe(2);
  });

  it('re-reading a page another agent already fetched is free, and costs no turn', async () => {
    const { cost, turns } = await run([
      { name: 'fetch_page', args: { url: PAGE } },
      { name: 'fetch_page', args: { url: PAGE } }, // same url — served from evidence
      'stop',
    ]);

    expect(cost.searchUsd).toBeCloseTo(RATE.extract, 9); // charged once, not twice
    expect(cost.searchCalls).toBe(1);
    expect(turns).toBe(1); // the cached read does not spend from the budget either
  });

  it('spends a turn but no money on an empty url', async () => {
    // The turn IS spent — that is the budget guard against a model looping on
    // fetch_page — but nothing reaches a backend, so booking spend would invent it.
    const { cost, turns } = await run([
      { name: 'fetch_page', args: { url: '   ' } },
      'stop',
    ]);

    expect(cost.searchUsd).toBe(0);
    expect(cost.searchCalls).toBe(0);
    expect(turns).toBe(1);
  });

  it('books nothing when extraction has no backend to reach', async () => {
    // Extraction is Tavily-or-nothing: without a key it refuses locally, without a
    // request. Counting it would report a backend call that never left the process.
    web.canExtract = false;
    const { cost, turns } = await run([
      { name: 'web_search', args: { query: 'laundromats' } },
      { name: 'fetch_page', args: { url: PAGE } },
      'stop',
    ]);

    expect(cost.searchUsd).toBeCloseTo(RATE.search, 9);
    expect(cost.searchCalls).toBe(1); // the search only
    expect(turns).toBe(2);
  });
});
