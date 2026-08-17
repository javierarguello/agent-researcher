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
  it('prose citation and Sources entry point at the SAME address (before the fix the prose href carried `&amp;` and Sources was exact — the PDF disagreed with itself)', () => {
    const html = pdf(
      {
        market_overview: { overview: `El condado tiene 2,7 M de habitantes según [Miami-Dade Matters](${REAL_URL}).` },
        sources: { items: [{ url: REAL_URL, label: 'Miami-Dade Matters' }] },
      },
      [{ key: 'market_overview', title: 'Mercado' }, { key: 'sources', title: 'Fuentes' }],
    );
    const all = hrefs(html).filter((h) => h.startsWith(REAL_URL.split('?')[0]!));
    // Two hrefs — the prose citation and the Sources row — and both are the real address.
    // Mutation that reds this: `href="${esc(u)}"` in mdInline (the double escape).
    expect(all).toEqual([REAL_URL, REAL_URL]);
  });

  it('a URL with ONE query param (`?v=…`) is unaffected — the defect needs `&`, i.e. two or more params', () => {
    const url = 'https://www.youtube.com/watch?v=YFaDGCTkdr8';
    const html = pdf({ f: { overview: `Ver [el video](${url}).` } }, [{ key: 'f', title: 'F' }]);
    expect(hrefs(html)).toEqual([url]);
  });
});

describe('refute C5 · numbered lists in the shape the model ACTUALLY writes', () => {
  it('list lines attached to a prose line (`Esto implicaría:\\n1. …`) — the shape the model writes — render as a paragraph followed by an <ol> (a whole-block `lines.every(ol)` branch would NOT have fixed this; mutation: require the whole block to be list lines)', () => {
    const md = "Esto implicaría:\n1.  Comprar el negocio por su ubicación.\n2.  Deshacerse del equipo antiguo.\n3.  Invertir capital nuevo.";
    const html = pdf({ f: { overview: md } }, [{ key: 'f', title: 'F' }]);
    expect(html).toContain('<p>Esto implicaría:</p><ol><li>Comprar el negocio por su ubicación.</li><li>Deshacerse del equipo antiguo.</li><li>Invertir capital nuevo.</li></ol>');
  });

  it('blank-line-separated numbered items (`\\n\\n1.  **X:** …`) keep their NUMBERS: each becomes its own <ol> starting where the model numbered it (mutation: drop the `start` attribute and the second item prints as 1.)', () => {
    const md = 'Intro.\n\n1.  **Alto Costo:** barrera.\n\n2.  **Ubicación:** escasa.';
    const html = pdf({ f: { overview: md } }, [{ key: 'f', title: 'F' }]);
    expect(html).toContain('<ol><li><strong>Alto Costo:</strong> barrera.</li></ol>');
    expect(html).toContain('<ol start="2"><li><strong>Ubicación:</strong> escasa.</li></ol>');
  });
});

describe('refute C5 · what the list rule must NOT catch', () => {
  it('a sentence that opens with a year (`2024. Revenue grew…`) is prose, not item 2024 of a list; a `-` bullet run after prose is a <ul> (mutation: `\\d+` instead of `\\d{1,2}` in NUMBERED_LINE)', () => {
    const md = 'Revenue by year:\n2024. Revenue grew 12% on the prior year.\n2023. Flat.\n- utilities up 19%\n- rent unchanged';
    const html = pdf({ f: { overview: md } }, [{ key: 'f', title: 'F' }]);
    // `<ol class="toc">` is the PDF's own table of contents; a prose list has no class.
    expect(html).not.toMatch(/<ol(?: start="\d+")?>/);
    expect(html).toContain('<p>Revenue by year: 2024. Revenue grew 12% on the prior year. 2023. Flat.</p><ul><li>utilities up 19%</li><li>rent unchanged</li></ul>');
  });
});

describe('refute C6 · the ready email and `&`', () => {
  it('subject, plain text AND the HTML body agree on the `&` (before the fix the body alone lost it)', () => {
    const mail = reportReadyTemplate('FBizLab', 'Bed & Breakfast inns for sale — Key West, FL', 'https://app.example/r/1', 'en');
    expect(mail.subject).toContain('Bed & Breakfast');
    expect(mail.text).toContain('Bed & Breakfast');
    // Mutation that reds this: escape instead of strip at templates.ts:183 (the fix).
    // Three renderings of one title, ONE spelling now.
    expect(mail.html).toContain('<strong>Bed &amp; Breakfast inns for sale — Key West, FL</strong>');
  });
});
