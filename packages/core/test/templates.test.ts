import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { listTemplates } from '../src/templates/registry.js';
import { validateTemplate } from '../src/templates/validate.js';
import { planWaves } from '../src/engine/research-engine.js';
import { getTemplate, toManifest } from '../src/templates/registry.js';
import { sampleFromSchema } from './mocks/llm.js';

describe('templates', () => {
  it('all registered templates are valid', () => {
    for (const t of listTemplates()) {
      expect(validateTemplate(t)).toEqual([]);
    }
  });

  it('florida waves are acyclic and cover all agents', () => {
    const t = getTemplate('florida-business-for-sale')!;
    const waves = planWaves(t);
    const flat = waves.flat();
    expect(new Set(flat).size).toBe(t.agents.length); // every agent scheduled once
    expect(waves.length).toBeGreaterThan(1);
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
