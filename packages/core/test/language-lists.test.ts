/**
 * Seven copies of the same list, and nothing linking them.
 *
 * `languages.ts` (which the API's `?lang` enum derives from), `moderation/copy.ts`,
 * `engine/prompt.ts`, each template's own `language` enum, the PDF string table,
 * `apps/fbizlab/src/i18n.tsx` and `apps/fbizlab/scripts/fetch-plans.mjs`. They must
 * all agree, and the failure modes are asymmetric:
 *
 *   - ADDING a language fails loudly at boot (`assertTemplatesValid` throws), then
 *     silently everywhere else — the engine falls back to the raw code in the
 *     prompt, `asLang` collapses to English, and `fetch-plans` never fetches it, so
 *     the pricing page for that language is blank.
 *   - REMOVING one failed NOTHING. `?lang=pt` stops being accepted, the template's
 *     enum still takes `pt`, the engine still writes Portuguese prose, and the
 *     manifest serves English titles over it — exactly the defect `e89b812` fixed,
 *     reintroduced with no test anywhere going red.
 *
 * This is that test. It is deliberately a pin rather than a refactor: the lists
 * live in three packages with different module systems, and one assertion that
 * fails in both directions is worth more than a clever indirection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANGUAGE_LABELS } from '../src/languages.js';
import { LANGS as MODERATION_LANGS } from '../src/moderation/copy.js';
import { LANGUAGES as ENGINE_LANGUAGES } from '../src/engine/prompt.js';
import { pdfFooterNote } from '../src/pdf/report-html.js';
import { listTemplates } from '../src/templates/registry.js';
import { z } from 'zod';

const SUPPORTED = Object.keys(LANGUAGE_LABELS);

describe('every copy of the supported-language list agrees', () => {
  it('moderation and the engine cover exactly what the API publishes', () => {
    expect([...MODERATION_LANGS].sort()).toEqual([...SUPPORTED].sort());
    expect(Object.keys(ENGINE_LANGUAGES).sort()).toEqual([...SUPPORTED].sort());
  });

  it('the PDF has its own strings for each of them', () => {
    // `RL` is not exported; the footer note is the cheapest window into it, and a
    // language with no entry falls back to English rather than failing.
    const notes = SUPPORTED.filter((l) => l !== 'en').map((l) => pdfFooterNote(l));
    const en = pdfFooterNote('en');
    for (const [i, note] of notes.entries()) {
      expect(note, `${SUPPORTED.filter((l) => l !== 'en')[i]} falls back to English in the PDF`).not.toBe(en);
    }
  });

  it('no template accepts a language the API will not serve', () => {
    // The direction that ships a broken report: the engine writes prose in a
    // language the manifest cannot label, so the buyer gets their language under
    // English headings.
    for (const t of listTemplates()) {
      const props = (z.toJSONSchema(t.paramsSchema) as { properties?: Record<string, { enum?: string[] }> }).properties ?? {};
      const declared = props.language?.enum;
      if (!declared) continue;
      const extra = declared.filter((l) => !SUPPORTED.includes(l));
      expect(extra, `${t.id} accepts ${extra.join(', ')} which the API does not publish`).toEqual([]);
    }
  });

  it('the buyer app’s build script fetches every one of them', () => {
    // `fetch-plans.mjs` bakes `dist/plans.json` at build time and refuses to ship a
    // blank pricing page. A language missing from its own hardcoded list is simply
    // never fetched, so that language's pricing is `undefined` at runtime — the
    // exact failure the script exists to prevent, arrived at from the other side.
    const src = readFileSync(new URL('../../../apps/fbizlab/scripts/fetch-plans.mjs', import.meta.url), 'utf8');
    const m = src.match(/const LANGS = \[([^\]]*)\]/);
    expect(m, 'fetch-plans.mjs no longer declares LANGS the way this test reads it').toBeTruthy();
    const declared = [...m![1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
    expect([...declared].sort()).toEqual([...SUPPORTED].sort());
  });
});
