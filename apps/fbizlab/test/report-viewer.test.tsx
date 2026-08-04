/**
 * What the buyer is shown when a section could not be completed (G2).
 *
 * A degraded section still SATISFIES the report schema — that is what makes the
 * report deliverable — so its body holds whatever the schema's shape demanded: a
 * required enum becomes its first value, a required number becomes 0. Rendered,
 * that is a recommendation the engine never made and a price of zero presented as
 * a finding, to someone who paid for investment research.
 *
 * The schema cannot carry this guarantee on its own, so the contract is
 * `meta.degradedSections` and the viewer is the half that has to honour it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportViewer } from '../src/components/ReportViewer';

const report = {
  verdict: { recommendation: 'buy', price: 0, summary: 'We could not complete this section.' },
  market: { text: 'Laundromat demand in Miami-Dade grew 12% year over year.' },
};
const sections = [
  { key: 'verdict', title: 'Verdict' },
  { key: 'market', title: 'Market' },
];

describe('a degraded section is never rendered as findings', () => {
  it('shows our apology instead of the filler the schema required', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'verdict', status: 'lost' }] }} lang="en" />,
    );

    // The word the placeholder was forced to pick must not reach the reader.
    expect(screen.queryByText(/\bbuy\b/i)).toBeNull();
    expect(screen.getByText(/could not complete this section/i)).toBeTruthy();
  });

  it('renders every other section exactly as before', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'verdict', status: 'lost' }] }} lang="en" />,
    );
    // One missing section must not cost the buyer the rest of the report.
    expect(screen.getByText(/grew 12% year over year/i)).toBeTruthy();
  });

  it('speaks the buyer’s language', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'verdict', status: 'lost' }] }} lang="es" />,
    );
    expect(screen.getByText(/no pudimos completar esta sección/i)).toBeTruthy();
  });

  it('never computes the headline numbers from a degraded section', () => {
    // The snapshot at the top adds up every deal in the report. A degraded
    // `deep_dives` is an array of placeholder rows whose prices are zero, so
    // including it drags the range down to $0 — a number the buyer reads as the
    // cheapest target we found.
    render(
      <ReportViewer
        report={{
          shortlist: [{ business: 'Sunshine Coin Laundry', askingPrice: 410_000 }],
          deep_dives: [{ business: '', askingPrice: 0 }, { business: '', askingPrice: 0 }],
        }}
        sections={[{ key: 'shortlist', title: 'Shortlist' }, { key: 'deep_dives', title: 'Deep dives' }]}
        meta={{ sections: [{ key: 'deep_dives', status: 'lost' }] }}
        lang="en"
      />,
    );

    // The range must be the one real target, not "$0–$410k".
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.getAllByText(/410/).length).toBeGreaterThan(0);
  });

  it('leaves an ordinary report untouched', () => {
    render(<ReportViewer report={report} sections={sections} meta={{}} lang="en" />);
    // Nothing degraded → nothing suppressed.
    expect(screen.queryByText(/could not complete this section for this report/i)).toBeNull();
  });
});

describe('the cover belongs to the model, on screen too', () => {
  // This component has its own four-language dictionary, and its cover entries are
  // the flagship's vocabulary — `targets`, `priceRange`, `combinedSde`. So the
  // flagship looked right and any other model's snapshot printed its raw keys.
  // `CoverSpec.labelKey` is documented as looked up in `TemplateI18n.cover`; the
  // manifest now resolves that and passes it in.
  const wind = {
    report: { sites: [{ parcel: 'Caliche Flats', acres: 900, capacityMw: 120 }] },
    sections: [{ key: 'sites', title: 'Sites' }],
    cover: {
      from: ['sites'], nameKey: 'parcel',
      figures: [{ labelKey: 'parcelsScreened', agg: 'count' as const }],
      tiles: [{ labelKey: 'usableAcres', field: 'acres' }],
    },
  };

  it('uses the labels the manifest resolved, in the reader’s language', () => {
    render(<ReportViewer {...wind} lang="es" coverLabels={{ parcelsScreened: 'Parcelas evaluadas', usableAcres: 'Acres utilizables' }} />);
    expect(screen.getByText('Parcelas evaluadas')).toBeTruthy();
    expect(screen.getByText('Acres utilizables')).toBeTruthy();
  });

  it('falls back to a readable label, never to the raw key', () => {
    render(<ReportViewer {...wind} lang="en" />);
    expect(screen.getByText('Parcels screened')).toBeTruthy();
    expect(screen.queryByText('parcelsScreened'), 'the raw key, shown to a buyer').toBeNull();
  });
});
