/**
 * M step 2 · refuter for clusters M-C5 (PDF `mdInline` breaks honest citations)
 * and M-C6 (ready email deletes `&`). Everything goes through the production
 * renderer (`buildReportHtml`) / template. Each `it.fails` is red against today's
 * code; each plain `it` pins a measured fact that stays true today.
 *
 * Shapes below are lifted from a REAL July flagship run (out/local-4837f6e3,
 * language es): the model cited `…view?indicatorId=393&localeTypeId=2` five times
 * in prose and once in Sources, and wrote a numbered list as `Esto implicaría:\n1. …`
 * (list lines attached to a prose line, single newlines).
 */
import { describe, it, expect } from 'vitest';
import { buildReportHtml } from '../../src/pdf/report-html.js';
import { getPdfTheme } from '../../src/pdf/theme.js';
import { reportReadyTemplate } from '../../src/email/templates.js';

const REAL_URL = 'https://www.miamidadematters.org/indicators/index/view?indicatorId=393&localeTypeId=2';

function pdf(report: Record<string, unknown>, sections: Array<{ key: string; title: string }>): string {
  return buildReportHtml({
    report, sections, meta: {}, lang: 'es', title: 'Dossier',
    generatedAt: '2026-08-17T00:00:00.000Z', theme: getPdfTheme('fbizlab'),
  } as never);
}
/** hrefs as the browser reads them (ONE level of entity decoding). */
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&quot;/g, '"')).filter((h) => !h.startsWith('#'));

describe('refute C5 · the same real URL, cited in prose and listed in Sources, in ONE PDF', () => {
  it.fails('prose citation and Sources entry point at the SAME address (today: prose href carries `&amp;`, Sources is exact — the PDF disagrees with itself)', () => {
    const html = pdf(
      {
        market_overview: { overview: `El condado tiene 2,7 M de habitantes según [Miami-Dade Matters](${REAL_URL}).` },
        sources: { items: [{ url: REAL_URL, label: 'Miami-Dade Matters' }] },
      },
      [{ key: 'market_overview', title: 'Mercado' }, { key: 'sources', title: 'Fuentes' }],
    );
    const all = hrefs(html);
    const inSources = all.filter((h) => h === REAL_URL);
    const inProse = all.filter((h) => h.startsWith(REAL_URL.split('?')[0]!) && h !== REAL_URL);
    console.log('refute-C5 prose href:', inProse[0], '| Sources href:', inSources[0]);
    expect(inSources).toHaveLength(1);
    // Mutation that greens this: `esc(u)` → `u` at report-html.ts:124 (u is already escaped text).
    expect(inProse).toHaveLength(0);
  });

  it('a URL with ONE query param (`?v=…`) is unaffected — the defect needs `&`, i.e. two or more params', () => {
    const url = 'https://www.youtube.com/watch?v=YFaDGCTkdr8';
    const html = pdf({ f: { overview: `Ver [el video](${url}).` } }, [{ key: 'f', title: 'F' }]);
    expect(hrefs(html)).toEqual([url]);
  });
});

describe('refute C5 · numbered lists in the shape the model ACTUALLY writes', () => {
  it.fails('list lines attached to a prose line (`Esto implicaría:\\n1. …`) — flattened today; NOTE the finder’s `lines.every(ol)` branch would NOT fix this shape either (first line is prose): the fix must split the block at the first list line', () => {
    const md = "Esto implicaría:\n1.  Comprar el negocio por su ubicación.\n2.  Deshacerse del equipo antiguo.\n3.  Invertir capital nuevo.";
    const html = pdf({ f: { overview: md } }, [{ key: 'f', title: 'F' }]);
    console.log('refute-C5 ol rendered:', html.match(/<p>Esto[^<]*/)?.[0]);
    expect(html).toMatch(/<ol>\s*<li>Comprar/);
  });

  it('blank-line-separated numbered items (`\\n\\n1.  **X:** …`) survive as numbered PARAGRAPHS — the number is kept as text (legible, just unindented)', () => {
    const md = 'Intro.\n\n1.  **Alto Costo:** barrera.\n\n2.  **Ubicación:** escasa.';
    const html = pdf({ f: { overview: md } }, [{ key: 'f', title: 'F' }]);
    expect(html).toContain('<p>1.  <strong>Alto Costo:</strong> barrera.</p>');
    expect(html).toContain('<p>2.  <strong>Ubicación:</strong> escasa.</p>');
  });
});

describe('refute C6 · the ready email and `&`', () => {
  it('only the HTML body loses the `&`; subject AND plain-text part keep it (three renderings of one title, two spellings)', () => {
    const mail = reportReadyTemplate('FBizLab', 'Bed & Breakfast inns for sale — Key West, FL', 'https://app.example/r/1', 'en');
    expect(mail.subject).toContain('Bed & Breakfast');
    expect(mail.text).toContain('Bed & Breakfast');
    // Mutation that reds this: escape instead of strip at templates.ts:183 (the fix).
    expect(mail.html).toContain('<strong>Bed  Breakfast inns for sale — Key West, FL</strong>');
  });
});
