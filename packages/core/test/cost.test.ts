import { describe, it, expect } from 'vitest';
import { emptyCost, addCost, llmCost, searchCost } from '../src/cost.js';

describe('cost accounting', () => {
  it('llmCost uses per-1M prices', () => {
    const c = llmCost(1_000_000, 1_000_000, 1.25, 10);
    expect(c.llmUsd).toBeCloseTo(11.25, 6);
    expect(c.usd).toBeCloseTo(11.25, 6);
    expect(c.inputTokens).toBe(1_000_000);
    expect(c.outputTokens).toBe(1_000_000);
  });

  it('searchCost multiplies calls by per-call price', () => {
    const c = searchCost(10, 0.016);
    expect(c.searchUsd).toBeCloseTo(0.16, 6);
    expect(c.searchCalls).toBe(10);
  });

  it('addCost sums every field', () => {
    const total = addCost(llmCost(100, 50, 1, 2), searchCost(3, 0.01));
    expect(total.inputTokens).toBe(100);
    expect(total.outputTokens).toBe(50);
    expect(total.searchCalls).toBe(3);
    expect(total.usd).toBeCloseTo(100 / 1e6 + (50 * 2) / 1e6 + 0.03, 6);
  });

  it('emptyCost is all zeros', () => {
    expect(addCost(emptyCost(), emptyCost())).toEqual(emptyCost());
  });
});
