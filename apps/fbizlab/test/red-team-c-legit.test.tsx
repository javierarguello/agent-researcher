/**
 * M step 2 · finder C-legit — surface C, LEGITIMATE-USER lens, the web viewer.
 *
 * What an honest report renders to today in `ReportViewer` / `JobView`, and what
 * the defences C-attack proposes (strip `<img>`, protocol allowlist on raw hrefs,
 * sanitise `progress.message`) would take from it. Rendered through the
 * production components in jsdom; every assertion is on CONTENT the buyer sees.
 *
 * `it.fails` = defect that exists today (red against today's code, inverted so
 * the suite stays green). Plain `it` = a guard that holds, with the mutation that
 * would red it in its comment.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ReportViewer } from '../src/components/ReportViewer';

// ── JobView harness (same seam as job-view.test.tsx) ──
const { job } = vi.hoisted(() => ({ job: { current: {} as Record<string, unknown> } }));
vi.mock('../src/api/hooks', async (orig) => ({
  ...(await orig<typeof import('../src/api/hooks')>()),
  useJob: () => ({ data: job.current }),
  useJobReport: () => ({ data: undefined }),
  useTemplate: () => ({ data: { steps: [{ id: 'research', label: 'Investigando el mercado', description: 'Buscamos anuncios y datos de mercado.' }], modes: [], sections: [] } }),
  // A field with a `catalog` hint fetches its list; a mock without this makes
  // every form in the file throw on an undefined hook.
  useCatalog: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../src/components/DownloadPdf', () => ({ DownloadPdf: () => null }));
import { JobView } from '../src/pages/JobView';
import { LangProvider } from '../src/i18n';

function showJob(data: Record<string, unknown>, lang = 'en') {
  job.current = { jobId: 'j1', template: 't', params: { language: lang }, files: [], ...data };
  localStorage.setItem('fbizlab_lang', lang);
  return render(
    <MemoryRouter initialEntries={['/app/jobs/j1']}>
      <LangProvider>
        <Routes><Route path="/app/jobs/:jobId" element={<JobView />} /></Routes>
      </LangProvider>
    </MemoryRouter>,
  );
}

/** One prose section, rendered by the production viewer. */
function prose(md: string) {
  return render(<ReportViewer report={{ market: { text: md } }} sections={[{ key: 'market', title: 'Market' }]} lang="en" />);
}
// Prose links only — the section nav's `#sec-…` anchors are ours, not the model's.
const links = (c: HTMLElement) => [...c.querySelectorAll('.prose a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') }));

describe('C-legit · prose links in the viewer — what react-markdown’s default urlTransform already does (ReportViewer.tsx:115-116)', () => {
  it('a `javascript:` PROSE link is neutralised WITHOUT any allowlist of ours — C-attack’s prose-link claim is refuted here; the raw `href={…}` sites are the real ones', () => {
    // Mutation that reds this: pass `urlTransform={(u) => u}` to <Markdown> in Prose.
    const { container } = prose('Click [here](javascript:alert(1)) for the listing.');
    // No anchor at all now (`proseUrl` + the `a` component render the text); the
    // sentence still reads whole.
    expect(links(container)).toEqual([]);
    expect(container.textContent).toContain('Click here for the listing.');
  });

  it('a `mailto:` broker link SURVIVES in the viewer (react-markdown allows mailto) — an `https`-only allowlist copied from the PDF would kill it', () => {
    // Mutation that reds this: add `urlTransform={(u) => /^https?:/.test(u) ? u : ''}` to Prose.
    const { container } = prose('Contact [the listing broker](mailto:broker@example-brokerage.test) for the CIM.');
    expect(links(container)).toEqual([{ text: 'the listing broker', href: 'mailto:broker@example-brokerage.test' }]);
  });

  it('a `tel:` broker number is a working link (before the fix: react-markdown’s default set excluded tel, so the buyer saw blue underlined text with `href=""`; mutation: drop `tel:` from `proseUrl`)', () => {
    const { container } = prose('Call [the broker](tel:+13055550123) to schedule a walkthrough.');
    expect(links(container)).toEqual([{ text: 'the broker', href: 'tel:+13055550123' }]);
  });

  it('http://, ports, IDN hosts and parenthesised Wikipedia paths all survive in the viewer (the PDF cuts the last one — see core c-legit F2)', () => {
    // Mutation that reds this: any urlTransform narrower than the default.
    const urls = [
      'http://legacy-listings.example/laundromat/33',
      'https://data.example:8443/market/miami',
      'https://m%C3%BCnchen.example/w%C3%A4scherei',
      'https://en.wikipedia.org/wiki/Hialeah,_Florida_(city)',
    ];
    const { container } = prose(urls.map((u, i) => `[source ${i}](${u})`).join(' and '));
    expect(links(container).map((l) => l.href)).toEqual(urls);
  });
});

describe('C-legit · images in prose (ReportViewer.tsx:115 overrides only `a`)', () => {
  it('a Markdown image renders NOTHING — and no honest input produces one: MARKDOWN_DIRECTIVE asks for links, the honest corpus and the mock write none, charts are `ChartSpec` objects drawn by recharts, never Markdown images', () => {
    // The legit-lens claim: stripping images loses nothing a report has today.
    // Mutation that reds this: remove `img: () => null` from `MD`.
    const { container } = prose('Floor plan: ![plan](https://example-marketplace.test/plan.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Floor plan:');
  });

  it('charts arrive as ChartSpec objects and render through recharts, not <img> — an image strip does not touch them', () => {
    // Mutation that reds this: change `isChartSpec` to require a `src` field.
    // recharts' ResponsiveContainer needs a ResizeObserver jsdom lacks.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const spec = { type: 'bar', title: 'Asking price by listing', labels: ['Sunshine', 'Bayside'], series: [{ name: 'Asking', data: [450000, 280000] }], unit: '$' };
    const { container } = render(<ReportViewer report={{ charts: [spec] }} sections={[{ key: 'charts', title: 'Charts' }]} lang="en" />);
    expect(screen.getByText('Asking price by listing')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('C-legit · odd-but-honest values in the viewer', () => {
  const cover = { from: ['shortlist'], nameKey: 'business', tiles: [{ labelKey: 'asking', field: 'askingPrice' }, { labelKey: 'revenue', field: 'revenue' }] };

  it('`askingPrice: null` prints neither "null" nor $0; the revenue tile still shows', () => {
    // Mutation that reds this: replace `isNum(v)` with `v != null` in DealCard's tile loop.
    const { container } = render(<ReportViewer report={{ shortlist: [{ business: 'Sunshine Coin Laundry', askingPrice: null, revenue: 310_000 }] }} sections={[{ key: 'shortlist', title: 'Shortlist' }]} lang="en" cover={cover} />);
    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).not.toContain('$0');
    expect(container.textContent).toContain('$310k');
  });

  it('a 180-character business name is shown whole, and a `risks` item holding a GFM table is drawn as a table (the PDF prints raw pipes — core c-legit)', () => {
    // Mutation that reds this: wrap the DealCard name in `clip()`; or drop remarkGfm from the risks <Markdown>.
    const name = 'Established Full-Service Coin Laundry & Wash-Dry-Fold with Real Estate — 40 Speed Queen Washers, 32 Dryers, Absentee-Run, SBA Pre-Qualified, Hialeah, Miami-Dade County, Florida (Est. 2007)';
    const { container } = render(<ReportViewer report={{ shortlist: [{ business: name, askingPrice: 450_000, risks: ['| Item | Cost |\n|---|---|\n| Dryers | $45,000 |'] }] }} sections={[{ key: 'shortlist', title: 'Shortlist' }]} lang="en" cover={cover} />);
    expect(screen.getByText(name)).toBeTruthy();
    expect(container.querySelector('table td')?.textContent).toBe('Dryers');
  });
});

describe('C-legit · the live progress line (JobView.tsx)', () => {
  it('shows the phase label from the manifest in the buyer’s language AND the search the model is running, quoted, as a query — the buyer still sees the research happening', () => {
    // Mutation that reds this: drop the `progressLine(...)` render in JobView (the naive "hide it" fix).
    showJob({ status: 'running', progress: { phase: 'research', kind: 'searched', detail: 'lavanderías en venta Miami-Dade', updatedAt: 't' } }, 'es');
    expect(screen.getByText('Investigando el mercado')).toBeTruthy();
    expect(screen.getByText('Buscando “lavanderías en venta Miami-Dade”')).toBeTruthy();
  });

  it('a Spanish buyer gets Spanish: the API hands this page the KIND (`writing`), never `Writing (market_overview, competitive_landscape).` — before the fix the engine’s English sentence with our schema keys was printed verbatim', () => {
    showJob({ status: 'running', progress: { phase: 'research', kind: 'writing', updatedAt: 't' } }, 'es');
    expect(screen.getByText('Redactando esta sección.')).toBeTruthy();
    expect(screen.queryByText(/market_overview/)).toBeNull();
    // …and a document written before `kind` existed shows the phase alone, no English.
    showJob({ status: 'running', progress: { phase: 'research', updatedAt: 't' } }, 'es');
    expect(screen.queryByText(/Searched|Writing|Researching/)).toBeNull();
  });
});
