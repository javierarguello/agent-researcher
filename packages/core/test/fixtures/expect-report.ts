/**
 * The shared "is this a usable report?" assertions, used by both end-to-end
 * report tests — the mocked one that runs every time, and the opt-in live one.
 * Kept apart from the model itself so that fixture stays importable outside vitest.
 */
import { expect } from 'vitest';
import { sectionByKey, type ResearchTemplate } from '../../src/templates/types.js';
import type { ResearchOutput } from '../../src/engine/research-engine.js';
import { FAKE_WEB_PAGES } from './fake-web.js';

/**
 * What must hold for ANY model, however good or bad: a well-formed envelope, a
 * report where every section validates against its own schema (the engine
 * substitutes a schema-valid placeholder for an agent that failed), evidence
 * carried into the derived section, and proof the model was actually called.
 *
 * `maxDegraded` is the room a weak model gets to fumble a section — 0 for the
 * mock, which is scripted to succeed.
 */
export function expectUsableReport(
  out: ResearchOutput,
  template: ResearchTemplate<any>,
  opts: { maxDegraded?: number } = {},
): void {
  expect(out.meta.template).toBe(template.id);
  expect(out.meta.schemaVersion).toBe(`${template.id}@${template.version}`);
  expect(out.meta.title.length).toBeGreaterThan(0);

  // The model really answered — otherwise every assertion here is vacuous.
  expect(out.meta.cost.inputTokens).toBeGreaterThan(0);
  expect(out.meta.cost.outputTokens).toBeGreaterThan(0);

  for (const section of template.sections) {
    expect(out.report, `section ${section.key} missing`).toHaveProperty(section.key);
    const parsed = sectionByKey(template, section.key)!.schema.safeParse(out.report[section.key]);
    expect(parsed.success, `section ${section.key}: ${JSON.stringify(parsed.error?.issues?.slice(0, 3))}`).toBe(true);
  }

  const degraded = (out.meta.sections ?? []).map((x) => x.key) ?? [];
  expect(degraded.length, `degraded: ${degraded.join(', ')}`).toBeLessThanOrEqual(opts.maxDegraded ?? 0);

  // The producer's tool loop ran, and its evidence reached the derived section.
  expect(out.sources.length).toBeGreaterThan(0);
  expect((out.report.sources as unknown[]).length).toBe(out.sources.length);

  // The report is built on evidence that was actually retrieved. Every source
  // must come from the fixture corpus — a URL from anywhere else means the
  // engine recorded something a model made up.
  const corpus = new Set(FAKE_WEB_PAGES.map((p) => p.url));
  for (const source of out.sources) {
    expect(corpus.has(source.url), `source not in the fixture corpus: ${source.url}`).toBe(true);
  }
}
