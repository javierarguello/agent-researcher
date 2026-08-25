/**
 * The sentence the buyer confirms against, when they accept what the assist read
 * out of their own words.
 *
 * Round 11, `confirm-sentence-1`. The buyer's app cannot re-render this sentence:
 * it is a static SPA that consumes the API and has no copy of `describePlan`. So it
 * narrowed the sentence itself, by replacing the field's manifest DEFAULT with the
 * accepted value — which requires the summary to contain the default verbatim, and
 * no shipped model's does. `florida-business-for-sale` defaults location to
 * 'State of Florida, USA' and renders it as 'the State of Florida'. Nothing ever
 * matched, in any of the four languages, so a buyer who left location blank, typed
 * "una lavandería en Hialeah" and ticked the proposal read "currently for sale in
 * the State of Florida" on the last screen before their credits were spent.
 *
 * `runPreflight` had NO test of any kind before this file — which is how a client
 * came to depend on a narrowing that never happened.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/moderation/enrich.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/moderation/enrich.js')>();
  return {
    ...actual,
    // No model in this file: the assisted pass is what we are placing a value into,
    // not what we are testing, and `test/no-paid-calls.ts` would refuse it anyway.
    enrichRequest: async () => ({ corrections: [], issueCodes: [], quality: 'ok' as const }),
    proposeFromText: async () => ({
      proposals: { directives: {}, keywords: [], basics: { location: 'Hialeah, FL' } },
    }),
  };
});

import { runPreflight } from '../src/moderation/preflight.js';
import { getTemplate } from '../src/templates/registry.js';

const florida = getTemplate('florida-business-for-sale')!;

describe('preflight — the sentence for a request whose basics were accepted', () => {
  it('renders one WITH the accepted basic, because the client cannot', async () => {
    // Location left empty, so the schema default fills it: statewide.
    const params = florida.paramsSchema.parse({ industry: 'laundromats', mode: 'essential' }) as Record<string, unknown>;
    expect(params.location, 'the default this whole finding turns on').toBe('State of Florida, USA');

    const out = await runPreflight({
      template: florida,
      params,
      lang: 'en',
      modeLabel: 'Essential',
      assist: 'on',
      freeText: 'una lavandería en Hialeah',
    });

    // The summary is the request as the buyer TYPED it — that is deliberate and
    // R7-9/R7-25 are about why. It renders the localized phrase, never the default.
    expect(out.summary).toContain('State of Florida');
    expect(out.summary, 'this is the string the client used to look for').not.toContain('State of Florida, USA');

    // …and the sentence for the request they would be confirming, if they tick it.
    expect(out.proposedSummary, 'the client has nothing to show but a stale sentence').toBeTruthy();
    expect(out.proposedSummary).toContain('Hialeah');
    // Not merely mentioning the new value: no longer asserting the old scope.
    expect(out.proposedSummary).not.toContain('State of Florida');
  });

  it('does not smuggle the basic into proposedParams, which a pre-basics client submits', async () => {
    // The invariant this fix must not break, and the reason the sentence cannot
    // simply be rendered from `proposedParams`: a basic is opt-in per field, so
    // `applyProposals` leaves it out unless asked, and `proposedParams` is what a
    // client that predates the basics row submits wholesale. Rendering the sentence
    // from it would have produced a summary identical to `summary` — the same dead
    // code as before, one layer down.
    const params = florida.paramsSchema.parse({ industry: 'laundromats', mode: 'essential' }) as Record<string, unknown>;
    const out = await runPreflight({
      template: florida, params, lang: 'en', modeLabel: 'Essential', assist: 'on',
      freeText: 'una lavandería en Hialeah',
    });

    expect(out.proposals?.basics?.location).toBe('Hialeah, FL');
    expect(out.proposedParams?.location, 'a basic rode proposedParams — it is opt-in').toBe('State of Florida, USA');
  });
});
