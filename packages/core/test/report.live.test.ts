/**
 * End-to-end report generation against a REAL local model. Skipped unless
 * `TEST_LLM=ollama` (see test/llm-mode.ts and docker-compose.local.yml).
 *
 *   npm run llm:up
 *   npm run test:local-llm
 *
 * `report.test.ts` proves the executor assembles a report when the model behaves
 * exactly as scripted. This proves the other half: that a real model — driving
 * the tool loop and answering under `responseSchema` — produces something the
 * engine can turn into a report, and that where it can't, the run degrades into
 * a schema-valid report instead of falling over. Same model, same assertions,
 * looser tolerance for a small model fumbling one section.
 *
 * Two tiers:
 *   default          the compact model — the whole pipeline in a couple of minutes
 *   TEST_E2E_FULL=1  the real florida-business-for-sale model in essential mode
 *
 * The web is faked (test/fixtures/fake-web.ts) — a small corpus of listings,
 * market data, comparables, financing terms and reviews, rich enough that a real
 * report can be built from it. Nothing here touches the network.
 */
import { it, expect, beforeAll, vi } from 'vitest';

// No test in this repo reaches the internet: search and page extraction both come
// from the fixture corpus, so the only moving part here is the model.
vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { getTemplate } from '../src/templates/registry.js';
import { compactModel, runModel } from './fixtures/compact-model.js';
import { expectUsableReport } from './fixtures/expect-report.js';
import { describeLive, requireLocalModel } from './llm-mode.js';

describeLive('report generation — full pipeline, real local model', () => {
  beforeAll(requireLocalModel);

  it('produces a usable report end to end', { timeout: 900_000 }, async () => {
    const out = await runModel(compactModel, { subject: 'laundromats for sale', location: 'Miami-Dade County, FL' }, 'e2e-live-1');
    // A small model may fumble one of the two agents; it may not fumble both, or
    // the pipeline isn't actually working with a real model.
    expectUsableReport(out, compactModel, { maxDegraded: 1 });
  });

  it('carries the request language into the report', { timeout: 900_000 }, async () => {
    const out = await runModel(compactModel, { subject: 'lavanderías en venta', location: 'Miami-Dade County, FL', language: 'es' }, 'e2e-live-es');
    expect(out.language).toBe('es');
    expect(out.meta.language).toBe('es');
  });

  // The real model: 12 sections and a dozen agents in essential mode. Slow (tens
  // of minutes on CPU) and a 3B model will degrade several sections — the point
  // is that the run still completes and yields a schema-valid report.
  it.runIf(process.env.TEST_E2E_FULL === '1')(
    'runs the florida model end to end and yields a schema-valid report',
    { timeout: 3_600_000 },
    async () => {
      const florida = getTemplate('florida-business-for-sale')!;
      const out = await runModel(
        florida,
        { industry: 'laundromats', location: 'Miami-Dade County, FL', askingPriceMax: 500_000, mode: 'essential' },
        'e2e-live-florida',
      );

      expect(out.meta.mode).toBe('essential');
      expect(out.meta.cost.outputTokens).toBeGreaterThan(0);

      // Worth seeing after a run this long: which sections the model couldn't write.
      // eslint-disable-next-line no-console
      console.log(
        `florida e2e: ${out.sources.length} sources, ${out.meta.cost.outputTokens} output tokens, ` +
          `degraded: ${(out.meta.degradedSections ?? []).join(', ') || 'none'}`,
      );

      // Essential drops some sections; every section it DOES produce must validate.
      const exclude = new Set(florida.modes!.essential!.exclude ?? []);
      const produced = florida.sections.filter((s) => !exclude.has(s.key));
      for (const section of produced) {
        expect(out.report, `section ${section.key} missing`).toHaveProperty(section.key);
        const parsed = section.schema.safeParse(out.report[section.key]);
        expect(parsed.success, `section ${section.key}: ${JSON.stringify(parsed.error?.issues?.slice(0, 3))}`).toBe(true);
      }
      expect((out.meta.degradedSections ?? []).length).toBeLessThan(produced.length);
    },
  );
});
