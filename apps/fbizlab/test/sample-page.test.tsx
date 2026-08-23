/**
 * The public sample dossier page — anonymous, API-free, and fed by the committed
 * artifact rather than a fixture.
 *
 * `fetch` is stubbed with the FILE the site actually ships
 * (`public/sample-dossier.json`), so this exercises the real report through the
 * real viewer: if the generator's shape and the page's expectations drift, the
 * dossier renders empty here rather than in production.
 *
 * What it must never do is call the API. `/templates` and `/research/:id` are
 * authenticated, and this page exists for visitors who have no session — the whole
 * point is that a stranger can read one complete report without signing up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { LangProvider } from '../src/i18n';
import { AuthProvider } from '../src/auth/AuthContext';
import { SampleReport } from '../src/pages/SampleReport';
import { App } from '../src/App';

// recharts measures its container; jsdom has no ResizeObserver.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const DOSSIER = readFileSync(`${HERE}/../public/sample-dossier.json`, 'utf8');

const fetched: string[] = [];
beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(String(url));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(DOSSIER)) } as Response);
  });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function show(uiLang = 'en') {
  localStorage.setItem('fbizlab_lang', uiLang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/sample']}>
      <QueryClientProvider client={qc}>
        <LangProvider><SampleReport /></LangProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the public sample dossier', () => {
  it('renders a real report from one static file, with no API call', async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('a').length).toBeGreaterThan(300));

    expect(fetched).toEqual(['/sample-dossier.json']);
    // Something from deep inside the report, not just the page chrome: the shortlist
    // this run actually produced.
    expect(screen.getAllByText(/HVAC/i).length).toBeGreaterThan(0);
  });

  it('offers no download: the PDF is a paid artifact of a job the visitor does not own', async () => {
    const { container } = show();
    await waitFor(() => expect(screen.getAllByText(/HVAC/i).length).toBeGreaterThan(0));

    // Not "the letters PDF are absent" — a cited source can be a .pdf and one is.
    // What must be absent is a CONTROL that offers the artifact, in any of the four
    // languages `DownloadPdf` speaks, and any link into the report's own endpoints.
    const controls = [...container.querySelectorAll('a, button')];
    expect(controls.filter((el) => /download|descarg|téléchar|baixar/i.test(el.textContent ?? ''))).toEqual([]);
    expect(controls.filter((el) => /\/research\//.test(el.getAttribute('href') ?? ''))).toEqual([]);
  });

  it('shows the request that produced it, in the reader’s language', async () => {
    const { container } = show('es');
    await waitFor(() => expect(screen.getByText('La solicitud que lo originó')).toBeTruthy());
    // Scoped to the request panel: the industry also appears inside the report's own
    // Search Criteria section, which is a different claim from "the page says what
    // was asked for".
    const panel = within(container.querySelector('.sample__rows') as HTMLElement);
    expect(panel.getByText('Industria')).toBeTruthy();
    expect(panel.getByText('HVAC and plumbing services')).toBeTruthy();
    // Spanish grouping and Spanish currency placement: `150.000 US$ – 3.000.000 US$`.
    // The dossier's figures stay in the model's currency; only the formatting is the
    // reader's (the split `makeNumFmt` exists for).
    expect(panel.getByText(/150\.000\s*US\$\s*–\s*3\.000\.000\s*US\$/)).toBeTruthy();
    expect(panel.getByText(/18 créditos/)).toBeTruthy();
  });

  it('says the dossier is in English when the reader is not', async () => {
    // The report's language is the report's, never the reader's — the rule the
    // shared read link already follows. A Spanish visitor gets a Spanish page around
    // an English dossier, and is told why rather than left to wonder.
    show('pt');
    await waitFor(() => expect(screen.getByText(/pesquisado em inglês/)).toBeTruthy());
  });

  it('does not claim the listings are still for sale', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/Listings move fast/)).toBeTruthy());
  });
});

describe('the /sample route', () => {
  it('is public — no session, and not behind RequireAuth', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/sample']}>
        <QueryClientProvider client={qc}>
          <AuthProvider><LangProvider><App /></LangProvider></AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // Signed out (no token in localStorage): a `RequireAuth` route would have
    // redirected to /login instead of rendering this.
    await waitFor(() => expect(screen.getByText('Sample dossier')).toBeTruthy());
  });

  it('is indexable, unlike a buyer’s own dossier', () => {
    // `App` marks `/report/:jobId` noindex — that is someone's paid research behind a
    // shared link. This page is the opposite: it exists to be found.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/sample']}>
        <QueryClientProvider client={qc}>
          <AuthProvider><LangProvider><App /></LangProvider></AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
  });
});
