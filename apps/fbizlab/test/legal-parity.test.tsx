/**
 * The privacy notice says the same thing in every language.
 *
 * `copy-parity.test.tsx` guards the app's eleven copy tables; the LEGAL pages were
 * never in it, and they are the ones that make promises about a person's data. A
 * section added in English and forgotten in French is a French reader given a
 * shorter privacy notice than the English one, with nothing to say so.
 *
 * Written when cookieless analytics was added (2026-08-24), because that change
 * added a disclosure to four documents at once and there was no guard that it
 * landed in four.
 */
import { describe, it, expect } from 'vitest';
import { CONTENT } from '../src/pages/Legal';
import { LANGS } from '../src/i18n';

describe('the legal documents', () => {
  it.each(Object.keys(CONTENT))('%s has the same SECTIONS in every language', (page) => {
    const doc = CONTENT[page as keyof typeof CONTENT];
    const en = doc.en.sections.length;
    expect(en, `${page}.en has no sections`).toBeGreaterThan(0);
    for (const lang of LANGS) {
      expect(doc[lang], `${page}.${lang} is missing`).toBeTruthy();
      expect(doc[lang].sections.length, `${page}.${lang} has ${doc[lang].sections.length} sections, en has ${en}`).toBe(en);
      for (const s of doc[lang].sections) {
        expect(s.h.trim(), `${page}.${lang} has an unnamed section`).toBeTruthy();
        expect(s.body.join('').trim().length, `${page}.${lang} · "${s.h}" is empty`).toBeGreaterThan(20);
      }
    }
  });

  it('the privacy notice discloses the traffic counting, in all four', () => {
    // The disclosure is the reason analytics was allowed to ship at all. If it is
    // dropped in a rewrite, the page goes back to describing a product that does not
    // collect anything — which is the defect this repo fixed three times on the day
    // this was written.
    const anchors: Record<string, RegExp> = {
      en: /cookieless|without cookies/i,
      es: /sin cookies/i,
      fr: /sans cookie/i,
      pt: /sem cookies/i,
    };
    for (const [lang, re] of Object.entries(anchors)) {
      const text = CONTENT.privacy[lang as 'en'].sections.map((s) => `${s.h} ${s.body.join(' ')}`).join('\n');
      expect(text, `${lang} does not disclose the cookieless analytics`).toMatch(re);
      expect(text, `${lang} does not mention Analytics by name`).toMatch(/Analytics/i);
    }
  });

  it('…and still promises no cross-web tracking, because cookieless keeps that true', () => {
    // The control on the disclosure: the honest thing was to ADD a sentence, not to
    // delete the promise. If someone later turns cookies on, this is the line that
    // has to change with it — and this test is where they will find out.
    const anchors: Record<string, RegExp> = {
      en: /track you across the web/i, es: /rastreamos por la web/i,
      fr: /suivons pas sur le web/i, pt: /rastreamos você pela web/i,
    };
    for (const [lang, re] of Object.entries(anchors)) {
      const text = CONTENT.privacy[lang as 'en'].sections.map((s) => s.body.join(' ')).join('\n');
      expect(text, `${lang} dropped the no-tracking promise`).toMatch(re);
    }
  });
});
