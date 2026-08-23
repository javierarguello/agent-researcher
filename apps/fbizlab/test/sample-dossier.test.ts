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
  it('serves the sample report byte for byte', () => {
    // Run `npm run sample:build` if this fails.
    expect(dossier.report).toEqual(source.report);
    expect(dossier.params).toEqual(params);
    const { cost: _cost, ...publishable } = source.meta;
    expect(dossier.meta).toEqual(publishable);
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

  it('carries what the viewer cannot ask an authenticated API for', () => {
    // The manifest halves: without these the public page draws a report with no
    // cover snapshot, dollar-less figures and an empty mandate card.
    expect(dossier.currency).toBeTruthy();
    expect(dossier.cover?.from?.length).toBeGreaterThan(0);
    expect(dossier.request.modeLabel).toBeTruthy();
    expect(dossier.request.sourcesFound).toBe((source.report.sources as { items: unknown[] }).items.length);
  });
});
