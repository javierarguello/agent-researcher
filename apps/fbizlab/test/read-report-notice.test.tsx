/**
 * The forwarded copy of an incomplete report.
 *
 * `JobView` shows `summary.notice` and this page did not — so the person a buyer
 * SHARES the report with (the partner, the lender, the accountant) read a dossier
 * with a section missing and nothing anywhere saying so. They are also the reader
 * least able to ask us about it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { state } = vi.hoisted(() => ({ state: { notice: undefined as string | undefined } }));

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string) => {
    if (path.startsWith('/research/') && path.includes('/report')) {
      return Promise.resolve({ meta: {}, report: { market: { text: 'x' } } });
    }
    if (path.startsWith('/research/')) {
      return Promise.resolve({
        jobId: 'j1', template: 't', status: 'completed', params: { language: 'es' },
        ...(state.notice ? { summary: { notice: state.notice } } : {}),
      });
    }
    return Promise.resolve({ sections: [], modes: [], steps: [] });
  },
}));
vi.mock('../src/components/ReportViewer', () => ({ ReportViewer: () => <div>VIEWER</div> }));

import { ReadReport } from '../src/pages/ReadReport';
import { LangProvider } from '../src/i18n';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/read/j1?rt=tok']}>
      <QueryClientProvider client={qc}>
        <LangProvider>
          <Routes><Route path="/read/:jobId" element={<ReadReport />} /></Routes>
        </LangProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { state.notice = undefined; });

describe('a shared report says when it is incomplete', () => {
  it('shows the notice the API wrote, in the report’s language', async () => {
    state.notice = 'Una sección de este dossier no pudo completarse con fuentes confiables.';
    show();
    await waitFor(() => expect(screen.getByText(/no pudo completarse con fuentes confiables/i)).toBeTruthy());
  });

  it('shows nothing at all on a clean report', async () => {
    // The control: a banner that is always there is not a notice, it is furniture,
    // and a reader stops seeing it.
    show();
    await waitFor(() => expect(screen.getByText('VIEWER')).toBeTruthy());
    expect(screen.queryByText(/no pudo completarse/i)).toBeNull();
  });
});
