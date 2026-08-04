/**
 * What the buyer is told when a section is shallower than the tier they bought.
 *
 * `meta.degradedSections` was a list of strings that could only say one thing:
 * this section is gone, suppress it. So the OTHER outcome — a producer wrote the
 * section and the refiner meant to deepen it never finished — had nowhere to be
 * recorded. It produced an admin warning and nothing else: a comprehensive report
 * whose four enrich passes all failed shipped as complete, at full price, with the
 * buyer never told.
 *
 * It is now `meta.sections`, one entry per section with something to report and a
 * `status` saying which. The two must never be conflated: hiding an `unenriched`
 * body would take away work the buyer paid for and replace it with an apology that
 * is not true.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { installMockProvider } from './mocks/llm.js';
import { sectionsNotice } from '../src/jobs/report-copy.js';
import type { ResearchTemplate } from '../src/templates/types.js';

/** A producer and a refiner that deepens the producer's section in place. */
const tpl: ResearchTemplate<Record<string, unknown>> = {
  id: 'status-enrich', name: 'Enrich', description: 'x', version: 1,
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

/** Fail the ONE agent whose owned sections are exactly `owned`. */
function failingOn(...owned: string[]) {
  const target = [...owned].sort().join(',');
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (!opts.responseSchema) return base(opts);
    const keys = Object.keys((opts.responseSchema as { properties?: object }).properties ?? {});
    const sections = keys.filter((k) => !k.startsWith('_')).sort().join(',');
    if (sections === target) return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    const value = JSON.parse((await base(opts)).text) as Record<string, unknown>;
    for (const k of keys) if (k !== '_handoff') value[k] = { text: `REAL ${k}` };
    return { text: JSON.stringify(value), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  };
}

describe('a section that was written but never deepened', () => {
  it('is recorded as unenriched, not lost', async () => {
    // The refiner fails; its producer already wrote `base`.
    failingOn('extra', 'base');
    const out = await runResearch({ template: tpl, params: {}, jobId: 'ss1', generatedAt: 't' });

    const byKey = Object.fromEntries((out.meta.sections ?? []).map((x) => [x.key, x.status]));
    expect(byKey.base, 'the section the refiner never got to').toBe('unenriched');
    expect(byKey.extra, 'the section nobody wrote').toBe('lost');
  });

  it('keeps its content — the buyer paid for it', async () => {
    // The whole reason `unenriched` is a separate status: suppressing this body
    // would replace real, sourced work with an apology that is false.
    failingOn('extra', 'base');
    const out = await runResearch({ template: tpl, params: {}, jobId: 'ss2', generatedAt: 't' });
    expect(JSON.stringify(out.report.base)).toContain('REAL base');
  });

  it('says nothing at all when every step finished', async () => {
    installMockProvider();
    const out = await runResearch({ template: tpl, params: {}, jobId: 'ss3', generatedAt: 't' });
    expect(out.meta.sections ?? []).toEqual([]);
  });
});

describe('the notice tells the two apart', () => {
  it('does not claim a shallow section could not be completed', () => {
    // Counting both kinds together — which a single number forces you to do — would
    // tell a buyer a section "could not be completed" while it sits in front of
    // them, fully written. That is worse than the silence this replaced.
    const shallow = sectionsNotice('en', [{ status: 'unenriched' }]);
    expect(shallow).toMatch(/did not finish/i);
    expect(shallow).not.toMatch(/could not be completed/i);

    const lost = sectionsNotice('en', [{ status: 'lost' }]);
    expect(lost).toMatch(/could not be completed/i);
  });

  it('says both when both happened, and counts each', () => {
    const both = sectionsNotice('en', [
      { status: 'lost' }, { status: 'lost' },
      { status: 'unenriched' },
    ]);
    expect(both).toMatch(/^2 sections/);
    expect(both).toMatch(/One section .* did not finish/i);
  });

  it('is empty for a clean report', () => {
    expect(sectionsNotice('en', [])).toBe('');
  });

  it('speaks the buyer’s language', () => {
    for (const [lang, re] of Object.entries({ es: /profundidad/i, fr: /profondeur/i, pt: /profundidade/i })) {
      expect(sectionsNotice(lang, [{ status: 'unenriched' }]), lang).toMatch(re);
    }
  });
});
