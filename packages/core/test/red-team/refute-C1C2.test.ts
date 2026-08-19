/**
 * M step 2 · REFUTER C1C2, PDF side. Two measurements: the Sources row prints no
 * hostname (C2), and the only production template derives `{items}` (F4 is a
 * fixture shape). Passing tests — measurements, not defects.
 */
import { describe, it, expect } from 'vitest';
import { buildReportHtml } from '../../src/pdf/report-html.js';
import { getPdfTheme } from '../../src/pdf/theme.js';
import { listTemplates } from '../../src/templates/registry.js';

const theme = getPdfTheme('fbizlab');
const pdf = (report: Record<string, unknown>) =>
  buildReportHtml({ report, sections: [{ key: 'sources', title: 'Sources' }], meta: {}, lang: 'en', title: 'Dossier', generatedAt: '2026-08-17T00:00:00.000Z', theme } as never);

describe('C2 · PDF Sources row', () => {
  it('MEASURE · prints "↗ host — title" (before the fix: "↗" + title only, the hostname nowhere in the visible text)', () => {
    const html = pdf({ sources: { items: [{ id: 1, url: 'https://attacker.test/miami-laundromat-market-2026', label: 'Florida Department of Business Regulation — Official Miami-Dade Laundromat Registry (PZ-SRC)' }] } });
    const li = html.match(/<ul class="sources">(.*?)<\/ul>/s)![1]!;
    const visible = li.replace(/<[^>]+>/g, '');
    console.log('PDF Sources visible text:', JSON.stringify(visible));
    expect(li).toContain('href="https://attacker.test/miami-laundromat-market-2026"');
    // The host leads the row now (mutation: `esc(s.label || s.url)` instead of `esc(sourceLabel(s))`).
    expect(visible).toMatch(/^↗attacker\.test — Florida Department of Business Regulation/);
  });
});

describe('C2 · the clip, in the renderer that prints it (R7-24)', () => {
  it('a 5,000-character title is cut in the PDF too — the web copy was the only one proving it', () => {
    // `SOURCE_LABEL_MAX = 100_000` left the whole core suite green: the clip was
    // asserted only in `apps/fbizlab`, i.e. for the OTHER copy of `sourceLabel`, and
    // these two implementations live in different packages and are the pair most
    // likely to drift. A 5,000-character `<title>` from a poisoned page is one `<li>`
    // of a printed dossier. Mutation that reds this: raise `SOURCE_LABEL_MAX`.
    const label = `Florida Department of Business Regulation — Official Registry${'Z'.repeat(4900)}`;
    const html = pdf({ sources: { items: [{ id: 1, url: 'https://attacker.test/p', label }] } });
    const visible = html.match(/<ul class="sources">(.*?)<\/ul>/s)![1]!.replace(/<[^>]+>/g, '');
    expect([...visible].length, 'host + 160 + the arrow, not five thousand').toBeLessThan(200);
    expect(visible).toMatch(/…$/);
    expect(visible.startsWith('↗attacker.test — ')).toBe(true);
  });

  it('and a row with NO label and no host is clipped too (round 9, R9-22)', () => {
    // `sourceLabel`'s last line is `return host || s.url` — the fallback for a url
    // whose hostname is empty and whose label is missing. It was the one path that
    // returned an unbounded string, so the row printed the whole thing while the
    // tooltip beside it was bounded at 320. Both copies had it; the buyer app's is
    // pinned in `apps/fbizlab`, and this one measured 0 red until this test.
    // Mutation that reds this: `return host || s.url`.
    const url = `javascript:void("${'A'.repeat(4000)}")`;
    const html = pdf({ sources: { items: [{ id: 1, url }] } });
    const visible = html.match(/<ul class="sources">(.*?)<\/ul>/s)![1]!.replace(/<[^>]+>/g, '');
    expect([...visible].length, 'the row is bounded like every other one').toBeLessThan(200);
    expect(visible).toMatch(/…$/);
  });

  it('and the honest long row survives it: the identifying half is what is kept', () => {
    // The longest real label across the two July runs (373 rows): 167 code points,
    // the only one over the cap. The number in the comment justifying 160 said "real
    // listing titles: ≤130", which is true of one run and not of the other (R7-24) —
    // the cap is right, the evidence quoted for it was not.
    const real = 'Fla. Admin. Code Ann. R. 62-660.801 - General Permit for a Wastewater Disposal System for a Laundromat | State Regulations | US Law | LII / Legal Information Institute';
    expect([...real].length).toBe(167);
    const html = pdf({ sources: { items: [{ id: 1, url: 'https://www.law.cornell.edu/regulations/florida/62-660-801', label: real }] } });
    const visible = html.match(/<ul class="sources">(.*?)<\/ul>/s)![1]!.replace(/<[^>]+>/g, '');
    expect(visible).toContain('law.cornell.edu — Fla. Admin. Code Ann. R. 62-660.801');
    expect(visible).toMatch(/…$/);
  });
});

describe('C2 · F4 shape — which PRODUCTION templates derive `[{title,url}]`', () => {
  it('MEASURE · every registered template with a derived `sources` derives `{items:[{id,url,label}]}`; the `[{title,url}]` shape exists only in test fixtures', () => {
    const src = [{ title: 'T', url: 'https://x.test/a', snippet: '' }];
    const shapes = listTemplates().map((t) => {
      const s = t.sections.find((x) => x.key === 'sources' && x.derived && x.derive);
      const v = s?.derive?.({ sources: src, report: {} }) as unknown;
      return { id: t.id, shape: v == null ? 'none' : Array.isArray(v) ? 'array' : (v as { items?: unknown }).items ? 'items' : 'other' };
    });
    console.table(shapes);
    expect(shapes.length).toBe(1);
    expect(shapes.every((s) => s.shape === 'items')).toBe(true);
  });
});
