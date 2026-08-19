/**
 * The buyer app's copy of the section-status rule, held to core's table.
 *
 * `meta.sections` replaced `meta.degradedSections`, and neither renderer had a
 * reader for the old name. Every `report.json` written before that deploy is
 * still in Cloud Storage and still served to this component, so `verdict` came
 * back with `status` matching nothing, the placeholder body rendered — "buy", at
 * a price of zero — and `sectionsNotice` returned '' so the page said nothing
 * either. Fail-open on the one contract that has to fail closed.
 *
 * This app is a static bundle with no dependency on `@agent-researcher/core`, so
 * the coercion exists twice. The fixture below is core's, imported across the
 * workspace boundary on purpose: the two copies cannot drift without one of the
 * two suites going red. That is the lesson from `money()`, which was hoisted
 * correctly here and rebuilt per value in the PDF for months.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportViewer } from '../src/components/ReportViewer';
import { normalizeSectionStatuses } from '../src/lib/section-status';
import { LEGACY_SHAPES } from '../../../packages/core/test/fixtures/legacy-section-shapes';

const report = {
  verdict: { recommendation: 'buy', price: 0, summary: 'ZZPLACEHOLDER' },
  market: { text: 'Laundromat demand in Miami-Dade grew 12% year over year.' },
};
const sections = [
  { key: 'verdict', title: 'Verdict' },
  { key: 'market', title: 'Market' },
];

describe('the browser copy agrees with core, shape for shape', () => {
  it.each(LEGACY_SHAPES)('$why', ({ args, expected }) => {
    expect(normalizeSectionStatuses(...args)).toEqual(expected);
  });
});

describe('a report written before the rename', () => {
  it('still has its fabricated section suppressed', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ degradedSections: ['verdict'] }} lang="en" />,
    );
    expect(screen.queryByText(/ZZPLACEHOLDER/)).toBeNull();
    expect(screen.queryByText(/\bbuy\b/i), 'the word the schema forced the placeholder to pick').toBeNull();
    expect(screen.getByText(/could not complete this section/i)).toBeTruthy();
  });

  it('and one whose meta.sections is still a list of strings', () => {
    // The held-job path: a checkpoint parked before the rename, approved after.
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: ['verdict'] }} lang="en" />,
    );
    expect(screen.queryByText(/ZZPLACEHOLDER/)).toBeNull();
    expect(screen.getByText(/could not complete this section/i)).toBeTruthy();
  });

  it('loses nothing else in the process', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ degradedSections: ['verdict'] }} lang="en" />,
    );
    expect(screen.getByText(/grew 12% year over year/i)).toBeTruthy();
  });
});

describe('a reconstructed section keeps its body and its own line', () => {
  // The section no producer ever wrote (round 7, R7-1). Borrowing the
  // `unenriched` line here tells the buyer it "was researched and written" —
  // which is the one thing that did not happen — and suppressing it throws away
  // what the enricher did build from the rest of the dossier.
  const meta = { sections: [{ key: 'market', status: 'reconstructed' }] };

  it('renders the body', () => {
    render(<ReportViewer report={report} sections={sections} meta={meta} lang="en" />);
    expect(screen.getByText(/grew 12% year over year/i)).toBeTruthy();
    expect(screen.queryByText(/could not complete this section/i)).toBeNull();
  });

  it('does not claim the section was researched', () => {
    render(<ReportViewer report={report} sections={sections} meta={meta} lang="en" />);
    expect(screen.queryByText(/step that adds extra depth/i)).toBeNull();
    expect(screen.getByText(/step that researches this section did not finish/i)).toBeTruthy();
  });
});

describe('an unenriched section keeps its body on screen', () => {
  // Suppressing both statuses in this component left every suite green: no test
  // anywhere passed `unenriched` to a renderer, and the only behaviour the status
  // exists for was guarded by nothing.
  it('renders the work the buyer paid for, with no false apology', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'market', status: 'unenriched' }] }} lang="en" />,
    );
    expect(screen.getByText(/grew 12% year over year/i)).toBeTruthy();
    expect(screen.queryByText(/could not complete this section/i)).toBeNull();
  });

  it('but says the depth pass did not finish', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'market', status: 'unenriched' }] }} lang="en" />,
    );
    expect(screen.getByText(/step that adds extra depth/i)).toBeTruthy();
  });

  it('suppresses the same section when it is lost — the control', () => {
    render(
      <ReportViewer report={report} sections={sections} meta={{ sections: [{ key: 'market', status: 'lost' }] }} lang="en" />,
    );
    expect(screen.queryByText(/grew 12% year over year/i)).toBeNull();
    expect(screen.getByText(/could not complete this section/i)).toBeTruthy();
  });
});
