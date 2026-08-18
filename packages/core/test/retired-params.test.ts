/**
 * What happens when a browser tab older than the deploy submits.
 *
 * `7a45269` removed `instructions` and `preferredSources` from the Florida model.
 * `paramsSchema` is a plain `z.object`, so those keys were STRIPPED in silence: the
 * request validated, the job ran without the buyer's words, and they were charged
 * for it — with nothing on any screen saying the text had been dropped. A deployed
 * SPA is a static bundle; every tab open at deploy time keeps posting the old shape,
 * and this is a form people leave open (round 7, R7-8).
 */
import { describe, it, expect } from 'vitest';
import { validateRequest } from '../src/index.js';

const base = { industry: 'laundromats', location: 'Miami-Dade County, FL' };
const req = (params: Record<string, unknown>) => ({ template: 'florida-business-for-sale', params });

describe('a request from a bundle older than the deploy', () => {
  it('is refused with something the buyer can act on, not stripped and charged', () => {
    // Mutation that reds this: delete the `RETIRED_PARAMS` check in `validateRequest`.
    expect(() => validateRequest(req({ ...base, instructions: 'Focus on absentee-run stores.' })))
      .toThrow(/no longer accepts free-text instructions.*reload/i);
    expect(() => validateRequest(req({ ...base, preferredSources: ['bizbuysell.com'] })))
      .toThrow(/preferred-sources list.*reload/i);
  });

  it('says THAT before it complains about anything else', () => {
    // The old form has no industry rule, so its request also trips today's
    // `superRefine`. Pointing the buyer at a field their form does not have, while
    // the actual problem is that their page is stale, is the worse of the two.
    expect(() => validateRequest(req({ location: 'Miami-Dade County, FL', instructions: 'x' })))
      .toThrow(/no longer accepts free-text instructions/i);
  });

  it('lets a current request through untouched', () => {
    // The control: the guard must not reject what the live form sends.
    const out = validateRequest(req({ ...base, keywords: ['absentee owner'] }));
    expect(out.params.industry).toBe('laundromats');
    expect(out.params.keywords).toEqual(['absentee owner']);
  });

  it('still ignores an unknown key that was never ours — no `.strict()`', () => {
    // Tooling round-trips stored params; a blanket rejection of extra keys would
    // 400 an admin retry of an old job. Only the two RETIRED names are refused.
    const out = validateRequest(req({ ...base, someFutureField: 'x' }));
    expect(out.params.someFutureField).toBeUndefined();
    expect(out.params.industry).toBe('laundromats');
  });
});
