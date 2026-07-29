/**
 * Cost accounting: the invariants that keep the number honest in both directions.
 *
 * Under-counting hides money — that was the original bug. Over-counting is just as
 * bad and easier to reintroduce: the sink and the old returned totals were two
 * accumulators for the same spend, and adding them together would double every
 * agent's cost with the rest of the suite still green. Both directions are pinned
 * here, and the token assertions are ABSOLUTE — an equality between two sides that
 * a bug doubles symmetrically still holds, so equality alone proves very little.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';
import { createCostSink, emptyCost, llmCost, addCost } from '../src/cost.js';

const template = getTemplate('florida-business-for-sale')!;
const params = () => template.paramsSchema.parse({ industry: 'x', mode: 'essential' }) as Record<string, unknown>;

/** Every mock call reports exactly this usage, which is what makes the sums absolute. */
const PER_CALL = { inputTokens: 200, outputTokens: 80 };

describe('CostSink', () => {
  it('accumulates and reports a running total', () => {
    const sink = createCostSink();
    expect(sink.total()).toEqual(emptyCost());
    sink.add(llmCost(100, 50, 1, 10));
    sink.add(llmCost(100, 50, 1, 10));
    const twice = addCost(llmCost(100, 50, 1, 10), llmCost(100, 50, 1, 10));
    expect(sink.total()).toEqual(twice);
  });

  it('keeps a snapshot stable after later additions', () => {
    const sink = createCostSink();
    sink.add(llmCost(100, 50, 1, 10));
    const snapshot = sink.total();
    sink.add(llmCost(999, 999, 1, 10));
    // `total()` returns a value, not a live handle — a caller that captured it
    // must not see it grow underneath them.
    expect(sink.total()).not.toEqual(snapshot);
    expect(snapshot.inputTokens).toBe(100);
  });
});

describe('the job total is the sum of its agents, and of the calls actually made', () => {
  let mock: MockLlmProvider;
  beforeEach(() => {
    mock = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', mock);
  });

  it('books every call exactly once on a single dispatch', async () => {
    const out = await runResearch({ template, params: params(), jobId: 'c1', generatedAt: 't' });
    const summed = out.trace.agents.reduce((n, a) => n + a.cost.usd, 0);

    // Equality, not `>=`: `>=` passes for ANY over-count, which is half of what this
    // test exists to catch. But equality alone is not enough either — wiring a
    // returned cost into BOTH `at.cost` and `trace.cost` (the shape this replaced)
    // doubles the two sides identically and slips through. The absolute token count
    // is what actually pins it: it is anchored to the number of provider calls, not
    // to another accumulator.
    expect(out.trace.cost.usd).toBeCloseTo(summed, 9);
    expect(mock.calls).toBeGreaterThan(0);
    expect(out.trace.cost.inputTokens).toBe(mock.calls * PER_CALL.inputTokens);
    expect(out.trace.cost.outputTokens).toBe(mock.calls * PER_CALL.outputTokens);

    const tokens = out.trace.agents.reduce((n, a) => n + a.cost.outputTokens, 0);
    expect(out.trace.cost.outputTokens).toBe(tokens);
  });

  it('keeps the sum intact across a resume, including the failed dispatch’s spend', async () => {
    // A resumed agent REPLACES its checkpointed trace row. The prior dispatch's
    // spend stays inside `trace.cost` regardless (it is carried in the checkpoint),
    // so a replacement that dropped the row's cost left the job total bigger than
    // the sum of its agents — money in the total, attributed to no one.
    const broken = new MockLlmProvider();
    const base = broken.generate.bind(broken);
    broken.generate = async (opts) => {
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('market_overview')) {
        return { text: 'not json', toolCalls: [], usage: PER_CALL };
      }
      return base(opts);
    };
    __setProviderForTests('gemini-vertex', broken);
    const first = await runResearch({ template, params: params(), jobId: 'c3', generatedAt: 't', finalize: false });
    const failedSpend = first.trace.agents.find((a) => a.id === 'market-analyst')!.cost.usd;
    expect(failedSpend).toBeGreaterThan(0);

    __setProviderForTests('gemini-vertex', new MockLlmProvider());
    const out = await runResearch({
      template, params: params(), jobId: 'c3', generatedAt: 't',
      resume: first.checkpoint, finalize: true,
    });

    const summed = out.trace.agents.reduce((n, a) => n + a.cost.usd, 0);
    expect(out.trace.cost.usd).toBeCloseTo(summed, 9);
    // …and the re-run agent still owns what its failed attempts cost last dispatch.
    const analyst = out.trace.agents.find((a) => a.id === 'market-analyst')!;
    expect(analyst.cost.usd).toBeGreaterThan(failedSpend);
  });

  it('counts the search calls it actually made, at the fixture’s own rates', async () => {
    const out = await runResearch({ template, params: params(), jobId: 'c2', generatedAt: 't' });
    // The fake web charges a real, per-operation rate, so searchUsd is not silently
    // zero the way it is under the other engine tests' `() => 0` stubs.
    expect(out.trace.cost.searchCalls).toBeGreaterThan(0);
    expect(out.trace.cost.searchUsd).toBeGreaterThan(0);
    expect(out.trace.cost.usd).toBeCloseTo(out.trace.cost.llmUsd + out.trace.cost.searchUsd, 9);
  });
});
