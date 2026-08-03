/**
 * The SPA's language list may never exceed the API's.
 *
 * `apps/fbizlab/src/i18n.tsx` hardcodes `LANGS` and clamps every `?lang=` call to
 * it, so the two lists have to agree — and the query is enum-validated, which means
 * a language added HERE and not in the API 400s every manifest request, the pricing
 * call included, for exactly the buyers who chose it.
 *
 * The assertion lives on this side on purpose. The API pin (in `apps/api`) guards
 * against silently widening the published enum; this one guards the direction that
 * ships a broken page, and it runs in the build that would ship it. `languages.ts`
 * is a leaf module with no imports, so reaching across is cheap.
 */
import { describe, it, expect } from 'vitest';
import { LANGUAGE_LABELS } from '../../../packages/core/src/languages';
import { LANGS, LANG_LABELS } from '../src/i18n';

describe('the languages this app offers', () => {
  it('are all languages the API will accept', () => {
    const api = Object.keys(LANGUAGE_LABELS);
    const extra = LANGS.filter((l) => !api.includes(l));
    // Not `toEqual`: the API may legitimately know a language before the UI ships
    // it. The direction that breaks a buyer is only this one.
    expect(extra, `offered by the SPA but not accepted by the API: ${extra.join(', ')}`).toEqual([]);
  });

  it('all have a name in the switcher', () => {
    // A language in `LANGS` with no label renders an empty menu entry — the kind of
    // thing that compiles because `Record<Lang, string>` is satisfied by the type
    // and not by the content.
    for (const l of LANGS) expect(LANG_LABELS[l], l).toBeTruthy();
  });
});
