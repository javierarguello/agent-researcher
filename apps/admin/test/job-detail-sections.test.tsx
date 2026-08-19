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
  state: {
    sections: undefined as Array<{ key: string; status: string }> | undefined,
    agents: undefined as Array<Record<string, unknown>> | undefined,
  },
}));

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string) => {
    if (path.startsWith('/research/')) {
      return Promise.resolve({
        jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com', template: 't', status: 'completed',
        params: {}, cost: { usd: 1 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        error: null,
        summary: { attempts: 1, ...(state.sections ? { sections: state.sections } : {}), ...(state.agents ? { agents: state.agents } : {}) },
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

beforeEach(() => { state.sections = undefined; state.agents = undefined; });

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

  it('does not call a rebuilt section a shallow one', async () => {
    // `reconstructed` means the producer never delivered the section and an
    // enricher wrote it on the finalize pass. A binary lost/shallow render told
    // the admin it was "written and delivered, but the step that deepens it never
    // finished" — the opposite (round 7, R7-1), and the wrong refund call.
    state.sections = [{ key: 'charts', status: 'reconstructed' }];
    show();

    await waitFor(() => expect(screen.getByText('charts')).toBeTruthy());
    expect(screen.getByText('rebuilt')).toBeTruthy();
    expect(screen.queryByText('shallow')).toBeNull();
    expect(screen.getByText(/an enricher wrote it on the finalize pass/i)).toBeTruthy();
  });

  it('tells a step that researched nothing from one that did — the loop, next to the cost', async () => {
    // `ok · 1 try · $0.38` was the whole row, so the agent that made 22 plan updates
    // and zero searches was byte-identical to the one that did 21 real turns
    // (round 7, R7-30). `gatherStop` existed and reached no screen; on a
    // multi-dispatch job it is the ONLY surviving signal, because `slimAgents()`
    // blanks the loop's closing note in the checkpoint.
    state.agents = [
      { id: 'deal-scout', wave: 1, status: 'ok', durationMs: 1000, attempts: 1, costUsd: 0.38, turnsUsed: 21, gatherStop: 'budget' },
      { id: 'deep-dive-refiner', wave: 2, status: 'ok', durationMs: 1000, attempts: 1, costUsd: 0.38, turnsUsed: 0, gatherStop: 'stalled' },
      { id: 'chart-analyst', wave: 3, status: 'ok', durationMs: 500, attempts: 1, costUsd: 0.02 },
    ];
    show();

    await waitFor(() => expect(screen.getAllByText('deal-scout').length).toBeGreaterThan(0));
    expect(screen.getByText('21 turns')).toBeTruthy();
    expect(screen.getByText('budget')).toBeTruthy();
    expect(screen.getByText('0 turns')).toBeTruthy();
    expect(screen.getByText('stalled')).toBeTruthy();
    // A synthesizer never had a loop; a bare `0` there would read as a failure.
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('every column holds what its header says — the row has a cell per header (R8-8)', async () => {
    // `6780c94` added the `Research` header and REPLACED the `Tries` cell instead of
    // adding one: seven headers over six cells, so every column after `Duration`
    // read the one to its left — the loop under `Tries`, the cost under `Research`,
    // an empty `Cost` — and the retry count, with its `attempts > 1` warning colour,
    // was gone from the page. Its own test asserted presence and never position,
    // which is how a commit whose subject is "a field no admin page can read"
    // shipped by making another one unreadable. Mutation that reds this: delete the
    // `Tries` cell again.
    state.agents = [
      { id: 'deal-scout', wave: 1, status: 'ok', durationMs: 1000, attempts: 3, costUsd: 0.38, turnsUsed: 21, gatherStop: 'budget' },
    ];
    show();

    await waitFor(() => expect(screen.getAllByText('deal-scout').length).toBeGreaterThan(0));
    const table = screen.getByText('Research').closest('table')!;
    const headers = [...table.querySelectorAll('thead th')].map((h) => h.textContent);
    const cells = [...table.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells.length, `${headers.join('|')} vs ${cells.join('|')}`).toBe(headers.length);
    const at = (name: string) => cells[headers.indexOf(name)];
    expect(at('Tries'), 'the retry count is back, under its own header').toBe('3');
    expect(at('Research')).toContain('21 turns');
    expect(at('Cost')).toContain('0.38');
  });

  it('says WHY an agent has no turns — it is a writer (R8-27)', async () => {
    // `d1dab19` added `AgentTrace.kind` "so an admin can see why an agent has no
    // turns: it is a writer". It reached the trace and no screen: `JobSummary.agents`
    // carried six fields, `kind` was not one of them, and the Research cell printed
    // `—` for a synthesizer exactly as it does for a producer whose loop never ran.
    // Those are different conversations. Mutation that reds this: drop `kind` from
    // the summary row in `run-job.ts`, or from the Research cell.
    state.agents = [
      { id: 'exec-summary', wave: 3, status: 'ok', durationMs: 900, attempts: 1, costUsd: 0.11, kind: 'writer' },
      { id: 'deal-scout', wave: 1, status: 'ok', durationMs: 1000, attempts: 1, costUsd: 0.38, turnsUsed: 21, gatherStop: 'budget', kind: 'researcher' },
    ];
    show();

    await waitFor(() => expect(screen.getAllByText('exec-summary').length).toBeGreaterThan(0));
    const table = screen.getByText('Research').closest('table')!;
    const headers = [...table.querySelectorAll('thead th')].map((h) => h.textContent);
    const row = (i: number) => [...table.querySelectorAll('tbody tr')[i]!.querySelectorAll('td')].map((c) => c.textContent);
    const writer = row(0);
    expect(writer[headers.indexOf('Research')], 'a dash reads as "the loop did nothing"').toContain('writer');
    // …and an agent that DID research still reads as it did.
    expect(row(1)[headers.indexOf('Research')]).toContain('21 turns');
  });

  it('shows nothing for a clean job', async () => {
    // The control: a panel that is always there is furniture, and an admin stops
    // reading it.
    show();
    await waitFor(() => expect(screen.getByText('Dispatches')).toBeTruthy());
    expect(screen.queryByText(/did not come out whole/i)).toBeNull();
  });
});
