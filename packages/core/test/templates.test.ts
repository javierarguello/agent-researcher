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
      const declared = t().i18n![lang]!.sectionTitles!;
      for (const s of m.sections) expect(s.title, `${lang}/${s.key}`).toBe(declared[s.key]);
      // …and that the block is a real translation rather than a copy of English.
      expect(m.name, lang).not.toBe(en.name);
      expect(m.modes.map((x) => x.label), lang).not.toEqual(en.modes.map((x) => x.label));
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
