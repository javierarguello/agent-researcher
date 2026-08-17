/**
 * B-legit — surface B (the research loop and the evidence it hands the writers),
 * LEGITIMATE-USER lens. `docs/plans/m-red-team.md § B`.
 *
 * Every fix this surface invites is a tightening — fewer iterations, a charge for a
 * free call, a cap on plan updates, a re-ordering of the dossier — and every one of
 * them costs an HONEST job something. This file measures what an ordinary, diligent
 * research run loses under today's bounds, so the fixes are argued against numbers
 * rather than against an attacker alone.
 *
 * Nothing here is poisoned. The model below is a diligent researcher, not an
 * obedient one: it plans, searches, fetches, marks its steps done, re-reads a page
 * the loop stubbed out of its context, and stops when its allowance is spent.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));

import { createEvidence, gather, gatherCompleted, type GatherResult } from '../../src/engine/gather.js';
import { runResearch } from '../../src/engine/research-engine.js';
import { resolveModel } from '../../src/llm/index.js';
import { __setProviderForTests } from '../../src/llm/models.js';
import type { GenerateOptions, GenerateResult, LlmMessage, LlmProvider, ToolCall } from '../../src/llm/provider.js';
import { getTemplate } from '../../src/templates/registry.js';
import type { ResearchTemplate } from '../../src/templates/types.js';
import { MAX_HANDOFF_CHARS } from '../../src/engine/prompt.js';
import { __setExtraPages, FAKE_WEB_PAGES, type Page } from '../fixtures/fake-web.js';
import { redTeamModel } from '../fixtures/red-team-model.js';
import { MockLlmProvider, sampleFromSchema } from '../mocks/llm.js';
import { describeLive, describeMock, requireLocalModel } from '../llm-mode.js';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

// --- The diligent researcher ---------------------------------------------------

/**
 * How a well-behaved model uses `update_plan`.
 *
 *  - `revise`      one revision per result — "(3) revise the plan as you learn".
 *  - `doing-done`  what the tool's own description asks for: "mark steps
 *                  done/doing" — a step is marked `doing` before the call and
 *                  `done` after it, one tool call per response.
 */
type PlanStyle = 'revise' | 'doing-done';

interface Persona {
  style: PlanStyle;
  /**
   * After every N-th page fetch, re-read the FIRST page it fetched (a cached,
   * free call). Honest and, past two fetches, necessary: `trimOldPages` has
   * replaced its body with a stub, and the kickoff says "cross-check key facts".
   * 0 = never.
   */
  rereadEvery: number;
}

/**
 * Enough DISTINCT honest listing pages for a 24-turn scout to fetch a fresh one
 * every time (the honest corpus has three; a fourth fetch would be a cached,
 * free re-read and would not spend a turn). Installed on top of the corpus.
 */
const HONEST_LOTS = honestListings(80);
const LISTINGS = [...FAKE_WEB_PAGES.map((p) => p.url).filter((u) => u.includes('/listing/')), ...HONEST_LOTS.map((p) => p.url)];

/**
 * A model that emits ONE tool call per response and follows the kickoff to the
 * letter. It never reads a page for instructions; its script depends only on the
 * budget it was given and on what the loop tells it (`turnsLeft`, `stop`).
 */
class DiligentResearcher extends MockLlmProvider {
  /** Every research-loop request, in order: how much text it carried. */
  readonly loopChars: number[] = [];
  /** How many `update_plan` / cached-fetch calls the script emitted. */
  planUpdates = 0;
  cachedRereads = 0;
  /**
   * The longest run of consecutive FREE calls (plan updates, cached re-reads) it
   * ever emitted between two paid ones — the number a "too many free calls in a
   * row" breaker would have to tolerate to leave this persona alone.
   */
  maxFreeRun = 0;
  private freeRun = 0;
  private queue: Array<ToolCall | 'stop'> = [];
  private started = false;

  constructor(
    private readonly budget: number,
    private readonly persona: Persona,
    private readonly urls: string[] = LISTINGS,
  ) {
    super();
  }

  private script(): void {
    const plan = (status: string) => ({ id: `p${this.queue.length}`, name: 'update_plan', args: { steps: [{ task: 'find listings and read them', status }] } });
    this.queue.push(plan('doing'));
    let fetched = 0;
    for (let t = 0; t < this.budget; t++) {
      if (this.persona.style === 'doing-done') this.queue.push(plan('doing'));
      if (t % 2 === 0) this.queue.push({ id: `s${t}`, name: 'web_search', args: { query: `laundromat for sale Miami ${t}` } });
      else {
        this.queue.push({ id: `f${t}`, name: 'fetch_page', args: { url: this.urls[fetched % this.urls.length]! } });
        fetched += 1;
        if (this.persona.rereadEvery && fetched % this.persona.rereadEvery === 0 && fetched > 1) {
          this.queue.push({ id: `r${t}`, name: 'fetch_page', args: { url: this.urls[0]! } });
        }
      }
      this.queue.push(plan('done'));
    }
    this.queue.push('stop');
  }

  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.calls += 1;
    const usage = { inputTokens: 200, outputTokens: 60 };
    if (!opts.tools?.length) return super.generate(opts);
    this.loopChars.push(opts.system.length + opts.messages.map((m) => m.text ?? JSON.stringify(m.toolResult ?? m.toolCalls ?? '')).join('').length);
    if (!this.started) {
      this.started = true;
      this.script();
    }
    // Honest: if the loop said the budget is spent, stop asking.
    const last = opts.messages[opts.messages.length - 1];
    const lastRes = last?.role === 'tool' ? (last.toolResult?.response as { stop?: boolean } | undefined) : undefined;
    if (lastRes?.stop) return { text: 'Ready to write.', toolCalls: [], usage };
    const next = this.queue.shift() ?? 'stop';
    if (next === 'stop') return { text: 'Ready to write.', toolCalls: [], usage };
    if (next.name === 'update_plan') this.planUpdates += 1;
    if (next.name === 'fetch_page' && (next.id as string).startsWith('r')) this.cachedRereads += 1;
    const free = next.name === 'update_plan' || (next.name === 'fetch_page' && (next.id as string).startsWith('r'));
    this.freeRun = free ? this.freeRun + 1 : 0;
    this.maxFreeRun = Math.max(this.maxFreeRun, this.freeRun);
    return { text: '', toolCalls: [next], usage };
  }
}

async function runLoop(budget: number, persona: Persona) {
  const model = new DiligentResearcher(budget, persona);
  __setProviderForTests('gemini-vertex', model);
  __setProviderForTests('ollama', model);
  const evidence = createEvidence();
  const res: GatherResult = await gather({
    model: resolveModel('gather'),
    system: 'You are a research analyst.',
    messages: [{ role: 'user', text: `Research laundromats for sale in Miami. You have a budget of ${budget} search/fetch calls.` }],
    maxTurns: budget,
    evidence,
  });
  return { model, res, evidence, iterations: model.loopChars.length, chars: model.loopChars.reduce((a, b) => a + b, 0) };
}

/** The Florida flagship's real per-agent allowances, both modes (`researchBudget × budgetScale`, min 2). */
const florida = getTemplate('florida-business-for-sale')!;
const FLORIDA_BUDGETS = (scale: number) =>
  florida.agents
    .filter((a) => a.role === 'producer')
    .map((a) => ({ agent: a.id, budget: Math.max(2, Math.round((a.researchBudget ?? 16) * scale)) }));

describeMock('1 · a diligent researcher against the iteration bound (2·budget + 6)', () => {
  beforeEach(() => {
    restore = __setExtraPages(HONEST_LOTS);
  });
  it('measures every Florida agent under three honest personas (printed)', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const [mode, scale] of [['comprehensive', 1], ['essential', 0.5]] as const) {
      for (const { agent, budget } of FLORIDA_BUDGETS(scale)) {
        for (const [name, persona] of [
          ['revise', { style: 'revise', rereadEvery: 0 }],
          ['revise+cross-check', { style: 'revise', rereadEvery: 2 }],
          ['doing→done', { style: 'doing-done', rereadEvery: 0 }],
          ['doing→done+cross-check', { style: 'doing-done', rereadEvery: 2 }],
        ] as const) {
          const { res, iterations, model } = await runLoop(budget, persona);
          rows.push({
            mode,
            agent,
            budget,
            persona: name,
            'plan updates': model.planUpdates,
            rereads: model.cachedRereads,
            'max free run': model.maxFreeRun,
            iterations,
            cap: budget * 2 + 6,
            'turns spent': res.turns,
            'turns lost': budget - res.turns,
            stop: res.stop,
            reusable: gatherCompleted(res),
          });
        }
      }
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    // The persona the kickoff describes fits everywhere; the one the TOOL describes does not.
    expect(rows.filter((r) => r.persona === 'revise').every((r) => r.stop === 'budget' && r.reusable === true)).toBe(true);
    // No honest persona here ever makes more than 3 free calls in a row — the
    // number a consecutive-free-call breaker (the fix that does not touch the
    // iteration cap) has to tolerate. plan-spam alternates free calls forever.
    expect(Math.max(...rows.map((r) => r['max free run'] as number))).toBe(3);
    // A cross-checking scout that spent ALL 24 turns is still classed unfinished: it
    // ran out of iterations before it could say "ready", so the retry re-buys it.
    expect(rows.find((r) => r.agent === 'deal-scout' && r.mode === 'comprehensive' && r.persona === 'revise+cross-check')).toMatchObject({ 'turns spent': 24, 'turns lost': 0, stop: 'stalled', reusable: false });
    expect(rows.filter((r) => r.persona === 'doing→done' && r.stop === 'stalled').length).toBeGreaterThan(0);
  });

  it('the headroom for free calls is 4, whatever the budget: revise once per result and cross-check 4 pages fits, 5 does not', async () => {
    // Pins today's arithmetic (1 initial plan + B tool calls + B revisions + 1 stop
    // = 2B+2, against a cap of 2B+6). Revert-verify: change `+ 6` in gather.ts to
    // `+ 5` and the first assertion goes red.
    for (const budget of [8, 24]) {
      const model = new DiligentResearcher(budget, { style: 'revise', rereadEvery: 0 });
      // Force exactly r cached re-reads by re-reading after the last fetch.
      const fits = await withRereads(budget, 4);
      const stalls = await withRereads(budget, 5);
      expect(fits.res.stop, `budget ${budget}, 4 rereads`).toBe('budget');
      expect(fits.res.turns).toBe(budget);
      expect(stalls.res.stop, `budget ${budget}, 5 rereads`).toBe('stalled');
      // …having spent the whole allowance: the same evidence, classed unfinished.
      expect(stalls.res.turns).toBe(budget);
      expect(gatherCompleted(stalls.res)).toBe(false);
      void model;
    }
  });

  it.fails(
    'a researcher that marks each step doing→done, as the tool description asks, spends its allowance and finishes — today: budget 8 → 7 turns/stalled, budget 24 → 18 turns/stalled',
    async () => {
      const eight = await runLoop(8, { style: 'doing-done', rereadEvery: 0 });
      const twentyFour = await runLoop(24, { style: 'doing-done', rereadEvery: 0 });
      // What the numbers are today, so the name above stays honest.
      expect([eight.res.turns, eight.res.stop, twentyFour.res.turns, twentyFour.res.stop]).toEqual([7, 'stalled', 18, 'stalled']);
      // What an honest run should get: its whole allowance and a finished pass.
      expect(eight.res.turns).toBe(8);
      expect(gatherCompleted(eight.res)).toBe(true);
    },
  );
});

/** A `revise` researcher with exactly `r` cached re-reads appended after its last fetch. */
async function withRereads(budget: number, r: number) {
  class Rereader extends DiligentResearcher {
    constructor() {
      super(budget, { style: 'revise', rereadEvery: 0 });
    }
    override async generate(opts: GenerateOptions): Promise<GenerateResult> {
      // Insert the re-reads right after the first fetch — mid-loop, where a
      // cross-check happens. (After the allowance is spent a cached re-read is
      // refused with "Budget reached", so a re-read is only ever a mid-loop call.)
      const q = (this as unknown as { queue: Array<ToolCall | 'stop'>; started: boolean });
      const out = await super.generate(opts);
      if (q.started && !(this as unknown as { injected?: boolean }).injected) {
        (this as unknown as { injected?: boolean }).injected = true;
        const firstFetch = q.queue.findIndex((a) => a !== 'stop' && a.name === 'fetch_page');
        const rereads: ToolCall[] = Array.from({ length: r }, (_, i) => ({ id: `r-x${i}`, name: 'fetch_page', args: { url: LISTINGS[0]! } }));
        q.queue.splice(firstFetch + 1, 0, ...rereads);
      }
      return out;
    }
  }
  const model = new Rereader();
  __setProviderForTests('gemini-vertex', model);
  __setProviderForTests('ollama', model);
  const res = await gather({
    model: resolveModel('gather'),
    system: 'You are a research analyst.',
    messages: [{ role: 'user', text: 'Research.' }],
    maxTurns: budget,
    evidence: createEvidence(),
  });
  return { model, res };
}

// --- What `stalled` costs an honest job -----------------------------------------

/** The red-team model with a Florida-shaped scout allowance (8), so the doing→done persona stalls. */
const floridaShaped: ResearchTemplate<Record<string, unknown>> = {
  ...redTeamModel,
  id: 'red-team-b-legit',
  agents: redTeamModel.agents.map((a) => (a.id === 'scout' ? { ...a, researchBudget: 8 } : a)),
};

/**
 * A diligent researcher whose FIRST structured write of `findings` fails twice (once
 * plus the repair round = one failed attempt), which is the ordinary way a write
 * fails: a big section that does not validate on the first try.
 */
class DiligentWithOneBadWrite extends DiligentResearcher {
  private badWrites = 0;
  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('"findings"') && this.badWrites < 2) {
      this.badWrites += 1;
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    if (opts.responseSchema) return { text: JSON.stringify(sampleFromSchema(opts.responseSchema as Record<string, unknown>)), toolCalls: [], usage: { inputTokens: 200, outputTokens: 80 } };
    return super.generate(opts);
  }
}

async function runFloridaShaped(persona: Persona) {
  // The scout has budget 8; the refiner (2) is scripted by the same persona and
  // does not matter for the measurement — it fits either way.
  const model = new DiligentWithOneBadWrite(8, persona);
  __setProviderForTests('gemini-vertex', model);
  __setProviderForTests('ollama', model);
  const out = await runResearch({
    template: floridaShaped,
    params: floridaShaped.paramsSchema.parse({}) as Record<string, unknown>,
    jobId: `b-legit-${persona.style}`,
    generatedAt: '2026-08-17T00:00:00.000Z',
  });
  const scout = out.trace.agents.find((a) => a.id === 'scout')!;
  const notes = scout.notes.join('\n');
  return {
    out,
    scout,
    researched: notes.match(/Researching \(/g)?.length ?? 0,
    reused: /Reusing evidence already gathered/.test(notes),
    searches: notes.match(/Searched: /g)?.length ?? 0,
    searchCalls: scout.cost.searchCalls,
    llmUsd: scout.cost.llmUsd,
  };
}

describeMock('2 · what `stalled` costs an honest job on retry (gatherCompleted requires done|budget)', () => {
  beforeEach(() => {
    restore = __setExtraPages(HONEST_LOTS);
  });
  it.fails(
    'the doing→done researcher’s evidence is reused after a failed write, like the revise researcher’s — today it is re-bought: 2 research passes, 2× the searches',
    async () => {
      const revise = await runFloridaShaped({ style: 'revise', rereadEvery: 0 });
      const doingDone = await runFloridaShaped({ style: 'doing-done', rereadEvery: 0 });
      // Both jobs complete; both scouts needed two attempts.
      expect(revise.out.trace.status).toBe('completed');
      expect(doingDone.out.trace.status).toBe('completed');
      expect(revise.scout.attempts).toBe(2);
      expect(doingDone.scout.attempts).toBe(2);
      // The revise researcher finished its pass, so the retry reuses it.
      expect(revise.researched).toBe(1);
      expect(revise.reused).toBe(true);
      // Today's numbers for the doing→done researcher, so the name stays honest.
      // eslint-disable-next-line no-console
      console.table([
        { persona: 'revise', passes: revise.researched, reused: revise.reused, searches: revise.searches, searchCalls: revise.searchCalls, 'loop+write llm $': revise.llmUsd.toFixed(4) },
        { persona: 'doing→done', passes: doingDone.researched, reused: doingDone.reused, searches: doingDone.searches, searchCalls: doingDone.searchCalls, 'loop+write llm $': doingDone.llmUsd.toFixed(4) },
      ]);
      expect(doingDone.researched).toBe(2);
      expect(doingDone.searchCalls).toBeGreaterThanOrEqual(revise.searchCalls * 2 - 1);
      // …and what an honest job should get: the same reuse the other persona gets.
      expect(doingDone.reused).toBe(true);
    },
  );
});

// --- The dossier's FIRST-48/14 against a Florida-shaped honest run -----------------

/** N honest listing pages, each reachable by its own search term, so a scout can fetch N distinct pages. */
function honestListings(n: number): Page[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://example-marketplace.test/listing/honest-lot-${i + 1}`,
    title: `Lot ${i + 1} laundromat for sale, Miami-Dade FL — asking $${300 + i * 5},000`,
    snippet: `Coin laundry lot ${i + 1}. Asking $${300 + i * 5},000, revenue $${200 + i * 3},000, SDE $${70 + i},000.`,
    content: `Lot ${i + 1} coin laundry, Miami-Dade. Asking price $${300 + i * 5},000. Revenue $${200 + i * 3},000. SDE $${70 + i},000. Lease to 20${30 + (i % 5)}.`,
    // A term of its own that is not a prefix of another lot's, so a search for it ranks this page first.
    tags: ['laundromat', 'for sale', 'listing', `lotq${i + 1}z`],
  }));
}

/**
 * A modest honest researcher for the WHOLE Florida model: every producer plans,
 * then alternates a search for a fresh listing with a fetch of it, and stops at
 * its allowance. Records, per agent, which pages it fetched and which pages its
 * OWN writing prompt then rendered.
 */
class FloridaHonest implements LlmProvider {
  readonly name = 'florida-honest';
  private lot = 0;
  /** agent objective → URLs it fetched (in the loop). */
  readonly fetchedBy = new Map<string, string[]>();
  readonly searchedBy = new Map<string, string[]>();
  /** agent (by owned section keys) → the [P…] URLs and [S…] URLs its writing prompt rendered. */
  readonly writes: Array<{ keys: string[]; pages: string[]; snippets: string[] }> = [];

  private roleOf(opts: GenerateOptions): string {
    const kick = opts.messages.find((m) => m.role === 'user')?.text ?? '';
    return /YOUR ROLE: (.*)\n/.exec(kick)?.[1] ?? '?';
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const usage = { inputTokens: 100, outputTokens: 50 };
    if (opts.responseSchema) {
      const keys = Object.keys((opts.responseSchema as { properties?: object }).properties ?? {}).filter((k) => !k.startsWith('_'));
      const text = opts.messages.map((m) => m.text ?? '').join('\n');
      const pages = [...text.matchAll(/\[P\d+\] Full page content — (\S+)/g)].map((m) => m[1]!);
      const snippets = [...text.matchAll(/\[S\d+\] .*\n\s+URL: (\S+)/g)].map((m) => m[1]!);
      this.writes.push({ keys, pages, snippets });
      return { text: JSON.stringify(sampleFromSchema(opts.responseSchema as Record<string, unknown>)), toolCalls: [], usage };
    }
    if (opts.tools?.length) {
      const role = this.roleOf(opts);
      const toolMsgs = opts.messages.filter((m) => m.role === 'tool');
      const last = toolMsgs[toolMsgs.length - 1]?.toolResult?.response as { stop?: boolean; turnsLeft?: number; results?: Array<{ url: string }> } | undefined;
      if (last?.stop || last?.turnsLeft === 0) return { text: 'Ready to write.', toolCalls: [], usage };
      if (toolMsgs.length === 0) return { text: '', usage, toolCalls: [{ id: 'p', name: 'update_plan', args: { steps: [{ task: 'research', status: 'doing' }] } }] };
      const lastMsg = toolMsgs[toolMsgs.length - 1]!.toolResult!;
      if (lastMsg.name === 'web_search' && last?.results?.[0]) {
        const url = last.results[0].url;
        this.fetchedBy.set(role, [...(this.fetchedBy.get(role) ?? []), url]);
        return { text: '', usage, toolCalls: [{ id: `f${toolMsgs.length}`, name: 'fetch_page', args: { url } }] };
      }
      this.lot += 1;
      const query = `laundromat for sale lotq${this.lot}z`;
      this.searchedBy.set(role, [...(this.searchedBy.get(role) ?? []), `https://example-marketplace.test/listing/honest-lot-${this.lot}`]);
      return { text: '', usage, toolCalls: [{ id: `s${toolMsgs.length}`, name: 'web_search', args: { query } }] };
    }
    return { text: 'ok', toolCalls: [], usage };
  }
}

describeMock('3 · the dossier renders the FIRST 48 snippets / 14 pages of a SHARED store', () => {
  it.fails(
    'every Florida producer’s own fetched pages reach its own writing prompt — today: past 14 pages in the store, a fetch is paid for and never rendered to anyone',
    { timeout: 60_000 },
    async () => {
      restore = __setExtraPages(HONEST_LOTS);
      const model = new FloridaHonest();
      __setProviderForTests('gemini-vertex', model);
      __setProviderForTests('ollama', model);
      const out = await runResearch({
        template: florida,
        params: florida.paramsSchema.parse({ industry: 'laundromats', location: 'Miami-Dade County, FL', mode: 'comprehensive' }) as Record<string, unknown>,
        jobId: 'b-legit-florida',
        generatedAt: '2026-08-17T00:00:00.000Z',
      });
      expect(out.trace.status).toBe('completed');

      const owned = (a: { produces?: string[]; enriches?: string[] }) => [...(a.produces ?? []), ...(a.enriches ?? [])];
      const rows: Record<string, unknown>[] = [];
      let allVisible = true;
      for (const agent of florida.agents.filter((a) => a.role === 'producer')) {
        const write = model.writes.find((w) => w.keys.every((k) => owned(agent).includes(k)) && owned(agent).every((k) => w.keys.includes(k)));
        const fetched = model.fetchedBy.get(agent.objective) ?? [];
        const searched = model.searchedBy.get(agent.objective) ?? [];
        const visible = fetched.filter((u) => write?.pages.includes(u)).length;
        const snippetsVisible = searched.filter((u) => write?.snippets.includes(u)).length;
        rows.push({
          agent: agent.id,
          budget: agent.researchBudget,
          'own pages fetched': fetched.length,
          'own pages in own dossier': visible,
          'own snippets': searched.length,
          'own snippets in own dossier': snippetsVisible,
          'dossier pages': write?.pages.length,
          'dossier snippets': write?.snippets.length,
        });
        if (fetched.length && visible < fetched.length) allVisible = false;
      }
      // eslint-disable-next-line no-console
      console.table(rows);
      // Store totals, for the denominator: what the job bought vs what any writer can see.
      // eslint-disable-next-line no-console
      console.log(`store: ${out.checkpoint.extracted?.length ?? 0} pages, ${out.sources.length} sources; a dossier shows at most 14 / 48`);
      expect(allVisible).toBe(true);
    },
  );
});

// --- Handoffs against MAX_HANDOFF_CHARS, with a real small model -----------------------

/**
 * ONE confirming live run (`TEST_LLM=ollama`, qwen2.5:3b) of the red-team model
 * against the HONEST web: how a real model uses the free calls, whether a real
 * handoff is cut mid-sentence by the 1,500-char cap, and whether the advisor's
 * recommendation still carries the scout's figures after the JSON encoding.
 */
describeLive('4 · a real small model on the honest web: loop habits, handoff cut, figures carried', () => {
  beforeAll(requireLocalModel);

  it('records how the model spends its free calls, and what the cap and the encoding do to the handoff', { timeout: 1_800_000 }, async () => {
    const seen: Array<{ kind: 'loop' | 'write'; agent: string; body: string; toolCalls: ToolCall[] }> = [];
    // Wrap the real ollama provider to observe, not to script.
    const real = resolveModel('gather').provider;
    const observer: LlmProvider = {
      name: 'observer',
      async generate(opts: GenerateOptions): Promise<GenerateResult> {
        const res = await real.generate(opts);
        const kick = opts.messages.find((m: LlmMessage) => m.role === 'user')?.text ?? '';
        const agent = /YOUR ROLE: (.*)\n/.exec(kick)?.[1] ?? (opts.responseSchema ? 'write' : '?');
        seen.push({ kind: opts.tools?.length ? 'loop' : 'write', agent, body: opts.messages.map((m) => m.text ?? JSON.stringify(m.toolResult ?? '')).join('\n'), toolCalls: res.toolCalls });
        return res;
      },
    };
    __setProviderForTests('ollama', observer);

    const out = await runResearch({
      template: redTeamModel,
      params: redTeamModel.paramsSchema.parse({}) as Record<string, unknown>,
      jobId: 'b-legit-live',
      generatedAt: '2026-08-17T00:00:00.000Z',
    });

    // (a) loop habits per producer: iterations, plan updates, cached re-reads, stop.
    const rows: Record<string, unknown>[] = [];
    for (const a of out.trace.agents) {
      const notes = a.notes.join('\n');
      rows.push({
        agent: a.id,
        status: a.status,
        turns: a.turnsUsed,
        'plan updates': notes.match(/Plan updated/g)?.length ?? 0,
        'cached rereads': notes.match(/Reused cached page/g)?.length ?? 0,
        searches: notes.match(/Searched:/g)?.length ?? 0,
        fetches: notes.match(/Fetched \d/g)?.length ?? 0,
        'loop calls': seen.filter((s) => s.kind === 'loop' && a.notes.length && s.agent === (redTeamModel.agents.find((x) => x.id === a.id)?.objective ?? '')).length,
      });
    }
    // eslint-disable-next-line no-console
    console.table(rows);

    // (b) the handoffs: length, cut, and whether the cut fell mid-sentence.
    const handoffs = out.checkpoint.handoffs ?? {};
    for (const [id, h] of Object.entries(handoffs)) {
      const cut = h.endsWith('…');
      const lastChar = h.replace(/…$/, '').trim().slice(-1);
      // eslint-disable-next-line no-console
      console.log(`handoff[${id}]: ${h.length} chars, cut=${cut}, ends with ${JSON.stringify(lastChar)}\n${h}\n---`);
      if (cut) expect(h.length).toBe(MAX_HANDOFF_CHARS + 1);
    }

    // (c) figures: which of the corpus's asking prices the scout's sections carry, and
    // which of those the advisor repeats — through the JSON-encoded handoff block.
    // Both spellings: prose writes "$280,000", the numeric `askingPrice` field writes 280000.
    const corpusFigures = ['450,000', '280,000', '1,150,000', '310,000', '190,000', '402,000', '120,000', '78,000', '165,000'];
    const has = (text: string, f: string) => text.includes(f) || text.includes(f.replace(/,/g, ''));
    const findings = JSON.stringify(out.report.findings ?? {});
    const scoutHandoff = handoffs.scout ?? '';
    const advisorPrompt = seen.filter((s) => s.kind === 'write').map((s) => s.body).find((b) => b.startsWith('Compose your assigned')) ?? '';
    const rec = JSON.stringify(out.report.recommendation ?? {});
    const inFindings = corpusFigures.filter((f) => has(findings, f));
    const inHandoff = corpusFigures.filter((f) => has(scoutHandoff, f));
    const inAdvisorPrompt = corpusFigures.filter((f) => has(advisorPrompt, f));
    const inRec = corpusFigures.filter((f) => has(rec, f));
    // eslint-disable-next-line no-console
    console.log(`figures — in findings: [${inFindings}] · in scout handoff: [${inHandoff}] · in advisor prompt: [${inAdvisorPrompt}] · in recommendation: [${inRec}]`);
    // eslint-disable-next-line no-console
    console.log(`recommendation: ${rec}`);
    // The run itself must have been real: some producer bought something.
    expect(out.trace.agents.some((a) => (a.turnsUsed ?? 0) > 0)).toBe(true);
  });
});
