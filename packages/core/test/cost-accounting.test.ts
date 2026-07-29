/**
 * Cost accounting: the invariants that keep the number honest in both directions.
 *
 * Under-counting hides money — that was the original bug. Over-counting is just as
 * bad and easier to reintroduce: the sink and the old returned totals were two
 * accumulators for the same spend, and adding them together would double every
 * agent's cost with the rest of the suite still green. Both directions are pinned
 * here.
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

describe('the job total is the sum of its agents — no more, no less', () => {
  beforeEach(() => {
    __setProviderForTests('gemini-vertex', new MockLlmProvider());
  });

  it('trace.cost equals the sum of agent costs on a single dispatch', async () => {
    const out = await runResearch({ template, params: params(), jobId: 'c1', generatedAt: 't' });
    const summed = out.trace.agents.reduce((n, a) => n + a.cost.usd, 0);

    // Equality, not `>=`. A `>=` assertion passes for ANY over-count, which is the
    // failure this test exists to catch: restore the cost that `runAgent` used to
    // return, add it alongside the sink's, and every agent doubles.
    expect(out.trace.cost.usd).toBeCloseTo(summed, 9);
    expect(out.meta.cost).toEqual(out.trace.cost);

    const tokens = out.trace.agents.reduce((n, a) => n + a.cost.outputTokens, 0);
    expect(out.trace.cost.outputTokens).toBe(tokens);
  });

  it('counts the search calls it actually made', async () => {
    const out = await runResearch({ template, params: params(), jobId: 'c2', generatedAt: 't' });
    // The fake web charges a real rate, so searchUsd is not silently zero the way
    // it is under the engine tests' `() => 0` stubs.
    expect(out.trace.cost.searchCalls).toBeGreaterThan(0);
    expect(out.trace.cost.searchUsd).toBeGreaterThan(0);
    expect(out.trace.cost.usd).toBeCloseTo(out.trace.cost.llmUsd + out.trace.cost.searchUsd, 9);
  });
});
