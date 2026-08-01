/**
 * What a degraded report must never do to the work that DID succeed (G1, G2).
 *
 * Two defects, both reaching a paying customer without a single warning:
 *
 *   1. The finalize loop degraded `produces` AND `enriches` for every unfinished
 *      agent, with no check that the section already held real content. Those key
 *      sets overlap — a producer writes a section, a refiner improves it — so an
 *      unfinished refiner replaced its producer's delivered section with a
 *      placeholder, and a still-pending producer overwrote content a refiner had
 *      just written. The job completed green either way.
 *   2. The placeholder itself satisfies the schema, which means it INVENTS: a
 *      required enum became its first value, a required number became 0. For a
 *      buy/hold/avoid field that renders as a recommendation, with a price of zero,
 *      to someone who paid for investment research.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { installMockProvider } from './mocks/llm.js';
import type { ResearchTemplate } from '../src/templates/types.js';

/** A producer and a refiner that improves the producer's section in place. */
const enrichTemplate: ResearchTemplate<Record<string, unknown>> = {
  id: 'degrade-enrich', name: 'Enrich', description: 'x', version: 1,
  basePrompt: 'Be useful.',
  paramsSchema: z.object({}),
  sections: [
    { key: 'base', title: 'Base', guidance: 'Write it.', schema: z.object({ text: z.string() }) },
    { key: 'extra', title: 'Extra', guidance: 'Write it.', schema: z.object({ text: z.string() }) },
  ],
  agents: [
    { id: 'producer', role: 'producer', objective: 'Produce.', produces: ['base'], researchBudget: 1 },
    { id: 'refiner', role: 'producer', objective: 'Refine.', produces: ['extra'], enriches: ['base'], dependsOn: ['producer'], researchBudget: 1 },
  ],
  buildBrief: () => 'Find things.',
};

/**
 * Fails the ONE agent whose owned sections are exactly `owned`, and writes real
 * content for everyone else.
 *
 * Matching on "contains this key" is not enough here, and getting that wrong hides
 * the very thing under test: an enricher's write carries its producer's key too,
 * so a contains-match fails both agents and the report degrades for the ordinary
 * reason instead of the one being tested.
 */
function failingOn(...owned: string[]) {
  const target = [...owned].sort().join(',');
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (!opts.responseSchema) return base(opts);
    const keys = Object.keys((opts.responseSchema as { properties?: object }).properties ?? {});
    const sections = keys.filter((k) => !k.startsWith('_')).sort().join(',');
    if (sections === target) {
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    const value = JSON.parse((await base(opts)).text) as Record<string, unknown>;
    for (const k of keys) if (k !== '_handoff') value[k] = { text: `REAL ${k}` };
    return { text: JSON.stringify(value), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  };
}

describe('degradation never overwrites work that succeeded', () => {
  it('keeps the producer’s section when its refiner fails', async () => {
    // The frequent direction: one enricher still failing at the finalize pass is
    // enough, and the flagship template has four enrich edges.
    failingOn('extra', 'base');
    const out = await runResearch({ template: enrichTemplate, params: {}, jobId: 'g1a', generatedAt: 't' });

    expect(JSON.stringify(out.report.base)).toContain('REAL base');
    expect(out.meta.degradedSections ?? []).not.toContain('base');
    expect(out.meta.degradedSections ?? []).toContain('extra');
  });

  it('keeps the refiner’s section when the producer failed', async () => {
    // The mirror image: the refiner runs best-effort at finalize, is schema-forced
    // to emit the enriched key, and writes real content — which the still-pending
    // producer then buried.
    failingOn('base');
    const out = await runResearch({ template: enrichTemplate, params: {}, jobId: 'g1b', generatedAt: 't' });

    const base = JSON.stringify(out.report.base);
    expect(base).toContain('REAL base');
    expect(out.meta.degradedSections ?? []).not.toContain('base');
  });

  it('still degrades a section nothing wrote, and still warns either way', async () => {
    failingOn('extra', 'base');
    const out = await runResearch({ template: enrichTemplate, params: {}, jobId: 'g1c', generatedAt: 't' });

    expect(JSON.stringify(out.report.extra)).toMatch(/could not complete/i);
    // The admin still learns the step never finished, and that the section it
    // shares with the producer survived it.
    const warnings = (out.trace.warnings ?? []).join(' ');
    expect(warnings).toMatch(/refiner/);
    expect(warnings).toMatch(/kept, already written: base/);
  });
});

// --- G2: the placeholder must not invent -------------------------------------

const verdictTemplate: ResearchTemplate<Record<string, unknown>> = {
  id: 'degrade-verdict', name: 'Verdict', description: 'x', version: 1,
  basePrompt: 'Be useful.',
  paramsSchema: z.object({}),
  sections: [
    {
      key: 'verdict', title: 'Verdict', guidance: 'Judge it.',
      schema: z.object({
        recommendation: z.enum(['buy', 'hold', 'avoid']),
        // The shapes a real report uses for "we may have no figure".
        price: z.number().nullable(),
        confidence: z.union([z.number(), z.null()]),
        summary: z.string(),
        notes: z.string(),
      }),
    },
  ],
  agents: [{ id: 'judge', role: 'producer', objective: 'Judge.', produces: ['verdict'], researchBudget: 1 }],
  buildBrief: () => 'Judge things.',
};

describe('a degraded section does not invent findings', () => {
  it('leaves every nullable field null instead of zero', async () => {
    failingOn('verdict');
    const out = await runResearch({ template: verdictTemplate, params: {}, jobId: 'g2a', generatedAt: 't' });

    const v = out.report.verdict as Record<string, unknown>;
    expect(out.meta.degradedSections).toContain('verdict');
    // A zero price on a business listing is a finding, not an absence.
    expect(v.price).toBeNull();
    expect(v.confidence).toBeNull();
  });

  it('says so in every text field, not just the first', async () => {
    failingOn('verdict');
    const out = await runResearch({ template: verdictTemplate, params: {}, jobId: 'g2b', generatedAt: 't' });

    const v = out.report.verdict as Record<string, string>;
    // One apology plus a blank reads as a section that came back empty.
    expect(v.summary).toMatch(/could not complete/i);
    expect(v.notes).toMatch(/could not complete/i);
  });

  it('is named in the metadata, which is what a client keys on', async () => {
    failingOn('verdict');
    const out = await runResearch({ template: verdictTemplate, params: {}, jobId: 'g2c', generatedAt: 't' });

    // A required non-nullable enum still has to hold SOMETHING for the report to
    // validate, so the schema cannot carry the whole guarantee — the consumer has
    // to be told which sections to suppress, and this is that contract.
    expect(out.meta.degradedSections).toEqual(['verdict']);
  });
});
