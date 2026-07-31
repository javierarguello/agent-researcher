/**
 * What the buyer is told about their own job.
 *
 * Two things this week made customer-facing, both of which compile perfectly while
 * being wrong:
 *
 *   - `held` — a job we parked for a decision. The client had never heard of the
 *     status, and an unknown status renders as a blank or a raw machine word.
 *   - the incomplete-report notice, which used to be `trace.warnings` verbatim:
 *     `Degraded [risks_red_flags] from agent "market-analyst"…`, in English, to
 *     Spanish and French customers. The API stopped sending it; this checks the
 *     client stopped expecting it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { job } = vi.hoisted(() => ({ job: { current: {} as Record<string, unknown> } }));

vi.mock('../src/api/hooks', () => ({
  useJob: () => ({ data: job.current }),
  useJobReport: () => ({ data: undefined }),
  useTemplate: () => ({ data: { steps: [], modes: [], sections: [] } }),
}));
vi.mock('../src/components/ReportViewer', () => ({ ReportViewer: () => null }));
vi.mock('../src/components/DownloadPdf', () => ({ DownloadPdf: () => null }));

import { JobView } from '../src/pages/JobView';
import { LangProvider } from '../src/i18n';

function show(data: Record<string, unknown>, lang = 'en') {
  job.current = { jobId: 'j1', template: 't', params: {}, files: [], ...data };
  localStorage.setItem('fbizlab_lang', lang);
  return render(
    <MemoryRouter initialEntries={['/app/jobs/j1']}>
      <LangProvider>
        <Routes>
          <Route path="/app/jobs/:jobId" element={<JobView />} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );
}

describe('a job parked for a decision', () => {
  it('reads as under review, not as a failure and not as a blank', () => {
    show({ status: 'held', progress: null, summary: null });

    expect(screen.getByText(/under review/i)).toBeTruthy();
    // It has not failed. Telling a buyer their report failed while an admin is
    // deciding whether to finish it is both wrong and unrecoverable-sounding.
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });

  it('says so in the buyer’s language', () => {
    show({ status: 'held', progress: null, summary: null }, 'es');
    expect(screen.getByText(/en revisión/i)).toBeTruthy();
  });

  it('still looks live, so the page keeps itself up to date', () => {
    // An approval puts the job back in the queue with no action from the buyer, so
    // the view has to be one that refreshes rather than one that has settled.
    show({ status: 'held', progress: { phase: 'held', message: 'Paused for review.' }, summary: null });
    expect(screen.getByText(/paused for review/i)).toBeTruthy();
  });
});

describe('an incomplete report explains itself in the buyer’s words', () => {
  it('shows the notice the API wrote for them', () => {
    show({
      status: 'completed',
      progress: null,
      summary: { notice: 'Una sección de este dossier no pudo completarse con fuentes confiables.', degradedSections: ['x'] },
    }, 'es');

    expect(screen.getByText(/no pudo completarse con fuentes confiables/i)).toBeTruthy();
  });

  it('has no way left to render raw diagnostics', () => {
    // The old shape. Even if something upstream started sending `warnings` again,
    // this client no longer has a path that puts them on screen.
    show({
      status: 'completed',
      progress: null,
      summary: { warnings: ['Degraded [risks_red_flags] from agent "market-analyst" after exhausting retries'] },
    } as Record<string, unknown>);

    expect(screen.queryByText(/market-analyst/)).toBeNull();
    expect(screen.queryByText(/risks_red_flags/)).toBeNull();
  });

  it('says nothing at all about a report that came back whole', () => {
    show({ status: 'completed', progress: null, summary: { durationMs: 1000 } });
    expect(screen.queryByText(/section/i)).toBeNull();
  });
});
