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

const { job, tpl } = vi.hoisted(() => ({
  job: { current: {} as Record<string, unknown> },
  tpl: { current: { steps: [] as Array<Record<string, unknown>>, modes: [], sections: [] } as Record<string, unknown> },
}));

vi.mock('../src/api/hooks', async (orig) => ({
  // The real module for anything the mock does not name — otherwise the polling
  // predicate below is unreachable and a test can claim it without touching it.
  ...(await orig<typeof import('../src/api/hooks')>()),
  useJob: () => ({ data: job.current }),
  useJobReport: () => ({ data: undefined }),
  useTemplate: () => ({ data: tpl.current }),
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

  it('shows the paused line in the buyer’s language from the KIND the API hands it — the engine’s own sentence never reaches this page', () => {
    // Mutation that reds this: render `job.progress.message` again (the API no
    // longer sends it to a buyer, so the line would simply vanish).
    show({ status: 'held', progress: { phase: 'held', kind: 'held', updatedAt: 't' }, summary: null });
    expect(screen.getByText(/paused while we review it/i)).toBeTruthy();
    show({ status: 'held', progress: { phase: 'held', kind: 'held', updatedAt: 't' }, summary: null }, 'es');
    expect(screen.getByText(/en pausa mientras lo revisamos/i)).toBeTruthy();
  });

  it('does not headline a parked job "Generating your dossier…" — the manifest has a step for `held` now', async () => {
    // The live card's headline is `stepsById[phase]?.label ?? t.working`, and `held`
    // was the one phase with no step. So the page said "Generando tu dossier…" in
    // bold, under a badge that said "En revisión", while nothing was being generated
    // at all (round 7, R7-5). The manifest steps here are what `buildSteps` now
    // emits — pinned on the core side in `progress-kinds.test.ts`.
    tpl.current = { steps: [{ id: 'planning', label: 'Planificando' }, { id: 'held', label: 'En revisión', description: 'Alguien está revisando este dossier antes de continuar.' }], modes: [], sections: [] };
    show({ status: 'held', progress: { phase: 'held', kind: 'held', updatedAt: 't' }, summary: null }, 'es');
    expect(screen.queryByText(/generando tu dossier/i)).toBeNull();
    expect(screen.getAllByText(/en revisión/i).length).toBeGreaterThan(0);
    // …and the line the API's `kind` gives it is still there, and says something
    // the step description does not.
    expect(screen.getByText(/alguien está revisando este dossier/i)).toBeTruthy();
    expect(screen.getByText(/en pausa mientras lo revisamos/i)).toBeTruthy();
  });

  it('reads the live line in the REPORT’s language, like the label above it', async () => {
    // The bold step label comes from the manifest, fetched in the report's language;
    // the line under it was rendered in the UI's. A buyer who switched the switcher
    // mid-wait read the two halves of one card in two languages (round 7, R7-23).
    // Mutation that reds this: `progressLine(job.progress, lang)`.
    tpl.current = { steps: [{ id: 'deal-scout', label: 'Buscador de negocios' }], modes: [], sections: [] };
    show({ status: 'running', params: { language: 'es' }, progress: { phase: 'deal-scout', kind: 'writing', updatedAt: 't' }, summary: null }, 'en');
    expect(screen.getByText('Buscador de negocios')).toBeTruthy();
    expect(screen.getByText(/redactando esta sección/i)).toBeTruthy();
    expect(screen.queryByText(/writing this section/i)).toBeNull();
  });

  it('counts a held job as live, so the page keeps polling', async () => {
    // Asserted where the predicate actually lives. This page mocks `useJob`
    // wholesale, so a test rendered through it can say "still looks live" and mean
    // nothing — dropping `held` from LIVE left it green. An approval puts the job
    // back in the queue with no action from the buyer; a page that stopped polling
    // would sit on "Under review" forever.
    const { LIVE } = await import('../src/api/hooks');
    expect(LIVE.has('held')).toBe(true);
    expect(LIVE.has('completed')).toBe(false);
  });
});

describe('an incomplete report explains itself in the buyer’s words', () => {
  it('shows the notice the API wrote for them', () => {
    show({
      status: 'completed',
      progress: null,
      summary: { notice: 'Una sección de este dossier no pudo completarse con fuentes confiables.', sections: [{ key: 'x', status: 'lost' }] },
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
    // `useJobReport` is mocked to `{ data: undefined }` for this file, so a
    // COMPLETED job takes the "Loading dossier…" branch and the notice this test
    // names is never rendered either way — `{job.summary?.notice && …}` could be
    // widened to `{job.summary && …}` with the whole suite green.
    //
    // Asserted against its own opposite instead: with a notice present the card
    // appears, without one it does not, and both run through the same branch.
    show({ status: 'completed', progress: null, summary: { durationMs: 1000 } });
    // On the CARD's own heading, not on the notice text: widening the condition to
    // `job.summary && …` renders an empty card, which a search for the notice's
    // words cannot see.
    expect(screen.queryByText('Notes')).toBeNull();
    expect(screen.queryByText(/section/i)).toBeNull();
  });

  it('shows the notice when there IS one, and only then', () => {
    show({ status: 'completed', progress: null, summary: { durationMs: 1000, notice: 'One section could not be completed.' } });
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText(/One section could not be completed/)).toBeTruthy();
  });
});

/**
 * P-10 — the screen's permission to walk away.
 *
 * A comprehensive run takes about twenty minutes and this card used to say
 * nothing about closing it, so the buyer's reasonable model was "if I leave, I
 * lose it". The completion mail has existed all along.
 */
describe('telling the buyer they can close the page', () => {
  it('says so while the job is live, in the language the switcher is on', () => {
    show({ status: 'running', progress: null, summary: null, notify: true }, 'es');
    expect(screen.getByText(/cerrar esta página con tranquilidad/i)).toBeTruthy();
  });

  it('says NOTHING when the app cannot send the mail', () => {
    // `notify` is the API's answer, taken from the SAME condition the worker sends
    // on. Without the gate this line is a promise that is true for one app by
    // coincidence and silently false for the next — and the buyer pays for the
    // error by closing the tab and waiting for mail nobody sends.
    show({ status: 'running', progress: null, summary: null, notify: false }, 'en');
    expect(screen.queryByText(/close this page/i)).toBeNull();
  });

  it('…and nothing at all for a job that predates the flag', () => {
    show({ status: 'running', progress: null, summary: null }, 'en');
    expect(screen.queryByText(/close this page/i)).toBeNull();
  });

  it('stops saying it once the dossier is ready — there is nothing left to wait for', () => {
    show({ status: 'completed', progress: null, summary: null, notify: true }, 'en');
    expect(screen.queryByText(/close this page/i)).toBeNull();
  });

  it('and a held job still gets it — it is live, and the wait is longer, not shorter', () => {
    // `held` is a live state: an admin is deciding, and the buyer can do nothing
    // to hurry it. It is the state where sitting on the screen is most wasteful.
    show({ status: 'held', progress: null, summary: null, notify: true }, 'en');
    expect(screen.getByText(/close this page/i)).toBeTruthy();
  });
});
