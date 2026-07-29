/**
 * The REAL `searchCostPerCall`, deliberately in its own file.
 *
 * Every other engine test mocks `tools/web-search.js`, and a mock of it has to
 * supply this function too — so all of them exercise a hardcoded stub. Without
 * this file the real implementation is never executed by anything: delete its
 * body, return 0, and the whole suite stays green. That is how the bug it now
 * guards against shipped in the first place.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { config } from '../src/config.js';
import { canExtractPages, searchCostPerCall } from '../src/tools/web-search.js';

describe('search pricing follows the call, not the module', () => {
  const saved = {
    brave: config.search.braveApiKey,
    tavily: config.search.tavilyApiKey,
    braveRate: config.search.braveCostPerCallUsd,
    tavilyRate: config.search.costPerCallUsd,
  };
  // Distinct, nonzero sentinel rates. Neither price is set in the test env, so both
  // default to 0 — and an assertion that every branch returns 0 passes no matter
  // which branch ran.
  beforeEach(() => {
    config.search.braveCostPerCallUsd = 0.003;
    config.search.costPerCallUsd = 0.016;
  });
  afterEach(() => {
    config.search.braveApiKey = saved.brave;
    config.search.tavilyApiKey = saved.tavily;
    config.search.braveCostPerCallUsd = saved.braveRate;
    config.search.costPerCallUsd = saved.tavilyRate;
  });

  it('prices a search by whichever backend searchWeb would pick', () => {
    config.search.braveApiKey = 'k';
    config.search.tavilyApiKey = 'k';
    expect(searchCostPerCall('search')).toBe(0.003); // Brave wins the priority order

    config.search.braveApiKey = '';
    expect(searchCostPerCall('search')).toBe(0.016); // …then Tavily

    config.search.tavilyApiKey = '';
    expect(searchCostPerCall('search')).toBe(0); // keyless DuckDuckGo
  });

  it('prices an extraction as Tavily even when Brave serves the searches', () => {
    // The regression this catches: extraction is Tavily-only, so pricing it from
    // the search provider booked the genuinely-billed call at Brave's rate.
    config.search.braveApiKey = 'k';
    config.search.tavilyApiKey = 'k';
    expect(searchCostPerCall('extract')).toBe(0.016); // Tavily's rate, not Brave's
    expect(searchCostPerCall('extract')).not.toBe(searchCostPerCall('search'));
  });

  it('charges nothing for an extraction that cannot happen', () => {
    config.search.tavilyApiKey = ''; // extractPages refuses outright without it
    expect(searchCostPerCall('extract')).toBe(0);
    expect(canExtractPages()).toBe(false); // …and says so, so the caller can skip it
  });

  it('the fake web fixture still matches the module it stands in for', async () => {
    // Every engine test replaces this module wholesale, so a signature change is
    // invisible to the type system (mock factories are not checked against the real
    // exports) AND to the suite. It has already happened once: `searchCostPerCall`
    // gained an `operation` parameter and the fixture kept ignoring it, which is
    // precisely a fixture that cannot fail the way production would.
    const fake = (await import('./fixtures/fake-web.js')) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const real = (await import('../src/tools/web-search.js')) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['searchCostPerCall', 'canExtractPages', 'searchWeb', 'extractPages']) {
      expect(typeof fake[name], `${name} missing from the fixture`).toBe('function');
      expect(fake[name]!.length, `${name} arity drifted from the real module`).toBe(real[name]!.length);
    }
  });
});
