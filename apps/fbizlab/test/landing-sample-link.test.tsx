/**
 * The landing's promise, kept.
 *
 * The hero's second button has said "See a sample summary" since the site launched
 * and scrolled to a list of bullet points describing what a summary CONTAINS. Now
 * that one complete real dossier is published, both the button and the section that
 * lists those bullets link to it.
 *
 * Asserted as real links rather than click handlers: a crawler, a middle-click and
 * a "copy link address" all have to reach the dossier, which a scroll handler does
 * not give them.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LANDING_COPY } from '../src/content/landing-copy.mjs';
import { LangProvider, LANGS } from '../src/i18n';
import { AuthProvider } from '../src/auth/AuthContext';
import { Landing } from '../src/pages/Landing';

vi.mock('../src/api/hooks', () => ({
  usePublicPlans: () => ({ data: { plans: [] } }),
  useCheckout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function show(lang: string) {
  localStorage.setItem('fbizlab_lang', lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[lang === 'en' ? '/' : `/${lang}`]}>
      <QueryClientProvider client={qc}>
        <AuthProvider><LangProvider><Landing /></LangProvider></AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the landing links to the published sample dossier', () => {
  it.each(LANGS)('%s: both entry points are links to /sample', (lang) => {
    const c = LANDING_COPY[lang];
    show(lang);

    expect(screen.getByRole('link', { name: c.hero.cta2 }).getAttribute('href')).toBe('/sample');
    expect(screen.getByRole('link', { name: c.insum.cta }).getAttribute('href')).toBe('/sample');
  });

  it('keeps the section the button used to scroll to, which the footer still links', () => {
    // The hero CTA stopped being the only way into `#inside`; the footer's product
    // links still point at it, so removing the section because "nothing links to it"
    // would leave those dead.
    const { container } = show('en');
    expect(container.querySelector('#inside')).toBeTruthy();
    const anchors = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(anchors).toContain('#inside');
  });
});
