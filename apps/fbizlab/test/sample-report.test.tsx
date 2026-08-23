/**
 * The published sample renders — the artifact, not a fixture.
 *
 * `samples/florida-hvac-statewide/report.json` is a REAL comprehensive run
 * (`out/local-4ed81938`, 2026-08-22, $3.3065, 215 sources) kept in the repo to be
 * shown publicly. It is the only report in the tree that is both real and committed,
 * which makes it the one thing that can catch a viewer change against the shape a
 * live model actually produces — 18 sections, 410 anchors, metric badges, five
 * charts, prioritised risks, a projection table.
 *
 * Path resolved from `import.meta.url`, never from `process.cwd()`: a corpus test
 * that resolves relatively skips itself when the runner's cwd moves, and looks
 * exactly like a passing one (see `deep-review.md` § Field findings, F-4).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { ReportViewer } from '../src/components/ReportViewer';

// recharts measures its container; jsdom has no ResizeObserver.
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

// Taken off `import.meta.url` as a string: this suite runs in jsdom, where the global
// `URL` is jsdom's, and both `readFileSync(new URL(…))` and `fileURLToPath()` refuse it
// with "The URL must be of scheme file".
const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const SAMPLE = `${HERE}/../../../samples/florida-hvac-statewide/report.json`;
const doc = JSON.parse(readFileSync(SAMPLE, 'utf8')) as { meta: Record<string, unknown>; report: Record<string, unknown> };

const draw = () => {
  const sections = Object.keys(doc.report).map((k) => ({ key: k, title: k }));
  return { sections, ...render(<ReportViewer report={doc.report} sections={sections} meta={doc.meta} lang="en" />) };
};

describe('the sample dossier the site will show', () => {
  it('draws every section of a real report', () => {
    const { sections, container } = draw();
    expect(sections.length).toBe(18);
    // Non-vacuous: a viewer that rendered nothing would still "not throw".
    expect(container.querySelectorAll('a').length).toBeGreaterThan(300);
  });

  it('shows no link labelled with a raw url', () => {
    // 36 of this run's 165 prose links carry their own destination as their label.
    // Every one of them has to reach the reader as a host (F-2).
    const { container } = draw();
    const raw = [...container.querySelectorAll('a')].filter((a) => /^https?:\/\//.test((a.textContent ?? '').trim()));
    expect(raw.map((a) => a.textContent)).toEqual([]);
  });

  it('shows no engine vocabulary — 122 evidence tags in this report, none on the page', () => {
    // The artifact-level proof of the two render rules: this run carries 77 tags used
    // as a link label and 45 bare in prose, and a reader must see neither. `[S27]` is
    // per-agent dossier numbering, not a source number, so following it would be worse
    // than dropping it.
    const raw = JSON.stringify(doc.report);
    expect(raw.match(/\[[SP]\d/g)?.length, 'the premise: the stored report HAS them').toBeGreaterThan(100);

    const { container } = draw();
    const text = container.textContent ?? '';
    expect(text.match(/\[[SP]\d/g) ?? []).toEqual([]);
    // …and not merely unbracketed: no anchor is labelled `S2` either.
    const tagLabels = [...container.querySelectorAll('a')].filter((a) => /^[SP]\d{1,3}$/.test((a.textContent ?? '').trim()));
    expect(tagLabels).toEqual([]);
  });

  it('profiles only businesses the shortlist carries', () => {
    // What F-1 exists to prevent, asserted on the artifact rather than on a mock: a
    // full page about a business with no row, no projection and no recommendation
    // anywhere else in the dossier.
    const shortlist = (doc.report.shortlist as Array<{ business: string }>).map((s) => s.business);
    const profiled = (doc.report.deep_dives as Array<{ business: string }>).map((d) => d.business);
    expect(profiled.length).toBeGreaterThan(0);
    expect(profiled.filter((b) => !shortlist.includes(b))).toEqual([]);
  });
});
