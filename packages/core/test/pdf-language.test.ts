/**
 * The PDF is the artifact a buyer keeps and forwards, and its most authoritative
 * page was English in every language.
 *
 * `report-html.ts` has had a complete four-language table for a while — and then
 * bypassed it on the cover: the kicker, the four snapshot statistic labels, the
 * date locale and (in the worker) the footer on every single page were hardcoded
 * literals. So even the fully-translated Spanish case shipped a dossier whose first
 * impression and every page margin were in English.
 */
import { describe, it, expect } from 'vitest';
import { buildReportHtml, pdfFooterNote } from '../src/pdf/report-html.js';
import { getPdfTheme } from '../src/pdf/theme.js';
import { phaseLabel } from '../src/templates/phases.js';

const LANGS = ['en', 'es', 'fr', 'pt'] as const;

const html = (lang: string) =>
  buildReportHtml({
    report: {
      shortlist: [{ business: 'Sunshine Coin Laundry', askingPrice: 410_000, revenue: 300_000 }],
    },
    sections: [{ key: 'shortlist', title: 'Shortlist' }],
    meta: {},
    lang,
    title: 'Dossier',
    generatedAt: '2026-08-03T00:00:00.000Z',
    theme: getPdfTheme('fbizlab'),
  } as never);

describe('the PDF cover is in the buyer’s language', () => {
  it('translates the kicker and the snapshot labels', () => {
    // Non-vacuous by construction: the snapshot only renders when there are deals,
    // so the fixture carries one with a price and a revenue.
    for (const lang of LANGS) {
      const out = html(lang);
      expect(out, lang).toContain('410'); // the snapshot really rendered
      if (lang === 'en') continue;
      expect(out, lang).not.toContain('AI ANALYSIS REPORT');
      expect(out, lang).not.toMatch(/PRICE RANGE|COMBINED REVENUE|\bTARGETS\b/);
    }
  });

  it('does not print a US date on a Portuguese dossier', () => {
    // `toLocaleDateString('en-US')` rendered "03 AUG 2026" for everyone.
    expect(html('pt')).not.toMatch(/\bAUG\b/);
    expect(html('en')).toMatch(/\bAUG\b/);
  });

  it('gives the worker a translated running footer', () => {
    // Built outside the HTML, in the worker's puppeteer options, which is how it
    // escaped the table in the first place.
    const notes = LANGS.map((l) => pdfFooterNote(l));
    expect(new Set(notes).size).toBe(4);
    expect(pdfFooterNote('es')).toMatch(/VERIFICA/);
    // The control: an unknown language must not produce an empty page margin.
    expect(pdfFooterNote('de')).toBe(pdfFooterNote('en'));
  });
});

describe('the progress steps are in the buyer’s language', () => {
  it('covers every language the API publishes', () => {
    // These survive independently of the template's own i18n block — translating
    // the template left fr/pt buyers still watching "Planning" and "Complete",
    // which are the first and last things they see during the wait.
    for (const phase of ['planning', 'assembling', 'done', 'incomplete', 'failed']) {
      const labels = LANGS.map((l) => phaseLabel(phase, l).label);
      expect(new Set(labels).size, `${phase}: ${labels.join(' | ')}`).toBe(4);
    }
  });

  it('still falls back to English for an unknown language', () => {
    expect(phaseLabel('planning', 'de').label).toBe('Planning');
  });

  it('does not call a report a “job” to the buyer', () => {
    // Our word, not theirs — they bought a report.
    for (const lang of LANGS) {
      for (const phase of ['incomplete', 'failed']) {
        expect(phaseLabel(phase, lang).description ?? '', `${lang}/${phase}`).not.toMatch(/\bjob\b/i);
      }
    }
  });
});
