/**
 * The shared read-only link, in the report's language.
 *
 * The sharper half of the same defect as `JobView`: this page is opened by someone
 * who did NOT commission the report — a broker, a lender, an accountant — whose UI
 * language has nothing to do with the document. Fetching the manifest in the
 * reader's language put English headings over Spanish prose on the one artifact
 * that gets forwarded.
 *
 * It has its own copy of the fetch (a token-scoped `useQuery`, not `useTemplate`),
 * which is why `report-language.test.tsx` could not see it: swapping this page back
 * to the reader's language left that file green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { calls } = vi.hoisted(() => ({ calls: { urls: [] as string[] } }));

vi.mock('../src/api/client', async (orig) => ({
  // Keep the real module for everything the page imports besides `api` —
  // `ApiError` is used to tell an expired link from a broken one.
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string) => {
    calls.urls.push(path);
    if (path.startsWith('/research/')) {
      return Promise.resolve({ jobId: 'j1', template: 't', status: 'running', params: { language: 'es' } });
    }
    return Promise.resolve({ sections: [], modes: [], steps: [] });
  },
}));
vi.mock('../src/components/ReportViewer', () => ({ ReportViewer: () => null }));

import { ReadReport } from '../src/pages/ReadReport';
import { LangProvider } from '../src/i18n';

function show(uiLang: string) {
  localStorage.setItem('fbizlab_lang', uiLang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/read/j1?rt=tok']}>
      <QueryClientProvider client={qc}>
        <LangProvider>
          <Routes>
            <Route path="/read/:jobId" element={<ReadReport />} />
          </Routes>
        </LangProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls.urls = [];
  localStorage.removeItem('fbizlab_lang');
});

describe('the shared report link', () => {
  it('asks for the manifest in the report’s language, not the reader’s', async () => {
    show('en');
    await waitFor(() => expect(calls.urls.some((u) => u.startsWith('/templates/'))).toBe(true));
    const manifest = calls.urls.find((u) => u.startsWith('/templates/'))!;
    expect(manifest).toContain('lang=es');
    expect(manifest).not.toContain('lang=en');
  });
});
