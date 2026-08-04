/**
 * What the admin can actually SEE about a partial delivery.
 *
 * `summary.sections` was written by the engine, served by the API and typed in
 * `api/types.ts` — and rendered by nothing. So the one page that exists to decide
 * about a job could see THAT it degraded (a dashboard KPI) and never which parts,
 * or whether the buyer lost a section outright or just got a shallower one. Those
 * are different conversations with the customer, and only one of them is a refund.
 *
 * This is also the first test in this app. Its absence is why the gap survived:
 * nothing here could notice a field that goes out and is never read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { state } = vi.hoisted(() => ({
  state: { sections: undefined as Array<{ key: string; status: string }> | undefined },
}));

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string) => {
    if (path.startsWith('/research/')) {
      return Promise.resolve({
        jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com', template: 't', status: 'completed',
        params: {}, cost: { usd: 1 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        error: null,
        summary: { attempts: 1, ...(state.sections ? { sections: state.sections } : {}) },
      });
    }
    return Promise.resolve({ sections: [], modes: [], steps: [] });
  },
}));

import { JobDetail } from '../src/pages/JobDetail';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/jobs/j1']}>
        <QueryClientProvider client={qc}>
          <Routes><Route path="/jobs/:jobId" element={<JobDetail />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => { state.sections = undefined; });

describe('a partial delivery says which parts', () => {
  it('names the section and tells the two states apart', async () => {
    state.sections = [
      { key: 'financial_analysis', status: 'lost' },
      { key: 'market', status: 'unenriched' },
    ];
    show();

    await waitFor(() => expect(screen.getByText('financial_analysis')).toBeTruthy());
    expect(screen.getByText('market')).toBeTruthy();
    // The distinction, not just the keys: one buyer lost a section and the other
    // got a shallower one, and only one of those is a refund conversation.
    expect(screen.getByText('lost')).toBeTruthy();
    expect(screen.getByText('shallow')).toBeTruthy();
  });

  it('shows nothing for a clean job', async () => {
    // The control: a panel that is always there is furniture, and an admin stops
    // reading it.
    show();
    await waitFor(() => expect(screen.getByText('Dispatches')).toBeTruthy());
    expect(screen.queryByText(/did not come out whole/i)).toBeNull();
  });
});
