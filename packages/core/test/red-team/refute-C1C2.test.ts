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
