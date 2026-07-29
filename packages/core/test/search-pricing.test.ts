/**
 * The REAL `searchCostPerCall`, deliberately in its own file.
 *
 * Every other engine test mocks `tools/web-search.js`, and a mock of it has to
 * supply this function too — so all of them exercise a hardcoded stub. Without
 * this file the real implementation is never executed by anything: delete its
 * body, return 0, and the whole suite stays green. That is how the bug it now
 * guards against shipped in the first place.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { config } from '../src/config.js';
import { searchCostPerCall } from '../src/tools/web-search.js';

describe('search pricing follows the call, not the module', () => {
  const keys = { brave: config.search.braveApiKey, tavily: config.search.tavilyApiKey };
  afterEach(() => {
    config.search.braveApiKey = keys.brave;
    config.search.tavilyApiKey = keys.tavily;
  });

  it('prices a search by whichever backend searchWeb would pick', () => {
    config.search.braveApiKey = 'k';
    config.search.tavilyApiKey = 'k';
    expect(searchCostPerCall('search')).toBe(config.search.braveCostPerCallUsd);

    config.search.braveApiKey = '';
    expect(searchCostPerCall('search')).toBe(config.search.costPerCallUsd);

    config.search.tavilyApiKey = '';
    expect(searchCostPerCall('search')).toBe(0); // keyless DuckDuckGo
  });

  it('prices an extraction as Tavily even when Brave serves the searches', () => {
    // The regression this catches: extraction is Tavily-only, so pricing it from
    // the search provider booked the genuinely-billed call at Brave's rate.
    config.search.braveApiKey = 'k';
    config.search.tavilyApiKey = 'k';
    expect(searchCostPerCall('extract')).toBe(config.search.costPerCallUsd);
    expect(searchCostPerCall('extract')).not.toBe(searchCostPerCall('search'));
  });

  it('charges nothing for an extraction that cannot happen', () => {
    config.search.tavilyApiKey = ''; // extractPages refuses outright without it
    expect(searchCostPerCall('extract')).toBe(0);
  });
});
