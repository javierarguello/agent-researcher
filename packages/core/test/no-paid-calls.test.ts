/**
 * The suite cannot spend money. Proven, not promised.
 *
 * Every other test in this repo installs its own stub. That was a convention, and
 * a convention is exactly what a new file forgets — at which point it instantiates
 * the real Vertex client and bills a live model, with nothing failing to say so.
 * Cloud Storage had this same shape until the API suite was caught writing
 * report.json to the real dev bucket.
 */
import { describe, it, expect } from 'vitest';

import { config } from '../src/config.js';
import { resolveModel } from '../src/llm/index.js';
import { installMockProvider } from './mocks/llm.js';

describe('a test that forgets its stub fails instead of paying', () => {
  it('refuses a call to the paid provider, and says why', async () => {
    // The global setup leaves this installed; nothing in this file replaces it.
    const model = resolveModel('pro');
    await expect(model.provider.generate({ system: '', messages: [], model: model.model })).rejects.toThrow(
      /paid provider/i,
    );
  });

  it('lets a test that DOES install a stub through', async () => {
    installMockProvider();
    const model = resolveModel('pro');
    const res = await model.provider.generate({ system: '', messages: [], model: model.model });
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('has no search credentials either, so no test can reach a search backend', () => {
    // The web is mocked per-file, but the guarantee should not rest on that: with
    // no keys, `searchWeb`/`extractPages` cannot call a backend even if a file
    // forgets its mock.
    expect(config.search.tavilyApiKey).toBe('');
    expect(config.search.braveApiKey).toBe('');
  });
});
