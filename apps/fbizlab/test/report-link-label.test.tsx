/**
 * A citation whose LABEL is the url again — the viewer half.
 *
 * Twin of `packages/core/test/link-label.test.ts`: the same report reaches a
 * reader through two renderers, and the split between them is where this codebase
 * keeps finding defects (`tel:` links, escaped ampersands, link titles). Measured
 * on the 2026-08-22 statewide run: 36 of 165 prose links carry their destination
 * as their own label.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportViewer } from '../src/components/ReportViewer';

const URL = 'https://www.example-broker.test/reports/hvac-florida-2026?utm_source=news&utm_medium=email';
const sections = [{ key: 'market', title: 'Market' }];
const show = (market: string) => render(<ReportViewer report={{ market }} sections={sections} meta={{}} lang="en" />);

describe('a link labelled with its own url is shown as its host', () => {
  it('shows the host and still links to the whole url', () => {
    show(`Demand grew 15% ([${URL}](${URL})).`);

    const a = screen.getByRole('link', { name: 'example-broker.test' });
    expect(a.getAttribute('href')).toBe(URL);
    // The query string is in the href, never in the sentence.
    expect(screen.queryByText(/utm_source/)).toBeNull();
  });

  it('leaves a label a human would write exactly as written', () => {
    show(`See the [Florida DBPR licensing rules](${URL}).`);
    expect(screen.getByRole('link', { name: 'Florida DBPR licensing rules' }).getAttribute('href')).toBe(URL);
  });

  it('shortens a GFM autolink too, which is a url BY CONSTRUCTION', () => {
    show(`The filing is at ${URL} for now.`);
    expect(screen.getByRole('link', { name: 'example-broker.test' }).getAttribute('href')).toBe(URL);
  });

  it('keeps a rich label whole rather than reaching for its first string', () => {
    show(`Read [**the full filing** here](${URL}).`);
    const a = screen.getByRole('link', { name: /the full filing here/ });
    expect(a.querySelector('strong')).toBeTruthy();
  });
});

describe('the engine’s own evidence tags never reach the reader', () => {
  it('shows the source’s host where the model labelled a link with our tag', () => {
    show(`The market grew 15% ([S2](${URL})).`);
    const a = screen.getByRole('link', { name: 'example-broker.test' });
    expect(a.getAttribute('href')).toBe(URL);
    expect(screen.queryByText(/S2/)).toBeNull();
  });

  it('removes a tag with nothing behind it, and the space it sat in', () => {
    show('The licence does not transfer to the buyer [P3]. Plan for it.');
    expect(screen.getByText('The licence does not transfer to the buyer. Plan for it.')).toBeTruthy();
  });

  it('strips them in a risk list too, not only in paragraphs', () => {
    // Four prose paths render Markdown in this file; a rule applied to the paragraph
    // one and not to the others is the shape this codebase keeps finding.
    render(
      <ReportViewer
        report={{ risks: [{ severity: 'high', title: 'Licence', detail: 'Not transferable [S8].' }] }}
        sections={[{ key: 'risks', title: 'Risks' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(screen.getByText('Not transferable.')).toBeTruthy();
  });
});
