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
import { normalizeSectionStatuses } from '../src/engine/section-status.js';
import { LEGACY_SHAPES } from './fixtures/legacy-section-shapes.js';
import type { ResearchTemplate } from '../src/templates/types.js';
import type { Checkpoint } from '../src/engine/research-engine.js';

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

  it('does not claim everything else is complete when it is not', () => {
    // "Everything else is complete." was part of the lost sentence, so a report
    // with one of each said it and then, in the next sentence, said the opposite.
    // A buyer reading two contradictory claims trusts neither.
    const both = sectionsNotice('en', [{ status: 'lost' }, { status: 'unenriched' }]);
    expect(both).not.toMatch(/everything else is complete/i);
    expect(both, 'and still says both things').toMatch(/could not be completed/i);
    expect(both).toMatch(/did not finish/i);
  });

  it('still says it when it IS true', () => {
    // The control: deleting the sentence outright would pass the case above, and
    // "one section failed" with no reassurance reads worse than it is.
    expect(sectionsNotice('en', [{ status: 'lost' }])).toMatch(/everything else is complete/i);
    for (const [lang, re] of Object.entries({ es: /todo lo demás está completo/i, fr: /tout le reste est complet/i, pt: /todo o restante está completo/i })) {
      expect(sectionsNotice(lang, [{ status: 'lost' }]), lang).toMatch(re);
    }
  });

  it('calls a processing step a step, in every language', () => {
    // `la passe` is a sports pass and `a passagem` is a passageway. Neither is
    // what a French or Portuguese reader would call a stage of processing, and
    // both went out in the sentence that exists to reassure them.
    expect(sectionsNotice('fr', [{ status: 'unenriched' }])).toMatch(/l’étape/);
    expect(sectionsNotice('fr', [{ status: 'unenriched' }])).not.toMatch(/\bla passe\b/);
    expect(sectionsNotice('pt', [{ status: 'unenriched' }])).toMatch(/a etapa/);
    expect(sectionsNotice('pt', [{ status: 'unenriched' }])).not.toMatch(/passagem/);
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

describe('an unenriched section reaches the PDF whole', () => {
  // The mutation that proved this was missing: make the renderer suppress BOTH
  // statuses — `statuses.filter(x => x.status === 'lost')` → `statuses` — and the
  // whole suite stayed green. No test anywhere passed `unenriched` to a renderer,
  // so the one behaviour this status exists for was guarded by nothing: real,
  // paid-for, sourced content replaced by "we could not complete this section".
  const call = async (statuses: unknown) => {
    const { buildReportHtml } = await import('../src/pdf/report-html.js');
    const { getPdfTheme } = await import('../src/pdf/theme.js');
    return buildReportHtml({
      report: { market: { text: 'Laundromat demand in Miami-Dade grew 12% year over year.' } },
      sections: [{ key: 'market', title: 'Market' }],
      meta: { sections: statuses },
      lang: 'en',
      theme: getPdfTheme('fbizlab'),
    } as never);
  };

  it('keeps the body and does not apologise for it', async () => {
    const html = await call([{ key: 'market', status: 'unenriched' }]);
    expect(html, 'the work the buyer paid for').toContain('grew 12% year over year');
    expect(html, 'the apology belongs to `lost` alone').not.toMatch(/could not complete this section/i);
  });

  it('still says the depth pass did not finish', async () => {
    // Keeping the body silently would be the old defect in reverse: full price,
    // less depth than the tier bought, and nothing said.
    const html = await call([{ key: 'market', status: 'unenriched' }]);
    expect(html).toMatch(/pass that adds extra depth/i);
  });

  it('suppresses the body when the same section is lost', async () => {
    // The control. Without it, "keeps the body" passes on a renderer that
    // suppresses nothing at all.
    const html = await call([{ key: 'market', status: 'lost' }]);
    expect(html).not.toContain('grew 12% year over year');
    expect(html).toMatch(/could not complete this section/i);
  });
});

describe('what the renderers do with data written before this shape existed', () => {
  // `meta.degradedSections` and `checkpoint.degraded: string[]` are both still in
  // the stores: the worker re-renders a PDF from a saved `report.json` on demand,
  // and a job HELD before the rename keeps its checkpoint so an approval can
  // resume it. Neither matched `status === 'lost'`, so both rendered the
  // fabricated placeholder — and `sectionsNotice` returned '', so nothing was
  // said either. Fail-open, on the one contract that must fail closed.
  it.each(LEGACY_SHAPES)('$why', ({ args, expected }) => {
    expect(normalizeSectionStatuses(...args)).toEqual(expected);
  });

  it('puts the notice on the COVER, not only beside the section', async () => {
    // The artifact the buyer forwards. The per-section lines say what is missing
    // where; someone who opens the PDF without ever seeing the web page had no
    // way to know the dossier was incomplete at all.
    const { buildReportHtml } = await import('../src/pdf/report-html.js');
    const { getPdfTheme } = await import('../src/pdf/theme.js');
    const html = buildReportHtml({
      report: { market: { text: 'Real content.' } },
      sections: [{ key: 'market', title: 'Market' }],
      meta: { sections: [{ key: 'verdict', status: 'lost' }] },
      lang: 'es', theme: getPdfTheme('fbizlab'),
    } as never);
    expect(html).toContain('<div class="covernotice">');
    expect(html, 'in the buyer\u2019s language, like the rest of the page').toMatch(/no pudo completarse con fuentes confiables/i);
  });

  it('says nothing on the cover of a clean report', async () => {
    // The control: an empty notice must not render an empty box.
    const { buildReportHtml } = await import('../src/pdf/report-html.js');
    const { getPdfTheme } = await import('../src/pdf/theme.js');
    const html = buildReportHtml({
      report: { market: { text: 'Real content.' } },
      sections: [{ key: 'market', title: 'Market' }],
      meta: {}, lang: 'es', theme: getPdfTheme('fbizlab'),
    } as never);
    // The class name is always in the stylesheet; the DIV is what must not be there.
    expect(html).not.toContain('<div class="covernotice">');
  });

  it('suppresses a legacy degradedSections body in the PDF', async () => {
    const { buildReportHtml } = await import('../src/pdf/report-html.js');
    const { getPdfTheme } = await import('../src/pdf/theme.js');
    const html = buildReportHtml({
      report: { verdict: { recommendation: 'buy', price: 0, summary: 'ZZPLACEHOLDER' } },
      sections: [{ key: 'verdict', title: 'Verdict' }],
      meta: { degradedSections: ['verdict'] },
      lang: 'en',
      theme: getPdfTheme('fbizlab'),
    } as never);
    expect(html, 'the recommendation the engine never made').not.toContain('ZZPLACEHOLDER');
    expect(html).toMatch(/could not complete this section/i);
  });

  it('carries a pre-rename checkpoint into meta.sections as lost', async () => {
    // The held-job path, end to end: strings in, statuses out.
    installMockProvider();
    const out = await runResearch({
      template: tpl, params: {}, jobId: 'ss-legacy', generatedAt: 't',
      resume: { report: {}, sources: [], doneAgentIds: [], degraded: ['extra'] as never },
    } as never);
    expect(out.meta.sections).toContainEqual({ key: 'extra', status: 'lost' });
  });
});

// --- A section only an enricher ever wrote (R7-1) -----------------------------
//
// `unenriched` promises the buyer something specific: *a producer wrote this and
// the depth pass did not run*. Its copy says so in every language — "researched
// and written… complete and sourced as usual".
//
// With finalize-in-place, the second dispatch of a deterministic write failure
// runs the deferred steps best-effort — so an EXHAUSTED producer's enricher runs
// with `current = {}`, writes the section out of nothing, and `delivered` counted
// a done agent's `enriches` key, so the label said `unenriched`. Every clause of
// that copy was false: nothing researched it, the depth pass is the only thing
// that ran, and the body is sourced from nothing. Reproduced in review round 7
// (G2-break F1); all three flagship pairs reach it (charts, market_overview,
// deep_dives).
describe('a section its producer never wrote and an enricher did', () => {
  const dispatch = (jobId: string, resume?: Checkpoint) =>
    runResearch({ template: tpl, params: {}, jobId, generatedAt: 't', finalize: false, ...(resume ? { resume } : {}) });

  /** Producer exhausted on two dispatches; the refiner's own write is valid. */
  const twoDispatches = async (jobId: string) => {
    failingOn('base');
    const first = await dispatch(jobId);
    expect(first.trace.status, 'the premise: dispatch 1 asks to be resumed').toBe('incomplete');
    expect(first.checkpoint.writeFailures?.producer?.dispatches).toBe(1);
    failingOn('base');
    const second = await dispatch(jobId, first.checkpoint);
    // The premise of the whole case: the producer is given up on, nothing is
    // retryable, so the engine finalizes HERE and the refiner runs best-effort.
    expect(second.trace.status).toBe('completed');
    expect(second.trace.agents.find((a) => a.id === 'refiner')!.status).toBe('ok');
    return second;
  };

  it('is not labelled unenriched — no producer ever researched it', async () => {
    const out = await twoDispatches('r7-1a');
    const byKey = Object.fromEntries((out.meta.sections ?? []).map((x) => [x.key, x.status]));
    expect(byKey.base).toBe('reconstructed');
  });

  it('keeps the body: the enricher may have built it from real upstream sections', async () => {
    // The control on the naive fix (mark it `lost`). `chart-refiner` depends on
    // three agents and only one of them produces `charts`, so with the analyst
    // exhausted it still writes from the refined deep-dives and valuations that
    // ARE in the report. Blanking that would throw away real, paid-for work.
    const out = await twoDispatches('r7-1b');
    expect(JSON.stringify(out.report.base)).toContain('REAL base');
  });

  it('tells the admin which agent never delivered it', async () => {
    const out = await twoDispatches('r7-1c');
    expect(out.trace.warnings?.join('\n')).toMatch(/rebuilt by a later pass: base/);
  });

  it('still says unenriched when a producer DID write the section', async () => {
    // The control the other way: the ordinary shallow case must not be relabelled.
    failingOn('extra', 'base'); // the refiner fails; its producer wrote `base`
    const out = await runResearch({ template: tpl, params: {}, jobId: 'r7-1d', generatedAt: 't' });
    const byKey = Object.fromEntries((out.meta.sections ?? []).map((x) => [x.key, x.status]));
    expect(byKey.base).toBe('unenriched');
  });
});

describe('the notice for a reconstructed section', () => {
  it('does not claim it was researched and written', () => {
    const notice = sectionsNotice('en', [{ status: 'reconstructed' }]);
    expect(notice).not.toMatch(/researched and written/i);
    expect(notice).not.toMatch(/sourced as usual/i);
    expect(notice).toMatch(/did not finish/i);
  });

  it('counts separately from the other two, in every language', () => {
    const all = sectionsNotice('en', [{ status: 'lost' }, { status: 'unenriched' }, { status: 'reconstructed' }]);
    expect(all).toMatch(/could not be completed/i); // lost
    expect(all).toMatch(/researched and written/i); // unenriched
    for (const lang of ['en', 'es', 'fr', 'pt']) {
      expect(sectionsNotice(lang, [{ status: 'reconstructed' }]), lang).not.toBe('');
      expect(sectionsNotice(lang, [{ status: 'reconstructed' }]), lang).not.toBe(sectionsNotice(lang, [{ status: 'unenriched' }]));
    }
  });
});

describe('a reconstructed section in the PDF', () => {
  const call = async (statuses: unknown) => {
    const { buildReportHtml } = await import('../src/pdf/report-html.js');
    const { getPdfTheme } = await import('../src/pdf/theme.js');
    return buildReportHtml({
      report: { market: { text: 'Laundromat demand in Miami-Dade grew 12% year over year.' } },
      sections: [{ key: 'market', title: 'Market' }],
      meta: { sections: statuses },
      lang: 'en',
      theme: getPdfTheme('fbizlab'),
    } as never);
  };

  it('keeps the body and says the research step behind it never finished', async () => {
    const html = await call([{ key: 'market', status: 'reconstructed' }]);
    expect(html, 'the enricher’s work').toContain('grew 12% year over year');
    // The line BESIDE the section, not the cover notice: `/did not finish/` alone
    // is satisfied by the cover, so deleting the per-section line left 0 red.
    expect(html).toMatch(/researches this section did not finish/i);
    expect(html, 'the unenriched line would claim it was researched').not.toMatch(/pass that adds extra depth/i);
  });
});
