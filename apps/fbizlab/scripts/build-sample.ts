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
import { collectDeals, makeNumFmt } from '../../../packages/core/src/pdf/report-html.js';
import type { CoverSpec } from '../../../packages/core/src/templates/types.js';

const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const SAMPLE_DIR = `${HERE}/../../../samples/florida-hvac-statewide`;
const OUT = `${HERE}/../public/sample-dossier.json`;

/**
 * How much of a section a public page may show.
 *
 * The cut happens HERE, in the artifact, and that is the whole point: this file is a
 * static asset on the open internet, so anything the browser could reveal by
 * scrolling, a fetch reveals by reading. A CSS fade over the full text protects
 * nothing — the bytes are the disclosure. What is not written here is not published.
 *
 * The dossier still has to sell what it is, so the shapes survive and only the depth
 * goes: every section keeps its opening, every list keeps its first entries, the
 * executive summary keeps ALL its metric badges (aggregates, and the hook), and the
 * shortlist keeps three rows so the page shows a real comparison rather than a
 * single listing.
 *
 * Nothing is rewritten, ever. Prose is cut at a paragraph or sentence boundary and
 * nothing is appended — no ellipsis, no "read more" — so every string published is a
 * strict PREFIX of the stored one, which `sample-dossier.test.ts` asserts field by
 * field. That is what makes "we only removed" checkable rather than claimed.
 */
const PREVIEW_CHARS = 700;
/** Items kept from an array, by the field's own name. Anything else keeps `DEFAULT`. */
const PREVIEW_ITEMS: Record<string, number> = {
  /** The badge row across the top of the executive summary: aggregates, and what makes the page worth reading. */
  metrics: Infinity,
  /** Three, not two: two listings is an example, three is a comparison. */
  shortlist: 3,
  /** One full profile is the proof; six is the product. */
  deep_dives: 1,
  /** Two of five — enough to show the report draws its own charts. */
  charts: 2,
  /** `sources.items`: 10 of 215. The evidence list IS the research. */
  items: 10,
};
const PREVIEW_ITEMS_DEFAULT = 2;

/** Prose cut at the last paragraph break, else the last sentence end, else the last space. */
function cutProse(text: string, max = PREVIEW_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const para = head.lastIndexOf('\n\n');
  if (para > max * 0.4) return head.slice(0, para);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  if (sentence > max * 0.4) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(' ');
  return space > 0 ? head.slice(0, space) : head;
}

/** A preview of one value, and whether anything was dropped on the way. */
function previewValue(value: unknown, key = ''): { value: unknown; cut: boolean } {
  if (typeof value === 'string') {
    const out = cutProse(value);
    return { value: out, cut: out.length < value.length };
  }
  if (Array.isArray(value)) {
    const keep = PREVIEW_ITEMS[key] ?? PREVIEW_ITEMS_DEFAULT;
    const kept = value.slice(0, keep);
    let cut = kept.length < value.length;
    const out = kept.map((item) => {
      const r = previewValue(item, key);
      cut = cut || r.cut;
      return r.value;
    });
    return { value: out, cut };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let cut = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = previewValue(v, k);
      cut = cut || r.cut;
      out[k] = r.value;
    }
    return { value: out, cut };
  }
  return { value, cut: false };
}

/** What a section shows, and what it is a preview OF — the count the page tells the reader. */
function previewSection(value: unknown, key: string): { value: unknown; cut: boolean; shown?: number; of?: number } {
  const r = previewValue(value, key);
  if (Array.isArray(value)) return { ...r, shown: (r.value as unknown[]).length, of: value.length };
  // The one nested list a reader counts: `sources` is `{ items: [...] }`.
  const items = (value as { items?: unknown[] } | null)?.items;
  if (Array.isArray(items)) return { ...r, shown: ((r.value as { items: unknown[] }).items).length, of: items.length };
  return r;
}

/**
 * The cover figures, computed over the WHOLE report before the cut.
 *
 * The snapshot is the one part of the page that must describe the RUN and not the
 * preview. Left to the viewer, which aggregates whatever deals it was handed, the cut
 * turned "7 targets · $10.1M combined revenue" into "3 targets · $2.85M" — the
 * product looking smaller than it is, printed beside "sources consulted: 215". Four
 * aggregates give a reader the size of the work and hand over nothing: no name, no
 * price against a name, no url.
 *
 * `collectDeals` and `makeNumFmt` are core's, so this and the two renderers agree by
 * construction; only the LABELS stay with the viewer, which already resolves them
 * from the manifest and its own dictionary.
 */
function coverSnapshot(report: Record<string, unknown>, cover: CoverSpec | undefined, lang: string, currency?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cover) return out;
  const f = makeNumFmt(lang, currency);
  const deals = collectDeals(report, cover);
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const fig of cover.figures ?? []) {
    if (fig.agg === 'count') {
      if (deals.length) out[fig.labelKey] = String(deals.length);
      continue;
    }
    const nums = deals.map((d) => (d as Record<string, unknown>)[fig.field ?? '']).filter(isNum);
    if (!nums.length) continue;
    if (fig.agg === 'range') {
      const fmt = (n: number) => f.keyed(fig.field, n);
      out[fig.labelKey] = nums.length > 1 ? `${fmt(Math.min(...nums))}–${fmt(Math.max(...nums))}` : fmt(nums[0]!);
    } else {
      const total = nums.reduce((x, y) => x + y, 0);
      if (total > 0) out[fig.labelKey] = f.keyed(fig.field, total);
    }
  }
  return out;
}

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
  // The preview, and the record of what it is a preview of. Built before anything
  // else reads `doc.report` so nothing downstream can publish the full text by
  // accident — `sources.items` below counts the PUBLISHED list, and `request
  // .sourcesFound` deliberately keeps the real figure, because 215 sources consulted
  // is a true statement about the run and not a disclosure of them.
  const preview: Record<string, { shown?: number; of?: number }> = {};
  const report: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc.report)) {
    const r = previewSection(value, key);
    report[key] = r.value;
    if (r.cut) preview[key] = { ...(r.shown != null ? { shown: r.shown } : {}), ...(r.of != null ? { of: r.of } : {}) };
  }

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
    sections: manifest.sections.filter((s) => report[s.key] !== undefined),
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
    /**
     * Which sections are cut and of how many items — the page says so beside the fade
     * — plus the cover figures of the WHOLE run, which the viewer would otherwise
     * compute from the three listings that survived the cut.
     */
    preview: { cut: preview, snapshot: coverSnapshot(doc.report, manifest.cover, lang, manifest.currency) },
    report,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const dossier = buildSampleDossier();
  writeFileSync(OUT, `${JSON.stringify(dossier)}\n`, 'utf8');
  const kb = (JSON.stringify(dossier).length / 1024).toFixed(0);
  console.error(`Wrote ${OUT} — ${dossier.sections.length} sections, ${kb} kB.`);
}
