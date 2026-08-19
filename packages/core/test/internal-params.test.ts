/**
 * A param the ENGINE understands and no CLIENT may send.
 *
 * `keywords` is the first one. It is the last channel by which a buyer's own
 * prose reaches an agent's prompt: the free text they type is not a param and
 * never reaches the engine (`7a45269`), directive values come from a closed
 * vocabulary, and every other field is typed — but a keyword is a phrase the
 * buyer (or the assist, reading their notes) writes, and `buildBrief` renders it
 * into the brief verbatim. Javier, 2026-08-19: take it off the API and the SPA
 * for now, and keep it available internally in case we want it back.
 *
 * So this is NOT a retirement. The field stays in `paramsSchema`, the engine
 * still renders it, and a server-side caller — the local CLI, a future internal
 * job — still works exactly as before. What changes is that it is not published
 * in the manifest (so no client renders it), not proposed by the assist, and
 * refused with a message if a client sends it anyway.
 */
import { describe, it, expect } from 'vitest';
import { validateRequest } from '../src/index.js';
import { getTemplate, toManifest } from '../src/templates/registry.js';

const florida = getTemplate('florida-business-for-sale')!;
const req = (params: Record<string, unknown>) => ({ template: 'florida-business-for-sale', params });
const base = { industry: 'laundromats', location: 'Miami-Dade County, FL' };

describe('an internal param is not on the API', () => {
  it('refuses a request that sends it, and says what to do — never strips it in silence', () => {
    // The R7-8 rule: a param we drop without saying so is a job the buyer paid for
    // that did not read what they wrote. Every tab open at deploy time still posts
    // the keywords its assist proposed, so this is a live case on the day it ships.
    // Mutation that reds this: drop the internal-param check in `validateRequest`.
    expect(() => validateRequest(req({ ...base, keywords: ['absentee owner'] })))
      .toThrow(/keywords.*reload the page/i);
  });

  it('and says THAT before it complains about the schema', () => {
    // Same ordering as the retired-param check next to it: a stale bundle hears
    // "your page is old", not a validation error about a field it cannot show.
    expect(() => validateRequest(req({ keywords: ['absentee owner'] })))
      .toThrow(/keywords/i);
  });

  it('lets a current request through untouched', () => {
    // The control. Without it the guard passes on a rule that refuses everything.
    const out = validateRequest(req({ ...base, directives: { ownerInvolvement: 'absentee' } }));
    expect(out.params.industry).toBe('laundromats');
    expect(out.params.keywords, 'the schema default still applies').toEqual([]);
  });

  it('an empty array is still a client sending the field', () => {
    // `k in sent` — the same reasoning the retired check uses. A client that posts
    // `keywords: []` is a client that has the field on its form.
    expect(() => validateRequest(req({ ...base, keywords: [] }))).toThrow(/keywords/i);
  });
});

describe('an internal param is not in the manifest a client renders its form from', () => {
  it('is absent from the published paramsSchema, in every language', () => {
    // The manifest is the contract: `agent-researcher-frontend` builds the whole
    // form from it. Leaving the field in the schema while refusing it at the API
    // would render an input whose every submission is a 400.
    // Mutation that reds this: publish `z.toJSONSchema(t.paramsSchema)` unfiltered.
    for (const lang of ['en', 'es', 'fr', 'pt']) {
      const schema = toManifest(florida, lang).paramsSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(Object.keys(schema.properties ?? {}), lang).not.toContain('keywords');
      expect(schema.required ?? [], lang).not.toContain('keywords');
    }
  });

  it('and is absent from every paramsUi hint that names a field', () => {
    const ui = toManifest(florida).paramsUi!;
    expect(ui.advanced ?? []).not.toContain('keywords');
    expect(Object.keys(ui.fields ?? {})).not.toContain('keywords');
    expect((ui.rows ?? []).flat()).not.toContain('keywords');
    expect(ui.hidden ?? []).not.toContain('keywords');
  });

  it('but the ENGINE still has it — this is a hidden field, not a deleted one', () => {
    // The point of the exercise: `keywords` comes back by deleting one line from
    // `internalParams`, and until then a server-side caller keeps working.
    const parsed = florida.paramsSchema.safeParse({ ...base, keywords: ['absentee owner'] });
    expect(parsed.success, 'the schema still declares it').toBe(true);
    expect((parsed.data as { keywords: string[] }).keywords).toEqual(['absentee owner']);
    const brief = florida.buildBrief({ ...base, keywords: ['absentee owner'], mode: 'essential' } as never);
    expect(brief, 'and the brief still renders it').toContain('absentee owner');
  });
});
