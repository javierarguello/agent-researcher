import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { listTemplates } from '../src/templates/registry.js';
import { validateTemplate } from '../src/templates/validate.js';
import { agentKind, hasResearchLoop } from '../src/templates/types.js';
import { planWaves } from '../src/engine/research-engine.js';
import { getTemplate, toManifest } from '../src/templates/registry.js';
import { sampleFromSchema } from './mocks/llm.js';

describe('templates', () => {
  it('all registered templates are valid', () => {
    for (const t of listTemplates()) {
      expect(validateTemplate(t)).toEqual([]);
    }
  });

  it('no agent is told a `focus` it can never read — the field is the research loop’s', () => {
    // `focus` is rendered by `buildAgentKickoff` and by nothing else, and only an
    // agent with a research loop gets a kickoff. Two synthesizers in the flagship
    // carried one for months — dead text, and one of them said the OPPOSITE of what
    // the shipped rewrite preamble said (round 7, R7-18). Generic, so a second model
    // cannot repeat it. Mutation that reds this: give a synthesizer a `focus`.
    for (const t of listTemplates()) {
      for (const a of t.agents) {
        if (!a.focus) continue;
        expect(hasResearchLoop(a), `${t.id}/${a.id} (${agentKind(a)}) declares a focus it never reads`).toBe(true);
      }
    }
  });

  it('…and an agent that DOES declare one reads it — every live `focus` reaches the kickoff (R8-13)', async () => {
    // The positive half, which `d1dab19` left out: deleting the `FOCUS:` line from
    // `buildAgentKickoff` left the suite 1071/1071 green, while eight of the
    // flagship's producers carry a live focus. Generic over the registry, so the
    // field cannot go dead for a second model either. Mutation that reds this: drop
    // `(agent.focus ? \`FOCUS: ...\` : '')` from `buildAgentKickoff`.
    const { buildAgentKickoff } = await import('../src/engine/prompt.js');
    let checked = 0;
    for (const t of listTemplates()) {
      for (const a of t.agents) {
        if (!a.focus) continue;
        checked += 1;
        const kickoff = buildAgentKickoff({ agent: a, brief: 'b', sections: [], maxTurns: 4, handoffs: {} });
        expect(kickoff, `${t.id}/${a.id}`).toContain(a.focus);
      }
    }
    expect(checked, 'the premise: the registry declares focuses to check').toBeGreaterThan(0);
  });

  it('what a synthesizer must know reaches the prompt it actually gets — through the section guidance', async () => {
    // The other half of moving those sentences: `guidance` is rendered by every
    // write builder, which is why it is the right home for an agent with no loop.
    // And it is where the contradiction gets reconciled — the engine's rewrite
    // preamble says "NEVER drop an item because you have nothing to add to it", the
    // section says when dropping one IS right. Both must be in the same prompt, or
    // the reconciliation is a comment nobody reads. Mutation that reds this: take
    // the rewrite rules out of the `charts` guidance.
    const { buildEnricherSynthPrompt } = await import('../src/engine/prompt.js');
    const t = getTemplate('florida-business-for-sale')!;
    const refiner = t.agents.find((a) => a.id === 'chart-refiner')!;
    const charts = t.sections.find((s) => s.key === 'charts')!;
    const p = buildEnricherSynthPrompt({
      agent: refiner, brief: 'b', sections: [charts],
      current: { charts: [{ title: 'Asking prices', type: 'bar', labels: ['A'], series: [[1]] }] },
      evidence: [], extracted: [], lang: 'en',
    } as never);

    expect(p, 'the engine’s rule').toContain('NEVER drop an item because you have nothing to add to it');
    expect(p, 'and the section’s, which qualifies it').toContain('Drop a chart ONLY when it is empty or its numbers are not in the report');
    expect(p).toContain('never because you have nothing to add to it');
  });

  it('the validator refuses one, and names the kind so the author knows why', () => {
    const t = getTemplate('florida-business-for-sale')!;
    const broken = { ...t, agents: t.agents.map((a) => (a.role === 'synthesizer' ? { ...a, focus: 'Prefer bar charts.' } : a)) };
    const errors = validateTemplate(broken as never);
    expect(errors.some((e) => /writer .* declares `focus`/.test(e))).toBe(true);
    expect(errors.some((e) => /refiner .* declares `focus`/.test(e)), 'a refiner with no loop, named as one').toBe(true);
  });

  it('…and refuses the other three loop-only fields for the same reason (R8-20)', () => {
    // `focus` was guarded and `sites`, `researchBudget` and `gatherModel` were not,
    // though all four are read inside `if (hasResearchLoop(agent))` and by nothing
    // else. `sites` is the one that repeats R7-18 exactly: it becomes "SUGGESTED
    // SOURCES (additive …)" in the kickoff, so a synthesizer declaring it ships a
    // DIRECTIVE that reaches no prompt — a template author's sentence that looks
    // obeyed and is not. Mutation that reds this: drop a field from the loop in
    // `validate.ts`.
    const t = getTemplate('florida-business-for-sale')!;
    const cases: Array<[string, Record<string, unknown>]> = [
      ['sites', { sites: ['bizbuysell.com'] }],
      ['researchBudget', { researchBudget: 24 }],
      ['gatherModel', { gatherModel: 'flash' }],
    ];
    for (const [field, extra] of cases) {
      const broken = { ...t, agents: t.agents.map((a) => (a.role === 'synthesizer' ? { ...a, ...extra } : a)) };
      const errors = validateTemplate(broken as never);
      expect(errors.some((e) => new RegExp(`declares \`${field}\``).test(e)), `${field} passed the validator`).toBe(true);
      // …and it names the kind, so the author is told what they built, not just
      // which key to delete.
      expect(errors.some((e) => new RegExp(`writer .* declares \`${field}\``).test(e)), `${field}: unnamed kind`).toBe(true);
    }
    // The control: the flagship as shipped declares none of them on a synthesizer.
    expect(validateTemplate(t)).toEqual([]);
  });

  it('florida waves are acyclic and cover all agents', () => {
    const t = getTemplate('florida-business-for-sale')!;
    const waves = planWaves(t);
    const flat = waves.flat();
    expect(new Set(flat).size).toBe(t.agents.length); // every agent scheduled once
    // …and scheduled ONCE. `new Set(...).size` is guaranteed by `remaining.delete`
    // whatever the layering does, so duplicating a wave — every agent dispatched
    // twice, the model spend doubled per job — passed the assertion above.
    expect(flat).toHaveLength(t.agents.length);
    expect(waves.length).toBeGreaterThan(1);
  });
});

describe('a template that declares a cover declares a coherent one', () => {
  it('names sections and fields the model actually has', () => {
    // Dropping the flagship's `cover` block left every test green: the renderers
    // simply produce no snapshot, which is the honest default for a model that
    // declares none and a silent regression for one that meant to.
    for (const t of listTemplates()) {
      if (!t.cover) continue;
      const keys = new Set(t.sections.map((x) => x.key));
      for (const from of t.cover.from) {
        expect(keys.has(from), `${t.id}: cover reads "${from}", which is not one of its sections`).toBe(true);
      }
      // Every figure that aggregates needs a field to aggregate.
      for (const fig of t.cover.figures ?? []) {
        if (fig.agg !== 'count') expect(fig.field, `${t.id}: ${fig.labelKey} has no field`).toBeTruthy();
      }
      expect(t.cover.nameKey.length).toBeGreaterThan(0);
    }
  });

  it('the flagship still declares one, and it reaches the manifest', () => {
    const t = getTemplate('florida-business-for-sale')!;
    expect(t.cover?.from, 'the cover the renderers key on').toContain('shortlist');
    expect(toManifest(t, 'en').cover?.nameKey).toBe(t.cover!.nameKey);
  });
});

describe('a localized template is localized in every language we publish', () => {
  const t = () => getTemplate('florida-business-for-sale')!;

  it('really translates the manifest, not only the directives', () => {
    // `i18n` had only `es` while the API published four languages, so a French
    // buyer got prose the engine wrote in French under English headings — on
    // screen, in the table of contents, and in the PDF bookmarks. The directive
    // block was translated, which is what made it look done.
    const en = toManifest(t(), 'en');
    for (const lang of ['es', 'fr', 'pt']) {
      const m = toManifest(t(), lang);
      expect(m.lang, lang).toBe(lang);
      // Asserted against the DECLARED translation, not against "differs from
      // English": `sources` is spelled the same in English and French, so a
      // difference test calls a correct translation a fallback. This checks the
      // thing that actually matters — that `toManifest` uses what the block says.
      const block = t().i18n![lang]!;
      for (const s of m.sections) expect(s.title, `${lang}/${s.key}`).toBe(block.sectionTitles![s.key]);

      // Every OTHER localizable surface, because the first version checked section
      // titles only — and `localizeParamsUi`, `buildSteps` and the add-on labels
      // could each be returned as `undefined` with the whole core suite green.
      expect(m.modes.map((x) => x.label), lang).toEqual(
        m.modes.map((x) => block.modeLabels![x.key as 'essential' | 'comprehensive']),
      );
      expect(m.name, lang).toBe(block.name);
      // Field help — the line under every input on the buyer's form.
      for (const [key, f] of Object.entries(block.fields ?? {})) {
        if (f.help) expect((m.paramsUi?.fields?.[key] as { help?: string } | undefined)?.help, `${lang}/${key}`).toBe(f.help);
      }
      // Workflow steps — what the buyer watches for the whole wait.
      for (const [id, a] of Object.entries(block.agentLabels ?? {})) {
        if (a.label) expect(m.steps.find((x) => x.id === id)?.label, `${lang}/${id}`).toBe(a.label);
      }
      for (const [key, a] of Object.entries(block.addonLabels ?? {})) {
        if (a.label) expect(m.addons.find((x) => x.key === key)?.label, `${lang}/${key}`).toBe(a.label);
      }
    }
  });

  it('reports the language it is actually in, not the one that was asked for', () => {
    // `lang` echoed the request unconditionally, so a model with no block for the
    // asked-for language answered `lang: 'pt'` with English throughout and a client
    // had no way to detect it and fall back deliberately. The API's `?lang` enum
    // stops that for the languages we publish; an English-only model is the case it
    // cannot see. The fix had no test at all.
    const englishOnly = { ...t(), i18n: undefined } as ReturnType<typeof t>;
    const m = toManifest(englishOnly, 'pt');
    expect(m.lang, 'it claimed to be Portuguese').toBe('en');
    expect(m.name).toBe(englishOnly.name);
  });

  it('is in ONE language, not a mixture', () => {
    // Steps and directives are translated globally, so building them from the
    // REQUEST while the model's own texts fell back to English produced a manifest
    // in two languages — and a `lang` field that was wrong about part of it
    // whichever value it took.
    const englishOnly = { ...t(), i18n: undefined } as ReturnType<typeof t>;
    const pt = toManifest(englishOnly, 'pt');
    const en = toManifest(englishOnly, 'en');

    expect(pt.steps.map((x) => x.label), 'the workflow steps stayed Portuguese').toEqual(en.steps.map((x) => x.label));
    expect(JSON.stringify(pt.directives), 'the directive block stayed Portuguese').toBe(JSON.stringify(en.directives));
  });

  it('and a model that DOES speak it answers in it — the control', () => {
    // Without this, "always fall back to English" passes both cases above.
    const pt = toManifest(t(), 'pt');
    expect(pt.lang).toBe('pt');
    const en = toManifest(t(), 'en');
    expect(pt.steps.map((x) => x.label)).not.toEqual(en.steps.map((x) => x.label));
    expect(JSON.stringify(pt.directives)).not.toBe(JSON.stringify(en.directives));
  });

  it('does not ship English in a block that claims to be a translation', () => {
    // The assertions above read the value from the same block they check, which is
    // honest about wiring and blind about content: filling `fr` with `TODO-fr-1`,
    // or with the English strings, satisfies every one of them. This is the content
    // anchor — a handful of words that must be there in each language, chosen
    // because they are the ones a buyer reads first.
    const anchors: Record<string, RegExp[]> = {
      es: [/Negocios en Venta/, /Resumen Ejecutivo/, /Esencial/],
      fr: [/Entreprises à Vendre/, /Synthèse/, /Essentiel/],
      pt: [/Negócios à Venda/, /Resumo Executivo/, /Essencial/],
    };
    for (const [lang, res] of Object.entries(anchors)) {
      const m = toManifest(t(), lang);
      const flat = JSON.stringify(m);
      for (const re of res) expect(flat, `${lang} is missing ${re}`).toMatch(re);
      // …and the English headline must NOT survive into a translated manifest.
      expect(m.name, lang).not.toMatch(/Florida Businesses for Sale/);
    }
  });

  it('refuses a template that speaks some of our languages and not others', () => {
    // The load-time check that stops this recurring. A half-translated template is
    // worse than an untranslated one: it advertises a language it does not deliver.
    const partial = { ...t(), i18n: { es: t().i18n!.es } } as typeof t extends () => infer R ? R : never;
    const errors = validateTemplate(partial);
    expect(errors.join(' ')).toMatch(/no "fr" block/);
    expect(errors.join(' ')).toMatch(/no "pt" block/);
  });

  it('refuses a language block that misses a section', () => {
    // The likelier regression: a section added later, and three translation blocks
    // that nobody updated. It falls back per string, so nothing looks broken.
    const t0 = t();
    const thin = {
      ...t0,
      i18n: { ...t0.i18n, fr: { ...t0.i18n!.fr, sectionTitles: { executive_summary: 'Synthèse' } } },
    } as typeof t0;
    expect(validateTemplate(thin).join(' ')).toMatch(/"fr" is missing section titles/);
  });

  it('refuses a language block that misses a cover label', () => {
    // The cover is the FIRST page of the artifact the buyer keeps, and its labels
    // were the one localized string with no reader: `CoverSpec.labelKey` is
    // documented as looked up in `TemplateI18n.cover` and nothing looked it up.
    // Both renderers fell back to their own dictionaries, which are filled with
    // THIS model's vocabulary in all four languages — so it looked right and the
    // next model to declare a cover printed `combinedSde` as a heading.
    const t0 = t();
    const { priceRange, ...rest } = t0.i18n!.es!.cover!;
    const thin = { ...t0, i18n: { ...t0.i18n, es: { ...t0.i18n!.es, cover: rest } } } as typeof t0;
    expect(validateTemplate(thin).join(' ')).toMatch(/"es" is missing cover labels: priceRange/);
  });

  it('refuses a mode that costs nothing, or a fraction of a credit (N11)', () => {
    // A mode is a PRICE. `credits: 0` compiles, validates, renders in the manifest
    // as free — and then 500s the buyer on submit, because `consumeCredits` reaches
    // the ledger's "positive whole numbers" guard, which throws something the route
    // does not recognise as an affordability problem and rethrows.
    //
    // The alternative (a free path through the credits gate) would be a pricing
    // decision nobody has made. Refusing it at load is the honest failure: it is a
    // deploy that does not start, not a stack trace on someone's first report.
    const t0 = t();
    for (const bad of [0, -3, 2.5]) {
      const priced = { ...t0, modes: { ...t0.modes, essential: { ...t0.modes!.essential!, credits: bad } } } as typeof t0;
      expect(validateTemplate(priced).join(' '), String(bad)).toMatch(/must be a positive whole number/);
    }
  });

  it('and a mode that declares no price at all is still fine — the control', () => {
    // `undefined` means "use the code default" (5/18), which is always positive.
    // A rule that also refused the default would refuse every unpriced model.
    const t0 = t();
    const { credits, ...essential } = t0.modes!.essential!;
    const unpriced = { ...t0, modes: { ...t0.modes, essential } } as typeof t0;
    expect(validateTemplate(unpriced)).toEqual([]);
  });

  it('and the flagship passes it — its cover speaks all four', () => {
    // The control. A rule nothing satisfies is a rule nobody notices breaking.
    expect(validateTemplate(t())).toEqual([]);
    for (const lang of ['es', 'fr', 'pt'] as const) {
      const labels = toManifest(t(), lang).coverLabels ?? {};
      expect(Object.keys(labels).length, lang).toBeGreaterThanOrEqual(7);
      expect(labels.priceRange, lang).toBeTruthy();
      expect(labels.priceRange, `${lang} is still the English word`).not.toBe('Price range');
    }
  });
});

describe('mock LLM sampleFromSchema', () => {
  it('produces schema-valid data for a nested Zod schema', () => {
    const schema = z.object({
      title: z.string(),
      price: z.number().nullable(),
      tags: z.array(z.string()).min(1),
      kind: z.enum(['a', 'b']),
      nested: z.object({ items: z.array(z.object({ n: z.number() })) }),
    });
    const sample = sampleFromSchema(z.toJSONSchema(schema) as Record<string, unknown>);
    expect(schema.safeParse(sample).success).toBe(true);
  });
});
