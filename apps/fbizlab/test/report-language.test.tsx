/**
 * A delivered report has to agree with itself.
 *
 * The body is written once, at generation, in the language the buyer asked for.
 * The section titles come from the manifest, and both `JobView` and `ReadReport`
 * were fetching that manifest in the READER's current UI language — so switching
 * the switcher put English headings over Spanish prose, while the PDF of the same
 * job (which reads `job.params.language`) kept the Spanish ones. Two documents,
 * one job.
 *
 * `ReadReport` is the sharper case: it is the shared link, opened by someone who
 * did not commission the report and whose UI language has nothing to do with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { job, seen } = vi.hoisted(() => ({
  job: { current: {} as Record<string, unknown> },
  seen: { langs: [] as (string | null)[] },
}));

vi.mock('../src/api/hooks', async (orig) => ({
  ...(await orig<typeof import('../src/api/hooks')>()),
  useJob: () => ({ data: job.current }),
  useJobReport: () => ({ data: undefined }),
  // The seam: whatever language JobView decides to ask the manifest for.
  useTemplate: (_id: string | null, lang?: string) => {
    seen.langs.push(lang ?? null);
    return { data: { steps: [], modes: [], sections: [] } };
  },
  // A field with a `catalog` hint fetches its list; a mock without this makes
  // every form in the file throw on an undefined hook.
  useCatalog: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../src/components/ReportViewer', () => ({ ReportViewer: () => null }));
vi.mock('../src/components/DownloadPdf', () => ({ DownloadPdf: () => null }));

import { JobView } from '../src/pages/JobView';
import { LangProvider } from '../src/i18n';

function show(data: Record<string, unknown>, uiLang: string) {
  job.current = { jobId: 'j1', template: 't', files: [], ...data };
  localStorage.setItem('fbizlab_lang', uiLang);
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

beforeEach(() => {
  seen.langs = [];
  localStorage.removeItem('fbizlab_lang');
});

describe('the report’s chrome follows the report, not the reader', () => {
  it('asks for the manifest in the language the report was written in', () => {
    show({ status: 'completed', params: { language: 'es' } }, 'en');
    expect(seen.langs.at(-1)).toBe('es');
  });

  it('does the same when the reader’s language is the odd one out', () => {
    // The mirror, so a hardcoded 'es' would not pass.
    show({ status: 'completed', params: { language: 'en' } }, 'es');
    expect(seen.langs.at(-1)).toBe('en');
  });

  it('falls back to the UI language when the job never recorded one', () => {
    // Older jobs, and the anonymous-preview path. Nothing should render blank.
    show({ status: 'completed', params: {} }, 'fr');
    expect(seen.langs.at(-1)).toBe('fr');
  });
});
