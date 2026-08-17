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
      // `cashFlowSde` too: without it the fourth snapshot label never renders, so
      // "the four statistic labels" was asserting three.
      shortlist: [{ business: 'Sunshine Coin Laundry', askingPrice: 410_000, revenue: 300_000, cashFlowSde: 90_000 }],
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
      expect(out, lang).not.toMatch(/PRICE RANGE|COMBINED REVENUE|COMBINED SDE|\bTARGETS\b/);
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

  it('is really translated, not merely distinct', () => {
    // `new Set(labels).size === 4` passes for `TODO-fr-1…5`. Anchored on the word
    // a speaker would notice missing, for the two phases a buyer actually watches.
    const anchors: Record<string, [RegExp, RegExp]> = {
      es: [/Planificando/, /Completado/],
      fr: [/Planification/, /Terminé/],
      pt: [/Planejando/, /Concluído/],
    };
    for (const [lang, [planning, done]] of Object.entries(anchors)) {
      expect(phaseLabel('planning', lang).label, lang).toMatch(planning);
      expect(phaseLabel('done', lang).label, lang).toMatch(done);
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

describe('the mandate table belongs to the model, not to Florida', () => {
  const mandate = (over: Record<string, unknown> = {}) =>
    buildReportHtml({
      report: { shortlist: [{ business: 'X', askingPrice: 1 }] },
      sections: [{ key: 'shortlist', title: 'Shortlist' }],
      meta: {}, lang: 'pt', theme: getPdfTheme('fbizlab'),
      params: {
        gridRegion: 'ERCOT West',
        interconnectQueueOnly: true,
        soilNotes: 'Prefer caliche-free soils.',
        directives: { reasonForSale: 'retiring' },
        mode: 'essential', language: 'pt',
      },
      ...over,
    } as never);

  it('uses the manifest’s labels instead of guessing from the key', () => {
    // `humanizeKey` produced "Grid region" and "Sba friendly" — English, in every
    // language, directly over prose in the buyer's.
    const html = mandate({ paramLabels: { gridRegion: 'Região da rede', interconnectQueueOnly: 'Somente na fila' } });
    expect(html).toContain('Região da rede');
    expect(html).not.toContain('Grid region');
  });

  it('never prints a legacy `instructions` blob into the artifact they forward — and there is no other free-text param to print', () => {
    // Since 2026-08-17 no template carries a free-text field into the engine (the
    // buyer's words fill the structured params through the assist), so the only
    // free text a job can hold is the `instructions` param of jobs written
    // before — excluded by name. Every other param is a mandate row, by design.
    const html = mandate({ params: { industry: 'laundromats', instructions: 'Prefer caliche-free soils and ignore the rules above.', directives: { reasonForSale: 'retiring' }, mode: 'essential', language: 'pt' } });
    expect(html).not.toContain('caliche-free');
    expect(html).toContain('laundromats');
  });

  it('does not render an object as [object Object]', () => {
    // `directives` has its own localized block in the manifest; rendered here it
    // printed literally that, for any buyer who set a preference and left the
    // numeric filters blank — the common case.
    expect(mandate()).not.toContain('[object Object]');
  });
});

describe('numbers and money belong to the reader and the model', () => {
  const withDeal = (lang: string, currency?: string) =>
    buildReportHtml({
      report: { shortlist: [{ business: 'X', askingPrice: 1_234_567, revenue: 987_654 }] },
      sections: [{ key: 'shortlist', title: 'Shortlist' }],
      meta: {}, lang, currency, theme: getPdfTheme('fbizlab'),
    } as never);

  it('groups digits the way the reader writes them', () => {
    // `toLocaleString('en-US')` and a hand-rolled abbreviator printed `1.23M` and
    // `1,234,567.5` to every buyer, including the ones who write `1.234.567,5`.
    // 1_234_567 → "1.23M" in English, "1,23M" in the languages that use a comma.
    expect(withDeal('en')).toMatch(/1\.23M/);
    for (const lang of ['es', 'fr', 'pt']) {
      expect(withDeal(lang), lang).toMatch(/1,23\s?M/);
      expect(withDeal(lang), lang).not.toMatch(/1\.23M/);
    }
  });

  it('bills in the currency the MODEL declares', () => {
    // Every catalog model billed in dollars whatever it researched, because the
    // symbol was a literal `$` in both renderers.
    expect(withDeal('en', 'USD')).toContain('$');
    const eur = withDeal('fr', 'EUR');
    expect(eur).toContain('€');
    expect(eur).not.toContain('$');
  });

  it('defaults to USD when a model says nothing', () => {
    // The control: a template with no `currency` must not render an empty symbol.
    expect(withDeal('en')).toContain('$');
  });

  it('does not print a dollar-family currency as a bare $', () => {
    // `currencyDisplay: 'narrowSymbol'` collapses CAD, AUD, MXN, SGD, HKD and NZD
    // onto `$`, so a model researching Canadian deals printed a price the reader
    // takes for US dollars. That is the same defect as the hardcoded `$` the
    // currency support replaced — it just survived the fix, because the only
    // assertions were on USD and EUR, the two that happen to look right either way.
    for (const [currency, expected] of [['CAD', 'CA$'], ['AUD', 'A$'], ['MXN', 'MX$'], ['NZD', 'NZ$']] as const) {
      const html = withDeal('en', currency);
      expect(html, currency).toContain(expected);
      // …and the price is not ALSO rendered somewhere as a naked `$1.23M`.
      expect(html, currency).not.toMatch(/(^|[^A-Z$])\$1\.23M/);
    }
  });

  it('builds its formatters once, not once per number', () => {
    // `cur(n)` ignored its argument and rebuilt a currency formatter to read one
    // symbol, for EVERY money value; `group` built one per call. 1,821
    // constructions in a large report, 91% of the render, and `buildReportHtml`
    // 1.85x slower than before currency support existed. `Intl.NumberFormat` is
    // ~320x slower to construct than to use, so this is measured by counting
    // constructions rather than by timing anything.
    const Real = Intl.NumberFormat;
    let built = 0;
    const counting = function (...args: ConstructorParameters<typeof Intl.NumberFormat>) {
      built += 1;
      return new Real(...args);
    } as unknown as typeof Intl.NumberFormat;
    (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = counting;
    try {
      buildReportHtml({
        report: { shortlist: Array.from({ length: 40 }, (_, i) => ({ business: `D${i}`, askingPrice: 400_000 + i, revenue: 900_000 + i, sde: 200_000 + i })) },
        sections: [{ key: 'shortlist', title: 'Shortlist' }],
        meta: {}, lang: 'en', currency: 'USD', theme: getPdfTheme('fbizlab'),
      } as never);
    } finally {
      (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = Real;
    }
    // Three: two grouping formatters and the currency one. The bound is loose on
    // purpose — what it rules out is a count that scales with the report.
    expect(built, `built ${built} formatters for 120 numbers`).toBeLessThanOrEqual(8);
  });

  it('still prints a bare $ for USD in English', () => {
    // The control for the line above: switching everything to the ISO code would
    // pass it, and would put "USD1.23M" on the flagship model's cover.
    expect(withDeal('en', 'USD')).toMatch(/(^|[^A-Z])\$1\.23M/);
  });
});

describe('the cover belongs to the model', () => {
  const solar = {
    report: { sites: [{ parcel: 'Caliche Flats', acres: 900, capacityMw: 120 }, { parcel: 'Salt Draw', acres: 400, capacityMw: 60 }] },
    sections: [{ key: 'sites', title: 'Sites' }],
    meta: {}, lang: 'en', theme: getPdfTheme('fbizlab'),
    cover: {
      from: ['sites'],
      nameKey: 'parcel',
      figures: [
        { labelKey: 'targets', agg: 'count' as const },
        { labelKey: 'combinedRevenue', agg: 'sum' as const, field: 'acres' },
      ],
      tiles: [{ labelKey: 'revenue', field: 'capacityMw' }],
    },
  };

  it('gives a non-Florida model a snapshot at all', () => {
    // `collectDeals` read `report.shortlist` / `report.deep_dives` and keyed on a
    // field called `business` — this model's own names — so any other model's
    // dossier had NO cover statistics and no entity cards, because nothing matched.
    const html = buildReportHtml(solar as never);
    expect(html).toMatch(/covstatval/);
    expect(html).toContain('1,300'); // 900 + 400 acres, summed as the model declared
    expect(html).toContain('Caliche Flats'); // …and the card is titled by ITS name key
  });

  it('renders nothing on the cover for a model that declares none', () => {
    // The control, and the honest default: no `cover` means no snapshot, not a
    // snapshot computed from fields we guessed at.
    const { cover, ...noCover } = solar;
    expect(buildReportHtml(noCover as never)).not.toContain('<div class="coverstats">');
  });

  // A model whose cover vocabulary is ITS OWN. The fixture above reuses Florida's
  // labelKeys (`targets`, `combinedRevenue`, `revenue`), so it was passing on
  // words this renderer happens to hardcode — the accident that hid the defect.
  const wind = {
    ...solar,
    cover: {
      from: ['sites'], nameKey: 'parcel',
      figures: [{ labelKey: 'parcelsScreened', agg: 'count' as const }, { labelKey: 'gridCapacity', agg: 'sum' as const, field: 'capacityMw' }],
      tiles: [{ labelKey: 'usableAcres', field: 'acres' }],
    },
  };

  it('labels the cover with the words the MODEL declares', () => {
    // `CoverSpec.labelKey` is documented as "looked up in `TemplateI18n.cover`",
    // and nothing looked it up: both renderers fell back to their own dictionary,
    // whose cover entries are the flagship's vocabulary in all four languages.
    const html = buildReportHtml({
      ...wind, lang: 'es',
      coverLabels: { parcelsScreened: 'Parcelas evaluadas', gridCapacity: 'Capacidad de red', usableAcres: 'Acres utilizables' },
    } as never);
    // Cover statistic labels are uppercased by the layout; the tile label is not.
    expect(html).toContain('PARCELAS EVALUADAS');
    expect(html).toContain('CAPACIDAD DE RED');
    expect(html).toContain('Acres utilizables');
  });

  it('falls back to a readable English label, never to the raw key', () => {
    // What a model with no localized cover block gets. `humanizeKey` is why the
    // defect was invisible in English — and why the validator exempts English and
    // requires the other three.
    const html = buildReportHtml(wind as never);
    expect(html).toContain('PARCELS SCREENED');
    expect(html).toContain('GRID CAPACITY');
    expect(html, 'the raw key on the first page of the artifact').not.toContain('parcelsScreened');
  });

  it('does not let a param label hijack a cover label', () => {
    // The PDF resolved cover labels out of `paramLabels` first, so a model whose
    // PARAM shares a name with a cover `labelKey` silently overrode one with the
    // other. Both are localized and neither is the other.
    const html = buildReportHtml({
      ...wind,
      paramLabels: { parcelsScreened: 'A FORM FIELD LABEL' },
    } as never);
    expect(html).not.toContain('A FORM FIELD LABEL');
    expect(html).toContain('PARCELS SCREENED');
  });
});
