/**
 * M step 2 · refuter C3C4 — the property that makes C4 inert TODAY.
 *
 * Measured in headless Chrome 151 (puppeteer-core, scratchpad c3c4/click.mjs):
 * a click on `<a href="javascript:document.write(…)" target="_blank" rel="noreferrer">`
 * opens an about:blank tab in which the script does NOT run (title/body untouched,
 * SPA untouched); the same href with NO target runs in the SPA's own document
 * (title cleared, `#pw` written); `data:text/html` opens nothing. So the guard is
 * `target="_blank"` + `noreferrer` (⇒ noopener) on the three raw-href sites — pin it.
 *
 * Passes today. Mutation that reds it: drop `target="_blank"` (or `rel`) at
 * ReportViewer.tsx:220, :230 or :321.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportViewer } from '../src/components/ReportViewer';

const JS_URL = 'javascript:document.write("<h1 id=pw>PWNED</h1>")';
const cover = { from: ['shortlist'], nameKey: 'business', tiles: [{ labelKey: 'asking', field: 'askingPrice' }] };

describe('refute C4 · every raw-href site opens a NEW, opener-less context — the reason a javascript: href is a blank tab and not script in the SPA', () => {
  it('DealCard sourceUrl (:220), Sources items[].url (:230), community mention url (:321) all carry target=_blank and rel including noreferrer', () => {
    const { container } = render(
      <ReportViewer
        report={{
          shortlist: [{ business: 'Coral Clean', askingPrice: 410000, sourceUrl: JS_URL }],
          sources: { items: [{ id: 1, url: JS_URL, label: 'Coral Clean listing' }] },
          community: { overview: 'Mixed.', mentions: [{ platform: 'Reddit', url: JS_URL, topic: 'x', summary: 'y', sentiment: 'positive' }] },
        }}
        sections={[{ key: 'shortlist', title: 'Shortlist' }, { key: 'sources', title: 'Sources' }, { key: 'community', title: 'Community' }]}
        meta={{}}
        lang="en"
        cover={cover}
      />,
    );
    const raw = [...container.querySelectorAll('a')].filter((a) => (a.getAttribute('href') ?? '').startsWith('javascript:'));
    expect(raw).toHaveLength(3); // the three sites rendered the attacker's href (C4 as found)
    for (const a of raw) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel') ?? '').toMatch(/\bnoreferrer\b/);
    }
  });
});
