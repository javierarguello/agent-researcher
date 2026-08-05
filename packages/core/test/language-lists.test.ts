/**
 * What is left of the seven copies of the supported-language list, and what still
 * has to be pinned by hand.
 *
 * It used to be seven independent lists with nothing linking them, and the failure
 * modes were asymmetric: ADDING a language failed loudly at boot
 * (`assertTemplatesValid` throws) and then silently everywhere else, while REMOVING
 * one failed NOTHING — `?lang=pt` stopped being accepted, the template's enum still
 * took `pt`, the engine still wrote Portuguese prose, and the manifest served
 * English titles over it. That is the defect `e89b812` fixed, reintroduced with no
 * test anywhere going red.
 *
 * `languages.ts` now exports the `Lang` type as well as the labels, and every table
 * that was keyed by its own hand-written union — `moderation/copy.ts` (which
 * `report-copy.ts`, `email/templates.ts`, `deterministic.ts` and `florida-preflight.ts`
 * all import), `engine/prompt.ts`, the PDF's `RL`, the SPA viewer's `RL` — is now
 * `Record<Lang, …>`. A fresh object literal fails that in BOTH directions: a
 * missing key on an addition, an excess key on a removal. Measured: either edit to
 * `LANGUAGE_LABELS` breaks the build in seven core files.
 *
 * Three copies the compiler cannot reach are what remains, and they are what this
 * file pins:
 *
 *   - each template's Zod `language` enum (a runtime value),
 *   - `apps/fbizlab/scripts/fetch-plans.mjs` (plain ESM, no types at all),
 *   - the PDF's per-language STRINGS, as opposed to its per-language keys —
 *     `Record<Lang, …>` is satisfied by copy-pasting the English block.
 *
 * The SPA's own list lives in another package and is pinned from there, in
 * `apps/fbizlab/test/languages.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANGUAGE_LABELS } from '../src/languages.js';
import { LANGUAGES as ENGINE_LANGUAGES } from '../src/engine/prompt.js';
import { pdfFooterNote } from '../src/pdf/report-html.js';
import { listTemplates } from '../src/templates/registry.js';
import { z } from 'zod';

const SUPPORTED = Object.keys(LANGUAGE_LABELS);

describe('every copy of the supported-language list agrees', () => {
  it('the engine has a name for each of them to put in the prompt', () => {
    // The moderation half of this assertion is GONE, not forgotten: `LANGS` there
    // is now re-exported from `languages.ts`, so comparing the two compared a value
    // with itself and would have passed for any answer at all.
    //
    // This one is kept because it is not that. `LANGUAGES` is still a hand-written
    // literal; what makes it agree is the `Record<Lang, string>` annotation, and
    // this goes red the moment someone unties it (back to `as const` + `keyof
    // typeof`) and drops a language — which is exactly how it was written before.
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
