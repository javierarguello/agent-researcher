/**
 * Build the public sample dossier the landing links to.
 *
 * One committed artifact, `public/sample-dossier.json`, assembled from two sources
 * that must not drift:
 *   - the REAL report in `samples/florida-hvac-statewide/` (a paid comprehensive
 *     run — `out/local-4ed81938`, 2026-08-22, $3.3065, 215 sources) and the exact
 *     params that produced it;
 *   - the section TITLES from the live template manifest, so the sample is titled
 *     the way a buyer's own report is.
 *
 * It is generated and COMMITTED rather than built on deploy: the page it feeds is
 * static, anonymous and must not depend on the API being up — `/templates` is
 * authenticated, so a public page cannot ask for those titles at runtime.
 * `test/sample-dossier.test.ts` fails if this file is stale.
 *
 * A FILE at the root of `public/`, not `public/sample/dossier.json`: the SPA route
 * that reads it is `/sample`, and a directory of the same name is a path Firebase
 * Hosting may answer itself instead of falling through to the SPA rewrite.
 *
 * Run: npm run sample:build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getTemplate, toManifest } from '../../../packages/core/src/templates/registry.js';

const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const SAMPLE_DIR = `${HERE}/../../../samples/florida-hvac-statewide`;
const OUT = `${HERE}/../public/sample-dossier.json`;

/** The report's own language decides the titles: this dossier was researched in English. */
export function buildSampleDossier() {
  const doc = JSON.parse(readFileSync(`${SAMPLE_DIR}/report.json`, 'utf8')) as {
    meta: Record<string, unknown>;
    report: Record<string, unknown>;
  };
  const params = JSON.parse(readFileSync(`${SAMPLE_DIR}/params.json`, 'utf8')) as Record<string, unknown>;
  const lang = String(doc.meta.language ?? 'en');
  const template = getTemplate(String(doc.meta.template));
  if (!template) throw new Error(`Unknown template in the sample: ${String(doc.meta.template)}`);
  const manifest = toManifest(template, lang);
  const mode = manifest.modes?.find((m) => m.key === doc.meta.mode);
  const languageLabels = manifest.paramsUi?.fields?.language?.optionLabels as Record<string, string> | undefined;
  const sources = doc.report.sources as { items?: unknown[] } | undefined;
  // Our unit economics, out. `meta.cost` (usd, llmUsd, searchUsd, token counts,
  // search calls) rides inside the stored artifact, and the API deletes it at the
  // boundary for anyone who is not an admin — `redactReportForBuyer`,
  // `apps/api/src/index.ts`, "minus what is ours". This file never passes that
  // boundary: it is read off disk and served as a static asset, so the same policy
  // has to be applied HERE or a public page publishes what a paying buyer is not
  // shown. With the mode's credit price beside it, that is the gross margin of every
  // report we sell, in one fetch.
  const { cost: _cost, ...meta } = doc.meta as Record<string, unknown>;
  return {
    title: doc.meta.title,
    // Only the sections the report actually carries, in the template's order: a
    // mode excludes sections, and a title with no body renders as an empty heading.
    sections: manifest.sections.filter((s) => doc.report[s.key] !== undefined),
    // The manifest halves the viewer needs to draw a report the way the app does:
    // the cover snapshot and its labels, and the currency the figures are in.
    cover: manifest.cover,
    coverLabels: manifest.coverLabels,
    currency: manifest.currency,
    // The right-rail Mandate card. Composed HERE, from the manifest, because the
    // page that renders it cannot call the API to ask.
    request: {
      modeLabel: mode?.label ?? String(doc.meta.mode ?? ''),
      languageLabel: languageLabels?.[lang] ?? lang,
      sourcesFound: sources?.items?.length ?? null,
      // What this dossier COSTS, not what it charged: it was produced by the local
      // CLI, which spends no credits. The number a visitor needs is the price of the
      // same report, and that is the mode's.
      creditsSpent: mode?.credits ?? null,
    },
    params,
    meta,
    report: doc.report,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const dossier = buildSampleDossier();
  writeFileSync(OUT, `${JSON.stringify(dossier)}\n`, 'utf8');
  const kb = (JSON.stringify(dossier).length / 1024).toFixed(0);
  console.error(`Wrote ${OUT} — ${dossier.sections.length} sections, ${kb} kB.`);
}
