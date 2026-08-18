/**
 * The list a buyer lands on, for a job that is parked.
 *
 * `held` is written as a progress PHASE by the engine and had no step in the
 * manifest, so the row fell through `stepMap[phase] ?? phase` and printed the raw
 * English key `held` under a badge that said "En revisión" (round 7, G3-verify F4).
 * The fallback is the defect, not the missing label: an internal key is never a
 * thing to show a customer, in any language.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { state } = vi.hoisted(() => ({ state: { phase: 'held' } }));

vi.mock('../src/api/hooks', async (orig) => ({
  ...(await orig<typeof import('../src/api/hooks')>()),
  useJobs: () => ({
    data: {
      jobs: [
        {
          jobId: 'j1abc123', template: 't', status: 'held', title: 'Laundromats in Miami',
          createdAt: '2026-08-17T00:00:00.000Z', creditsSpent: 1, mode: 'comprehensive',
          progress: { phase: state.phase, updatedAt: '2026-08-17T00:00:00.000Z' },
        },
      ],
    },
  }),
  useBalance: () => ({ data: { credits: 3 } }),
  useMyStats: () => ({ data: { total: 1, ready: 0, inProgress: 1 } }),
  useTemplates: () => ({
    data: {
      templates: [
        { id: 't', steps: [{ id: 'planning', label: 'Planificando' }, { id: 'held', label: 'En revisión' }], modes: [{ key: 'comprehensive', label: 'Completo', credits: 1 }] },
      ],
    },
  }),
}));
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { email: 'b@x.com' } }) }));
vi.mock('../src/components/DownloadPdf', () => ({ DownloadPdf: () => null }));

import { Reports } from '../src/pages/Reports';
import { LangProvider } from '../src/i18n';

function show(lang = 'es') {
  localStorage.setItem('fbizlab_lang', lang);
  return render(
    <MemoryRouter>
      <LangProvider>
        <Reports />
      </LangProvider>
    </MemoryRouter>,
  );
}

describe('a parked job in the inbox', () => {
  it('shows the localized step, never the internal key', () => {
    state.phase = 'held';
    show();
    // Twice: the status badge and the step line — both localized, neither the key.
    expect(screen.getAllByText('En revisión').length).toBe(2);
    expect(screen.queryByText('held'), 'the internal key').toBeNull();
  });

  it('shows nothing at all for a phase it has no label for — not the key', () => {
    // Mutation that reds this: restore `stepMap[j.progress.phase] ?? j.progress.phase`.
    state.phase = 'a-phase-this-bundle-never-heard-of';
    show();
    expect(screen.queryByText('a-phase-this-bundle-never-heard-of')).toBeNull();
  });
});
