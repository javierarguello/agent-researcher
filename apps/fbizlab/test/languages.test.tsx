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
import { render, screen } from '@testing-library/react';
import { LANGUAGE_LABELS } from '../../../packages/core/src/languages';
import { LANGS, LANG_LABELS } from '../src/i18n';
import { ReportViewer } from '../src/components/ReportViewer';

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

describe('the report viewer speaks every one of them', () => {
  /**
   * `ReportViewer`'s `RL` table used to declare its OWN `'en' | 'es' | 'fr' | 'pt'`,
   * shadowing the app-wide `Lang`, so a language could be added to `LANGS` — offered
   * in the switcher, put in the URL, sent to the API — with no entry here, and
   * `RL[lang] ?? RL.en` served English headings over the buyer's translated report.
   * It is keyed by the app-wide `Lang` now, so a MISSING language is a build error.
   *
   * This is the half the compiler cannot reach: a block that exists and holds the
   * English string. `Record<Lang, Record<string, string>>` is satisfied by copy-paste.
   * So assert the words, and only for the languages that are not English.
   */
  const at = (lang: string) =>
    render(
      <ReportViewer
        report={{ verdict: { recommendation: 'buy', price: 0, summary: 'x' } }}
        sections={[{ key: 'verdict', title: 'Verdict' }]}
        meta={{ sections: [{ key: 'verdict', status: 'lost' }] }}
        lang={lang}
      />,
    );

  it('does not fall back to English for any of them', () => {
    const english = at('en').container.textContent ?? '';
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const shown = at(lang).container.textContent ?? '';
      expect(shown, `the viewer renders ${lang} in English`).not.toBe(english);
    }
  });

  it('and still renders English as English', () => {
    // The control. "Never equals English" also passes if every language, English
    // included, renders something else entirely.
    at('en');
    expect(screen.getByText(/could not complete this section/i)).toBeTruthy();
  });
});
