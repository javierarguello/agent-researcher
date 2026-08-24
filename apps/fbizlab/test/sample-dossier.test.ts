/**
 * The committed public dossier is the committed sample, unchanged.
 *
 * `public/sample-dossier.json` is GENERATED (`npm run sample:build`) and committed,
 * because the page that serves it is static and anonymous and cannot call an
 * authenticated API for the section titles. A generated file that is committed is a
 * file that goes stale in silence — someone edits the sample, or the report is
 * regenerated, and the site keeps serving the old one with nobody the wiser.
 *
 * So: the artifact must equal its source. The other half of the guard — that the
 * section TITLES still match the template's — lives in core, which owns them
 * (`packages/core/test/sample-dossier-titles.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const read = (p: string) => JSON.parse(readFileSync(`${HERE}/${p}`, 'utf8'));

const dossier = read('../public/sample-dossier.json');
const source = read('../../../samples/florida-hvac-statewide/report.json');
const params = read('../../../samples/florida-hvac-statewide/params.json');

describe('the published dossier tracks the sample it was built from', () => {
  it('publishes a PREFIX of the sample, never a rewrite of it', () => {
    // The bodies are cut (see below); what must hold is that cutting is ALL that
    // happened. Every string published is a prefix of the stored one and every list a
    // prefix of its list, walked field by field — so "we only removed" is a checked
    // property and not a claim in a comment. Run `npm run sample:build` if this fails.
    const walk = (pub: unknown, full: unknown, path: string): void => {
      if (typeof pub === 'string') {
        expect(typeof full, path).toBe('string');
        expect((full as string).startsWith(pub), `${path} is not a prefix of the stored text`).toBe(true);
        return;
      }
      if (Array.isArray(pub)) {
        expect(Array.isArray(full), path).toBe(true);
        expect(pub.length, `${path} kept more items than the sample has`).toBeLessThanOrEqual((full as unknown[]).length);
        pub.forEach((item, i) => walk(item, (full as unknown[])[i], `${path}[${i}]`));
        return;
      }
      if (pub && typeof pub === 'object') {
        for (const [k, v] of Object.entries(pub as Record<string, unknown>)) walk(v, (full as Record<string, unknown>)[k], `${path}.${k}`);
        return;
      }
      expect(pub, path).toEqual(full);
    };
    walk(dossier.report, source.report, 'report');
    expect(dossier.params).toEqual(params);
    const { cost: _cost, ...publishable } = source.meta;
    expect(dossier.meta).toEqual(publishable);
  });

  it('publishes an opening, not a section', () => {
    // The cut is what keeps the whole dossier from being extractable by fetching one
    // static file, so it is asserted on the artifact rather than left to the
    // generator's constants. Every section is shorter than its stored self, and the
    // lists a reader would harvest — the listings, the profiles, the evidence — keep
    // only their first entries.
    expect(Object.keys(dossier.preview.cut).length, 'every section is a preview').toBe(Object.keys(dossier.report).length);
    expect(JSON.stringify(dossier.report).length).toBeLessThan(JSON.stringify(source.report).length / 3);
    expect(dossier.report.shortlist.length).toBeLessThan(source.report.shortlist.length);
    expect(dossier.report.deep_dives.length).toBe(1);
    expect(dossier.report.sources.items.length).toBeLessThanOrEqual(10);
    expect(source.report.sources.items.length).toBeGreaterThan(200); // the premise
    // …and the badge row survives whole: aggregates, and the reason the page is worth
    // opening at all.
    expect(dossier.report.executive_summary.metrics).toEqual(source.report.executive_summary.metrics);
  });

  it('publishes none of our unit economics', () => {
    // `meta.cost` is what a report COST US — usd, llm vs search split, token counts,
    // search calls. The API deletes it for anyone who is not an admin
    // (`redactReportForBuyer`); this artifact never passes that boundary, so the
    // generator applies the same policy and this is the line that proves it did.
    // Beside the mode's credit price on the same page, it is the gross margin of
    // every report we sell.
    expect(source.meta.cost, 'the premise: the stored artifact HAS the figures').toBeTruthy();
    expect(dossier.meta.cost).toBeUndefined();
    const text = JSON.stringify(dossier);
    expect(text).not.toMatch(/llmUsd|searchUsd|inputTokens|outputTokens|searchCalls/);
    expect(text).not.toContain(String(source.meta.cost.usd));
  });

  it('titles only sections the report actually carries', () => {
    // A section title with no body renders as an empty heading — the mode excludes
    // sections, so the list is filtered at build time rather than assumed.
    const keys = dossier.sections.map((s: { key: string }) => s.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k: string) => dossier.report[k] === undefined)).toEqual([]);
    expect(dossier.sections.every((s: { title: string }) => !!s.title)).toBe(true);
  });

  it('states the RUN\u2019s cover figures, not the preview\u2019s', () => {
    // The snapshot is the one part of the page that describes the run rather than
    // what survived the cut. Aggregated from the three listings still published it
    // read "3 targets · $2.85M combined revenue" beside "sources consulted: 215" —
    // the product looking smaller than it is. Four aggregates, no row: a reader gets
    // the size of the work and not one price against one name.
    expect(dossier.preview.snapshot.targets).toBe(String(source.report.shortlist.length));
    expect(Number(dossier.preview.snapshot.targets)).toBeGreaterThan(dossier.report.shortlist.length);
    const revenues = source.report.shortlist.map((s: { revenue: number | null }) => s.revenue).filter((n: number | null) => typeof n === 'number');
    expect(revenues.length, 'the premise: the stored rows carry the figures').toBeGreaterThan(1);
    // Composed of aggregates only — nothing keyed to a business.
    expect(Object.keys(dossier.preview.snapshot).sort()).toEqual(['combinedRevenue', 'combinedSde', 'priceRange', 'targets']);
    for (const v of Object.values(dossier.preview.snapshot)) expect(typeof v).toBe('string');
  });

  it('carries what the viewer cannot ask an authenticated API for', () => {
    // The manifest halves: without these the public page draws a report with no
    // cover snapshot, dollar-less figures and an empty mandate card.
    expect(dossier.currency).toBeTruthy();
    expect(dossier.cover?.from?.length).toBeGreaterThan(0);
    expect(dossier.request.modeLabel).toBeTruthy();
    expect(dossier.request.sourcesFound).toBe((source.report.sources as { items: unknown[] }).items.length);
  });
});
