/**
 * Refutation of M-B1 (the dossier renders the FIRST 48 snippets / 14 pages of a
 * store shared by every agent).
 *
 * The finders measured the PAGE half (14) with a model that fetches every other
 * turn; the two real July traces (out/*) fetch far less (8 and 11 pages land in
 * the store — under 14 — so no honest page was ever hidden) but SEARCH far more
 * (199 / 174 sources against 48 rendered). This file pins the half that is
 * actually binding in production, at the density the real backend returns
 * (~5-8 fresh results per query), and checks the July traces themselves.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { vi } from 'vitest';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));

import { runResearch } from '../../src/engine/research-engine.js';
import { __setProviderForTests } from '../../src/llm/models.js';
import type { GenerateOptions, GenerateResult, LlmProvider } from '../../src/llm/provider.js';
import type { ResearchTemplate } from '../../src/templates/types.js';
import { __setExtraPages, __setResultsPerQuery, type Page } from '../fixtures/fake-web.js';
import { sampleFromSchema } from '../mocks/llm.js';
import { describeMock } from '../llm-mode.js';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** N honest listing pages, each with a private term so a query of five terms returns exactly those five. */
function lots(n: number): Page[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://example-marketplace.test/listing/refute-lot-${i + 1}`,
    title: `Lot ${i + 1} laundromat for sale — asking $${300 + i},000`,
    snippet: `Coin laundry lot ${i + 1}. Asking $${300 + i},000.`,
    content: `Lot ${i + 1} coin laundry, Miami-Dade. Asking price $${300 + i},000. REFUTE-LOT-${i + 1}.`,
    tags: [`rlotq${i + 1}z`],
  }));
}
const LOTS = lots(120);
const lotUrl = (n: number) => LOTS[n - 1]!.url;

/**
 * Two wave-1 producers that search 6 times each (Brave-like: 5 FRESH results per
 * query → 60 sources before wave 2 starts) and one wave-2 producer that searches
 * 3 times (15 fresh results) and fetches ONE of them — the July shape.
 */
const MODEL: ResearchTemplate<Record<string, unknown>> = {
  id: 'refute-b1',
  name: 'refute B1',
  description: 'Two wave-1 searchers, one wave-2 searcher+fetcher, shared store.',
  version: 1,
  basePrompt: 'You are a research analyst.',
  paramsSchema: z.object({ language: z.enum(['en', 'es']).default('en') }),
  modes: { comprehensive: { label: 'C', budgetScale: 1, depth: 'standard', credits: 1 } },
  sections: [
    { key: 'market', title: 'Market', guidance: 'ROLE-MARKET', schema: z.object({ text: z.string() }) },
    { key: 'competition', title: 'Competition', guidance: 'ROLE-COMPETITION', schema: z.object({ text: z.string() }) },
    { key: 'valuation', title: 'Valuation', guidance: 'ROLE-VALUATION', schema: z.object({ text: z.string() }) },
  ],
  // researchBudget is halved by the default mode's 0.5 scale: 12/12/8 → 6/6/4 real turns.
  agents: [
    { id: 'market', role: 'producer', objective: 'ROLE-MARKET', produces: ['market'], researchBudget: 12, model: 'flash', gatherModel: 'gather' },
    { id: 'competition', role: 'producer', objective: 'ROLE-COMPETITION', produces: ['competition'], researchBudget: 12, model: 'flash', gatherModel: 'gather' },
    { id: 'valuation', role: 'producer', objective: 'ROLE-VALUATION', produces: ['valuation'], dependsOn: ['market', 'competition'], researchBudget: 8, model: 'flash', gatherModel: 'gather' },
  ],
  buildBrief: () => 'Find laundromats for sale in Miami.',
};

class Searcher implements LlmProvider {
  readonly name = 'refute-b1';
  private nextLot = 1;
  /** role → the 5 URLs each of its searches returned (in order). */
  readonly searchedBy = new Map<string, string[]>();
  readonly fetchedBy = new Map<string, string[]>();
  /** role → what its WRITER prompt rendered. */
  readonly writes = new Map<string, { pages: string[]; snippets: string[] }>();

  private roleOf(opts: GenerateOptions): string {
    const text = opts.messages.map((m) => m.text ?? '').join('\n');
    return /ROLE-(MARKET|COMPETITION|VALUATION)/.exec(text)?.[1] ?? '?';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const usage = { inputTokens: 100, outputTokens: 50 };
    const role = this.roleOf(opts);
    if (opts.responseSchema) {
      const text = opts.messages.map((m) => m.text ?? '').join('\n');
      this.writes.set(role, {
        pages: [...text.matchAll(/\[P\d+\] Full page content — (\S+)/g)].map((m) => m[1]!),
        snippets: [...text.matchAll(/\n\s+URL: (\S+)/g)].map((m) => m[1]!),
      });
      return { text: JSON.stringify(sampleFromSchema(opts.responseSchema as Record<string, unknown>)), toolCalls: [], usage };
    }
    if (!opts.tools?.length) return { text: 'ok', toolCalls: [], usage };
    const toolMsgs = opts.messages.filter((m) => m.role === 'tool');
    const last = toolMsgs[toolMsgs.length - 1]?.toolResult;
    const res = last?.response as { stop?: boolean; turnsLeft?: number } | undefined;
    if (res?.stop || res?.turnsLeft === 0) return { text: 'Ready to write.', toolCalls: [], usage };
    if (toolMsgs.length === 0) return { text: '', usage, toolCalls: [{ id: 'p', name: 'update_plan', args: { steps: [{ task: 'research', status: 'doing' }] } }] };
    const searches = (this.searchedBy.get(role) ?? []).length / 5;
    // Wave-2 (valuation): 3 searches, then fetch its FIRST result, then stop.
    if (role === 'VALUATION' && searches >= 3) {
      const fetched = this.fetchedBy.get(role) ?? [];
      if (fetched.length) return { text: 'Ready to write.', toolCalls: [], usage };
      const url = this.searchedBy.get(role)![0]!;
      this.fetchedBy.set(role, [url]);
      return { text: '', usage, toolCalls: [{ id: 'f', name: 'fetch_page', args: { url } }] };
    }
    const five = Array.from({ length: 5 }, () => this.nextLot++);
    this.searchedBy.set(role, [...(this.searchedBy.get(role) ?? []), ...five.map(lotUrl)]);
    return { text: '', usage, toolCalls: [{ id: `s${toolMsgs.length}`, name: 'web_search', args: { query: five.map((n) => `rlotq${n}z`).join(' ') } }] };
  }
}

describeMock('B1 refute · the SNIPPET half at production density (5 fresh results per query)', () => {
  it('a wave-2 producer that searched 3× and fetched 1 page: its page AND all 15 of its own results render, first (before the fix: NONE of the 15 — the store head, wave 1, filled all 48)', async () => {
    restore = __setExtraPages(LOTS);
    const model = new Searcher();
    __setProviderForTests('gemini-vertex', model);
    __setProviderForTests('ollama', model);
    const out = await runResearch({
      template: MODEL,
      params: MODEL.paramsSchema.parse({ mode: 'comprehensive' }) as Record<string, unknown>,
      jobId: 'refute-b1',
      generatedAt: '2026-08-17T00:00:00.000Z',
      costCeilingUsd: null,
    });
    expect(out.trace.status).toBe('completed');
    // The store: 60 (wave 1) + 15 (wave 2) sources, 1 page.
    expect(out.sources.length).toBe(75);
    expect(out.checkpoint.extracted?.length ?? 0).toBe(1);

    const val = model.writes.get('VALUATION')!;
    const own = model.searchedBy.get('VALUATION')!;
    expect(own.length).toBe(15);
    expect(val.snippets.length).toBe(48);
    const ownVisible = own.filter((u) => val.snippets.includes(u)).length;
    // eslint-disable-next-line no-console
    console.log(`valuation: ${own.length} own search results, ${ownVisible} rendered as [S] in its own writer; page fetched: ${model.fetchedBy.get('VALUATION')?.length}, rendered as [P]: ${val.pages.length}`);
    // Its ONE fetched page reaches its writer (store < 14) …
    expect(val.pages).toEqual(model.fetchedBy.get('VALUATION'));
    // … and so do all 15 results its 3 paid searches returned, as [S1]..[S15];
    // the remaining 33 slots go to wave 1's results. Mutation that reds this:
    // render `evidence.slice(0, MAX_SNIPPETS)` in store order (drop `rankEvidence`).
    expect(ownVisible).toBe(15);
    expect(val.snippets.slice(0, 15).every((u) => own.includes(u))).toBe(true);
    expect(val.snippets.slice(15).every((u) => (model.searchedBy.get('MARKET') ?? []).includes(u) || (model.searchedBy.get('COMPETITION') ?? []).includes(u))).toBe(true);
  });
});

/**
 * The two July runs the repo keeps under out/local-… : 199 and 174 sources; every
 * writer's citations against the first 48. If the writers could see past 48 the
 * citations would spread; they do not.
 */
const OUT_DIR = new URL('../../../../out/', import.meta.url).pathname;
const runs = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((d) => existsSync(`${OUT_DIR}${d}/trace.json`) && existsSync(`${OUT_DIR}${d}/sources.json`)) : [];

describe.skipIf(!runs.length)('B1 refute · the real July traces: no writer cites past the 48th source', () => {
  it.each(runs)('%s: citations land in the first 48 (or on a fetched [P] page); the rest of the store is cited by nobody', (run) => {
    const trace = JSON.parse(readFileSync(`${OUT_DIR}${run}/trace.json`, 'utf8')) as { agents: Array<{ id: string; output?: unknown; notes: string[] }> };
    const sources = JSON.parse(readFileSync(`${OUT_DIR}${run}/sources.json`, 'utf8')) as Array<{ url: string }>;
    const idx = new Map(sources.map((s, i) => [s.url, i] as const));
    const cited = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => ((k === 'sourceUrl' || k === 'url') && typeof v === 'string' ? cited.add(v) : walk(v)));
      else if (typeof o === 'string') for (const m of o.matchAll(/\((https?:\/\/[^)\s]+)\)/g)) cited.add(m[1]!);
    };
    for (const a of trace.agents) walk(a.output);
    const inHead = [...cited].filter((u) => (idx.get(u) ?? -1) < 48 && idx.has(u)).length;
    const beyond = [...cited].filter((u) => (idx.get(u) ?? -1) >= 48);
    const notInSources = [...cited].filter((u) => !idx.has(u)).length; // fetched pages that were never a search result
    const fetches = trace.agents.reduce((n, a) => n + a.notes.filter((x) => /Fetched [1-9]/.test(x)).length, 0);
    // eslint-disable-next-line no-console
    console.log(`${run}: ${sources.length} sources; ${cited.size} distinct URLs cited by all writers: ${inHead} in first-48, ${beyond.length} beyond (${beyond.join(', ') || '—'}), ${notInSources} not a search result (fetched pages; ${fetches} fetches landed, store < 14)`);
    expect(sources.length).toBeGreaterThan(48 * 3);
    expect(fetches).toBeLessThan(14); // the PAGE half never bound in July
    // The few beyond-48 URLs cited are pages some agent FETCHED (they render as
    // [P] whatever their snippet index): never more than the fetches that landed,
    // never a spread over the 126-151 sources past the cut.
    expect(beyond.length).toBeLessThanOrEqual(fetches);
    expect(beyond.length).toBeLessThan(sources.length * 0.03);
    expect(inHead).toBeGreaterThan(cited.size * 0.6);
  });
});

// --- The REFERENCED tier at production density (R7-2) --------------------------
//
// `1fa5d31` added a third tier for exactly one case: the wave-2 enricher, which is
// handed sections full of `sourceUrl`s and told to fill their gaps, and whose own
// `current` carries those URLs bare — no title, no snippet, no page. The tier put
// them in the dossier.
//
// It could not reach production. `touched` is EVERY url a search returned to this
// loop, and both backends return 8 per query (Brave `count=8`, Tavily
// `max_results: 8`); the fixture returned 5. So any agent with ≥6 searches fills all
// 48 snippet slots from its own results alone, and tier 3 renders nothing: the
// enricher sees 0 of the 12 listings it is rewriting, while an unread SERP row
// outranks a URL the writer was told to fill in (round 7, G1-break F1).
const REF_MODEL: ResearchTemplate<Record<string, unknown>> = {
  id: 'refute-b1-ref',
  name: 'refute B1 referenced',
  description: 'A wave-1 scout that builds a shortlist and a wave-2 refiner that enriches it.',
  version: 1,
  basePrompt: 'You are a research analyst.',
  paramsSchema: z.object({ language: z.enum(['en', 'es']).default('en') }),
  modes: { comprehensive: { label: 'C', budgetScale: 1, depth: 'standard', credits: 1 } },
  sections: [
    {
      key: 'market',
      title: 'Market',
      guidance: 'ROLE-MARKET',
      schema: z.object({ text: z.string() }),
    },
    {
      key: 'shortlist',
      title: 'Shortlist',
      guidance: 'ROLE-SHORTLIST',
      schema: z.object({ listings: z.array(z.object({ name: z.string(), sourceUrl: z.string() })) }),
    },
  ],
  // Three waves, because two cannot express the thing this measures. With ONE
  // agent ahead of the refiner, everything that agent saw IS the store's first 48 —
  // so the shortlist is inside the head whatever it contains, and "render the store
  // in order" surfaces all twelve for free (round 9, R9-6). A peer that searched
  // first is also the shape R7-2 is about: "one steered scout floods the store and
  // an honest peer's own results are in the checkpoint but not in its prompt".
  agents: [
    { id: 'peer', role: 'producer', objective: 'ROLE-PEER', produces: ['market'], researchBudget: 12, model: 'flash', gatherModel: 'gather' },
    { id: 'scout', role: 'producer', objective: 'ROLE-SCOUT', produces: ['shortlist'], dependsOn: ['peer'], researchBudget: 12, model: 'flash', gatherModel: 'gather' },
    { id: 'refiner', role: 'producer', objective: 'ROLE-REFINER', enriches: ['shortlist'], dependsOn: ['scout'], researchBudget: 12, model: 'flash', gatherModel: 'gather' },
  ],
  buildBrief: () => 'Find laundromats for sale in Miami.',
};

/**
 * The 12 listings the scout shortlists — what the refiner is handed to rewrite.
 *
 * Lots 37-48: the last twelve the SCOUT itself searched up, so it shortlists what it
 * saw. Their POSITION in the shared store is the point — the peer's 48 results went
 * in first, so these sit at places 85-96 and the naive "render the store's first 48"
 * contains none of them.
 *
 * They used to be lots 1-12 with a single wave-1 agent, and after `8ff7312` moved
 * the refiner's searches to overlap them, insertion order alone already held every
 * answer this test asserts — the whole thing passed with `rankEvidence` deleted from
 * the snippet dossier (round 9, R9-6). A fixture whose premise is "the ranking is
 * what surfaces these" has to be one where store order does not.
 */
const SHORTLISTED = Array.from({ length: 12 }, (_, i) => lotUrl(37 + i));

class Density implements LlmProvider {
  readonly name = 'refute-b1-ref';
  // The refiner's first search returns eight of the twelve listings it was handed
  // (lots 41-48), then fresh ones. Eight and not twelve on purpose: if its own
  // results could supply the whole shortlist, emitting the tier last would surface
  // all twelve anyway and the ORDER would stop being measurable. The overlap is the production shape: an agent
  // told "fill the gaps in these listings" searches for those listings, and the
  // backend returns them (round 8, R8-19). It was `20` — "the refiner's own results
  // never overlap the shortlist" — which excluded that shape by construction.
  private nextLot = 41;
  readonly searchedBy = new Map<string, string[]>();
  readonly writes = new Map<string, { pages: string[]; snippets: string[] }>();

  private roleOf(opts: GenerateOptions): string {
    const text = opts.messages.map((m) => m.text ?? '').join('\n');
    return /ROLE-(PEER|SCOUT|REFINER)/.exec(text)?.[1] ?? '?';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const usage = { inputTokens: 100, outputTokens: 50 };
    const role = this.roleOf(opts);
    if (opts.responseSchema) {
      const text = opts.messages.map((m) => m.text ?? '').join('\n');
      this.writes.set(role, {
        pages: [...text.matchAll(/\[P\d+\] Full page content — (\S+)/g)].map((m) => m[1]!),
        snippets: [...text.matchAll(/\n\s+URL: (\S+)/g)].map((m) => m[1]!),
      });
      // The scout writes the shortlist it found; the refiner rewrites it unchanged.
      const value = sampleFromSchema(opts.responseSchema as Record<string, unknown>) as Record<string, unknown>;
      if (role !== 'PEER') value.shortlist = { listings: SHORTLISTED.map((url, i) => ({ name: `Lot ${37 + i}`, sourceUrl: url })) };
      return { text: JSON.stringify(value), toolCalls: [], usage };
    }
    if (!opts.tools?.length) return { text: 'ok', toolCalls: [], usage };
    const toolMsgs = opts.messages.filter((m) => m.role === 'tool');
    const last = toolMsgs[toolMsgs.length - 1]?.toolResult;
    const res = last?.response as { stop?: boolean; turnsLeft?: number } | undefined;
    if (res?.stop || res?.turnsLeft === 0) return { text: 'Ready to write.', toolCalls: [], usage };
    const done = (this.searchedBy.get(role) ?? []).length / 8;
    // Six searches each — 48 results, exactly the dossier's snippet budget, so any
    // one of them could fill it alone. The PEER goes first and its 48 take the whole
    // head of the store; the scout's 48 land behind them.
    if (done >= 6) return { text: 'Ready to write.', toolCalls: [], usage };
    const eight = role === 'PEER' ? Array.from({ length: 8 }, (_, i) => 49 + i + done * 8)
      : role === 'SCOUT' ? Array.from({ length: 8 }, (_, i) => i + 1 + done * 8)
      : Array.from({ length: 8 }, () => this.nextLot++);
    this.searchedBy.set(role, [...(this.searchedBy.get(role) ?? []), ...eight.map(lotUrl)]);
    return { text: '', usage, toolCalls: [{ id: `s${toolMsgs.length}`, name: 'web_search', args: { query: eight.map((n) => `rlotq${n}z`).join(' ') } }] };
  }
}

describeMock('B1 refute · the REFERENCED tier at production density (8 results per query)', () => {
  it('a wave-3 enricher sees all 12 listings it is rewriting, none of which the store’s first 48 contains — and all 48 results of its own', async () => {
    const restoreDensity = __setResultsPerQuery(8);
    // `__setExtraPages(p)` captures the CURRENT corpus and returns a restorer to
    // it, so calling it inside the teardown captured `LOTS` and put the 120 lot
    // pages straight back — the clear never happened (round 8, R8-29). Capture the
    // restorer at set time, the way the first block in this file does.
    const restoreExtras = __setExtraPages(LOTS);
    restore = () => {
      restoreDensity();
      restoreExtras();
    };
    const model = new Density();
    __setProviderForTests('gemini-vertex', model);
    __setProviderForTests('ollama', model);
    const out = await runResearch({
      template: REF_MODEL,
      params: REF_MODEL.paramsSchema.parse({ mode: 'comprehensive' }) as Record<string, unknown>,
      jobId: 'refute-b1-ref',
      generatedAt: '2026-08-17T00:00:00.000Z',
      costCeilingUsd: null,
    });
    expect(out.trace.status).toBe('completed');

    const ref = model.writes.get('REFINER')!;
    const own = model.searchedBy.get('REFINER')!;
    // The premise: production density, and its own results alone would fill the 48.
    expect(own.length).toBe(48);
    expect(ref.snippets.length).toBe(48);
    const referencedVisible = SHORTLISTED.filter((u) => ref.snippets.includes(u)).length;
    const ownVisible = own.filter((u) => ref.snippets.includes(u)).length;
    // eslint-disable-next-line no-console
    console.log(`refiner: ${referencedVisible}/12 shortlisted listings and ${ownVisible}/48 of its own results rendered as [S]`);

    // Two mutations red this, and they are the two this fixture exists for:
    //   - drop `rankEvidence` from the snippet dossier and render the store in
    //     order → **0 of 12**, because the peer's 48 results are the whole head.
    //     That detection is the point of the three-wave shape (round 9, R9-6): with
    //     one agent ahead of the refiner, everything it saw IS the first 48 and this
    //     test passed with the ranking deleted.
    //   - emit `touched` above `referenced` → **8 of 12**, the eight the refiner
    //     happened to search up. Which is why its searches overlap only eight: if
    //     its own results could supply the whole shortlist, the ORDER would stop
    //     being measurable here.
    //
    // NOT `const reserve = 0` — measured, full suite: 2 red, both in
    // `evidence-ranking.test.ts`. This refiner never fetches, so its `fetched` tier
    // is empty and the reserve holds back slots nothing competes for. The reserve
    // bites only when `fetched` alone could fill `max - reserve`: 37 of 48 URLs both
    // fetched by this loop and in the store for the SNIPPET call, which no budget
    // reaches — but only **8** for the 14-slot PAGES call, which every producer
    // reaches (round 9, R9-8). It is pinned at the unit level and by nothing end to
    // end, and that is worth knowing rather than implying otherwise.
    expect(referencedVisible, 'the listings the enricher is told to fill gaps in').toBe(12);
    // Eight of the twelve are also its OWN results, which is the point of the
    // overlap: they are counted once, in the referenced tier, and the slots left
    // still go to what it paid for. This number is NOT the evidence for the ordering
    // — it moves 44 → 40 when the ranking is dropped and stays 44 when the tiers are
    // reordered — so read `referencedVisible` for that and this for "it did not give
    // up what it paid for" (round 9, R9-11).
    expect(ownVisible).toBe(44);
  });
});
