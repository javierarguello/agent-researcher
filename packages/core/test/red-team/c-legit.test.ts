/**
 * M step 2 · finder C-legit — surface C (model output → what the buyer sees and
 * what we store), LEGITIMATE-USER lens.
 *
 * C-attack proposes protocol allowlists on every raw `href`, stripping `<img>`
 * from the viewer, sanitising `progress.message` and constraining Sources
 * titles. This file measures the other side: what an HONEST report already loses
 * on these surfaces today, and what a legitimate report would lose under each
 * proposed defence. Everything here goes through the production renderers
 * (`buildReportHtml`) or the production engine with the honest fake web.
 *
 * Every `it.fails` below documents a defect that exists TODAY (the test is red
 * against today's code — vitest inverts it so the suite stays green and the
 * measured behaviour is pinned). Every plain `it` pins a guard that already holds,
 * with the one-line mutation that would red it in its comment.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));

import { buildReportHtml } from '../../src/pdf/report-html.js';
import { getPdfTheme } from '../../src/pdf/theme.js';
import { dedupeSources } from '../../src/tools/sources.js';
import { runResearch } from '../../src/engine/research-engine.js';
import { reportReadyTemplate } from '../../src/email/templates.js';
import { installMockProvider } from '../mocks/llm.js';
import { redTeamModel } from '../fixtures/red-team-model.js';

// ── The PDF renderer, fed one prose field and one string-list field ──────────
// `mdInline`/`mdToHtml` are not exported; the way in is a section body. `overview`
// (a string) walks `mdToHtml` → `mdInline`; `risks` (string[]) walks `mdInline`
// per bullet. Both are exactly the paths `redTeamModel.findings` uses.
function pdf(overview: string, risks: string[] = []): string {
  return buildReportHtml({
    report: { findings: { overview, listings: [], risks } },
    sections: [{ key: 'findings', title: 'Findings' }],
    meta: {},
    lang: 'en',
    title: 'Dossier',
    generatedAt: '2026-08-17T00:00:00.000Z',
    theme: getPdfTheme('fbizlab'),
  } as never);
}
/** Every `href` the renderer produced, decoded from HTML entities the way a browser would read it. */
function hrefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="([^"]*)"/g)) out.push(m[1]!.replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
  return out.filter((h) => !h.startsWith('#'));
}

describe('C-legit · PDF prose links — what an honest citation loses in `mdInline` (report-html.ts:123-125)', () => {
  it('a listing URL with a query string is escaped ONCE (it used to be double-escaped: the browser read `?utm=x&amp;ref=y`; mutation: `href="${esc(u)}"` in mdInline)', () => {
    // A real BizBuySell / LoopNet listing URL carries tracking params. The
    // directive tells the model to cite "the actual URLs from the evidence".
    const url = 'https://www.bizbuysell.com/Business-Opportunity/laundromat-miami/2201234/?utm_source=search&ref=list';
    const html = pdf(`Asking $450,000 per [the listing](${url}).`);
    const [href] = hrefs(html);
    // Observed before the fix: `https://…?utm_source=search&amp;ref=list` — after
    // the browser decoded ONE level, the query was `utm_source=search&amp;ref=list`.
    expect(href).toBe(url);
  });

  it('a Wikipedia-style URL with one level of balanced parentheses is kept whole (it used to be cut at the first `)`; mutation: `[^\\s)]+` as the URL class)', () => {
    const url = 'https://en.wikipedia.org/wiki/Hialeah,_Florida_(city)';
    const html = pdf(`Hialeah's population grew per [the city profile](${url}).`);
    const [href] = hrefs(html);
    expect(href).toBe(url);
  });

  it('a `mailto:` broker contact is a link in the PDF as it is in the web viewer (it used to print as literal brackets; mutation: drop `|mailto:` from the mdInline regex)', () => {
    const html = pdf('Contact [the listing broker](mailto:broker@example-brokerage.test) to request the CIM.');
    expect(hrefs(html)).toContain('mailto:broker@example-brokerage.test');
  });

  it('a link with a TITLE is a link, not raw Markdown with the brackets showing (round 8, R8-34)', () => {
    // `[text](url "title")` is ordinary Markdown and the web viewer renders it as an
    // anchor; the PDF regex had no title branch, so the buyer's kept artifact showed
    // `[the listing](https://… "…")` verbatim, brackets and all. That is the exact
    // defect `1ce4893` fixed for `tel:` while claiming "both halves had to move
    // together" — this half did not. The title itself is NOT rendered anywhere: it
    // is the page's own account of itself, which is what the Sources tooltip refuses
    // to show for the same reason.
    // Mutation that reds this: drop the optional title group from the mdInline regex.
    const html = pdf('Asking $450,000 per [the listing](https://ok.test/p "Official registry of the State of Florida").');
    expect(hrefs(html)).toEqual(['https://ok.test/p']);
    expect(html, 'the brackets reached the buyer').not.toContain('[the listing]');
    expect(html, 'the page’s own claim about itself').not.toContain('Official registry');
  });

  it('…and with the other two title delimiters CommonMark allows (round 9, G3-verify F2)', () => {
    // R8-34 closed the split for `"…"` only. `'…'` and `(…)` are titles too — the
    // viewer's Markdown parser renders all three as clean anchors — so those two
    // still reached the buyer's kept artifact as raw Markdown with the brackets
    // showing, which is the whole damage statement R8-34 was raised for.
    // Mutation that reds this: drop either alternative from the title group.
    for (const md of [
      "Asking $450,000 per [the listing](https://ok.test/p 'Official registry').",
      'Asking $450,000 per [the listing](https://ok.test/p (Official registry)).',
    ]) {
      const html = pdf(md);
      expect(hrefs(html), md).toEqual(['https://ok.test/p']);
      expect(html, md).not.toContain('[the listing]');
      expect(html, md).not.toContain('Official registry');
    }
  });

  it('keeps `http://`, ports, IDN hosts and non-ASCII paths as working links (what a naive `https`-only allowlist would break)', () => {
    // Mutation that reds this: change `https?` to `https` in the mdInline regex.
    const urls = [
      'http://legacy-listings.example/laundromat/33',
      'https://data.example:8443/market/miami',
      'https://münchen.example/wäscherei',
      'https://example.test/relatório-lavanderias',
    ];
    const html = pdf(urls.map((u, i) => `[source ${i}](${u})`).join(' and '));
    expect(hrefs(html)).toEqual(urls);
  });
});

describe('C-legit · PDF prose blocks — the directive invites Markdown the PDF cannot draw (prompt.ts:50-54 vs report-html.ts:131-146)', () => {
  it('a NUMBERED list — explicitly invited by MARKDOWN_DIRECTIVE ("bullet/numbered lists") — renders as <ol> (it used to flatten into one paragraph; mutation: drop the NUMBERED_LINE branch)', () => {
    const html = pdf('Three steps:\n\n1. Request the CIM.\n2. Verify the lease to 2031.\n3. Confirm SBA eligibility.');
    // Observed before the fix: `<p>1. Request the CIM. 2. Verify the lease to 2031. 3. Confirm SBA eligibility.</p>`
    expect(html).toMatch(/<ol>\s*<li>Request the CIM\./);
  });

  it.fails('a GFM table in a prose field is printed as raw pipes in the PDF (the viewer’s remark-gfm draws it)', () => {
    const html = pdf('| Business | Asking |\n|---|---|\n| Sunshine Coin Laundry | $450,000 |');
    console.log('C-legit F-pdf-table rendered:', html.match(/<p>\| Business[^<]*<\/p>/)?.[0]);
    expect(html).toMatch(/<table/);
  });

  it('a `-` bullet list, bold, and inline code render (the paths the directive names and the PDF has)', () => {
    // Mutation that reds this: drop the `<ul>` branch in mdToHtml.
    const html = pdf('- **Lease** to 2031\n- `SBA 7(a)` eligible');
    expect(html).toContain('<ul><li><strong>Lease</strong> to 2031</li><li><code>SBA 7(a)</code> eligible</li></ul>');
  });
});

describe('C-legit · odd-but-honest values in the PDF', () => {
  it('`askingPrice: null` on a listing prints no "null" and no zero (report-html.ts:299 isNum guard)', () => {
    // Mutation that reds this: replace `isNum(v)` with `v != null` in dealCardHtml's tile loop.
    const html = buildReportHtml({
      report: { shortlist: [{ business: 'Sunshine Coin Laundry', askingPrice: null, revenue: 310_000 }] },
      sections: [{ key: 'shortlist', title: 'Shortlist' }],
      meta: {}, lang: 'en', title: 'Dossier', generatedAt: '2026-08-17T00:00:00.000Z', theme: getPdfTheme('fbizlab'),
      cover: { from: ['shortlist'], nameKey: 'business', tiles: [{ labelKey: 'asking', field: 'askingPrice' }, { labelKey: 'revenue', field: 'revenue' }] },
    } as never);
    expect(html).not.toMatch(/\bnull\b/);
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('$310k'); // the revenue tile still renders next to the missing price
  });

  it('a 180-character business name is printed whole (no clip, no `[object Object]`)', () => {
    // Mutation that reds this: wrap `d[cover?.nameKey ?? 'name']` in `clip()`.
    const name = 'Established Full-Service Coin Laundry & Wash-Dry-Fold with Real Estate — 40 Speed Queen Washers, 32 Dryers, Absentee-Run, SBA Pre-Qualified, Hialeah, Miami-Dade County, Florida (Est. 2007)';
    expect(name.length).toBeGreaterThan(170);
    const html = buildReportHtml({
      report: { shortlist: [{ business: name, askingPrice: 450_000 }] },
      sections: [{ key: 'shortlist', title: 'Shortlist' }],
      meta: {}, lang: 'en', title: 'Dossier', generatedAt: '2026-08-17T00:00:00.000Z', theme: getPdfTheme('fbizlab'),
      cover: { from: ['shortlist'], nameKey: 'business' },
    } as never);
    expect(html).toContain(name.replace(/&/g, '&amp;'));
    expect(html).not.toContain('[object Object]');
  });
});

describe('C-legit · Sources — what the buyer reads for a real search result', () => {
  it('the label is the provider TITLE, whole, however long; the URL only when the title is empty (florida template `derive`, `s.title || s.url`)', () => {
    // A real Brave/Tavily title for a listing runs 80–120 chars. Nothing truncates
    // it today; C-attack's "cap titles at N chars" would cut real ones.
    // Mutation that reds this: `.slice(0, 60)` on the title in dedupeSources or derive.
    const title = 'Sunshine Coin Laundry — Established Laundromat for Sale in Hialeah, Miami-Dade County, FL | BizBuySell Business Opportunity #2201234';
    expect(title.length).toBeGreaterThan(120);
    const items = dedupeSources([
      { title, url: 'https://www.bizbuysell.com/Business-Opportunity/2201234/', snippet: '' },
      { title: '', url: 'https://example-marketplace.test/listing/untitled', snippet: '' },
    ]).map((s) => ({ url: s.url, label: s.title || s.url }));
    expect(items[0]!.label).toBe(title);
    expect(items[1]!.label).toBe('https://example-marketplace.test/listing/untitled');
  });
});

describe('C-legit · the progress line a Spanish buyer watches (research-engine.ts:344, gather.ts:306/367, run-job.ts:314)', () => {
  it.fails('a `language: es` job writes ENGLISH progress messages carrying internal section keys — the repo’s own rule for the held line (report-copy.ts:123-127) says this line must be the buyer’s language', async () => {
    installMockProvider();
    const seen: string[] = [];
    await runResearch({
      template: redTeamModel,
      params: redTeamModel.paramsSchema.parse({ subject: 'lavanderías en venta', location: 'Miami-Dade County, FL', language: 'es' }) as Record<string, unknown>,
      jobId: 'c-legit-progress-es',
      generatedAt: '2026-08-17T00:00:00.000Z',
      onProgress: (p) => { seen.push(p.message); },
    });
    const english = seen.filter((m) => /^(Searched|Fetched|Writing|Composing|Researching|Reused|Plan updated|Suggested sources)\b/.test(m));
    const withKeys = seen.filter((m) => /\b(findings|recommendation)\b/.test(m));
    console.log(`C-legit F-progress-lang: ${english.length}/${seen.length} progress lines English on a language=es job; ${withKeys.length} carry a section KEY. Sample:`, seen.slice(0, 6));
    expect(seen.length).toBeGreaterThan(0);
    // The buyer-visible line must not be an English template with our internal
    // section keys interpolated. Today every line is.
    expect(english.length + withKeys.length).toBe(0);
  });

  it('the `Searched: <query>` line is the FEATURE C-attack proposes to hide — the honest run puts the buyer’s own words on screen', async () => {
    // Mutation that reds this: drop the `note(\`Searched: ${query}\`)` in gather.ts:306.
    installMockProvider();
    const seen: string[] = [];
    await runResearch({
      template: redTeamModel,
      params: redTeamModel.paramsSchema.parse({ subject: 'laundromats for sale', location: 'Miami-Dade County, FL' }) as Record<string, unknown>,
      jobId: 'c-legit-progress-en',
      generatedAt: '2026-08-17T00:00:00.000Z',
      onProgress: (p) => { seen.push(p.message); },
    });
    const searched = seen.filter((m) => m.startsWith('Searched: '));
    expect(searched.length).toBeGreaterThan(0);
    // The line shows WHAT was searched, verbatim, not just that a search happened
    // (the scripted mock always searches "test query"; a real run shows the
    // model's query, e.g. "laundromats for sale Miami-Dade County").
    expect(searched[0]).toBe('Searched: test query');
  });
});

describe('C-legit · the ready email — a legit headline with an ampersand', () => {
  it('"Bed & Breakfast" arrives as "Bed &amp; Breakfast" in the HTML body — escaped, not deleted (before the fix: "Bed  Breakfast"; mutation: `.replace(/[<>&]/g, \'\')` again)', () => {
    const mail = reportReadyTemplate('FBizLab', 'Bed & Breakfast inns for sale — Key West, FL', 'https://app.example/r/1', 'en');
    // The subject keeps the `&`; the HTML body loses it. Same title, two spellings.
    expect(mail.subject).toContain('Bed & Breakfast');
    expect(mail.html).toContain('Bed &amp; Breakfast');
  });
});
