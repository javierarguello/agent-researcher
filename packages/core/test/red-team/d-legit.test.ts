/**
 * D-legit — the CONTROL numbers for surface D (cost and waste inside the ceiling),
 * from the legitimate user's side. `docs/plans/m-red-team.md § 2 D`, `§ 3`.
 *
 * Every cap D-attack proposes (on plan updates, on cached fetches, on writer
 * output, on retries after a stalled loop, on query length, on sources / the
 * checkpoint, a lower per-mode ceiling) costs an HONEST job something, and this
 * repo's history says a cap picked "as a number instead of a property" passes for
 * the wrong formula (`deep-review.md`). So this file measures, deterministically
 * and against the honest fake web, what an honest run looks like on every axis a
 * cap would touch — and asserts each measurement as the PROPERTY a cap has to
 * respect, with the measured value in the test name so a drift is a red test and
 * not a stale table.
 *
 * Nothing here is an attack. The poisoned corpus is used ONCE, as the A side of a
 * ceiling-headroom A/B: how far the worst spend payload the harness knows moves an
 * honest comprehensive job towards the ceiling that would HOLD it.
 *
 * Mock tier only. The stock `MockLlmProvider` reports FIXED usage (200 in / 80 out
 * per call), so the engine's own `$` is a per-call count, blind to prompt size —
 * that is why every table also carries `chars` and a chars-derived estimate at the
 * catalog rates (`config.llm.models`, chars/4 ≈ tokens). The estimate is labelled
 * as one everywhere it appears.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));

import { config } from '../../src/config.js';
import { maxCostForMode, resolveMode } from '../../src/mode.js';
import { runResearch, type Checkpoint, type ResearchOutput } from '../../src/engine/research-engine.js';
import { getTemplate } from '../../src/templates/registry.js';
import type { ResearchTemplate } from '../../src/templates/types.js';
import { __setProviderForTests } from '../../src/llm/models.js';
import type { GenerateOptions, GenerateResult, ToolCall } from '../../src/llm/provider.js';
import { installMockProvider, MockLlmProvider } from '../mocks/llm.js';
import { installObedientProvider, ObedientMockProvider, type SeenPrompt } from '../mocks/obedient-llm.js';
import { redTeamModel } from '../fixtures/red-team-model.js';
import { payload, poisonWeb } from '../fixtures/poisoned-web.js';

const florida = getTemplate('florida-business-for-sale')!;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.resolve(HERE, '../../src', rel), 'utf8');

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

// --- instruments -------------------------------------------------------------

/** Roughly what a "≥250 words" prose field weighs (same constant as context-size.measure). */
const PROSE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(20);

/**
 * `sampleFromSchema` with realistic prose, RESPECTING `maxLength`. The stock
 * sampler ignores it, and Florida's `chartSchema.description` is `.max(500)` — so
 * `context-size.measure.test.ts`, which samples with the same 1,600-char PROSE,
 * fails every chart-analyst write, retries it, and silently ships `charts` as
 * lost while its "write chars" total counts the failed repair calls. An honest
 * measurement has to write a valid chart.
 */
function sampleRealistic(root: Record<string, unknown>, node: Record<string, unknown> = root): unknown {
  const defs = (root.$defs ?? root.definitions ?? {}) as Record<string, Record<string, unknown>>;
  if (typeof node.$ref === 'string') return sampleRealistic(root, defs[node.$ref.replace(/^#\/(?:\$defs|definitions)\//, '')] ?? {});
  const union = (node.anyOf ?? node.oneOf) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(union)) return sampleRealistic(root, union.find((b) => b.type !== 'null') ?? union[0] ?? {});
  if (Array.isArray(node.enum)) return (node.enum as unknown[])[0];
  const type = Array.isArray(node.type) ? (node.type as string[]).find((t) => t !== 'null') : node.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k2, v] of Object.entries((node.properties ?? {}) as Record<string, Record<string, unknown>>)) out[k2] = sampleRealistic(root, v);
      return out;
    }
    case 'array': {
      const min = typeof node.minItems === 'number' ? node.minItems : 1;
      return Array.from({ length: Math.max(min, 1) }, () => sampleRealistic(root, (node.items ?? {}) as Record<string, unknown>));
    }
    case 'number':
    case 'integer':
      return 100;
    case 'boolean':
      return true;
    default:
      return typeof node.maxLength === 'number' ? PROSE.slice(0, node.maxLength) : PROSE;
  }
}

interface Seen {
  call: number;
  kind: 'loop' | 'structured' | 'text';
  agent: string;
  chars: number;
  outChars: number;
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
const usd = (n: number) => `$${n.toFixed(4)}`;

/** Which agent a prompt belongs to: the kickoff / synth prompt carries `YOUR ROLE: <objective>`. */
function agentOf(template: ResearchTemplate<any>, opts: GenerateOptions): string {
  const text = `${opts.system}\n${opts.messages.map((m) => m.text ?? '').join('\n')}`;
  const hit = template.agents.find((a) => text.includes(`YOUR ROLE: ${a.objective}`) || text.includes(`${a.objective}\n\n`));
  return hit?.id ?? '?';
}

function flatChars(opts: GenerateOptions): number {
  return (
    opts.system.length +
    opts.messages.reduce(
      (n, m) => n + (m.text?.length ?? 0) + (m.toolResult ? JSON.stringify(m.toolResult).length : 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0),
      0,
    )
  );
}

/**
 * Chars → dollars at the catalog rates, the ESTIMATE the fixed-usage mock cannot
 * give. Loop calls at the `gather` alias, writes at the agent's synth alias
 * (`flash` for the red-team model, `pro` for Florida's default). 4 chars ≈ 1 token.
 */
function estimateUsd(seen: Seen[], synthAlias: 'flash' | 'pro'): { loop: number; write: number } {
  const g = config.llm.models.gather!;
  const s = config.llm.models[synthAlias]!;
  let loop = 0;
  let write = 0;
  for (const p of seen) {
    const inTok = p.chars / 4;
    const outTok = p.outChars / 4;
    if (p.kind === 'loop') loop += (inTok / 1e6) * g.inPerM + (outTok / 1e6) * g.outPerM;
    else write += (inTok / 1e6) * s.inPerM + (outTok / 1e6) * s.outPerM;
  }
  return { loop, write };
}

/** The last `turnsLeft` a tool result reported, or undefined before the first. */
function turnsLeft(opts: GenerateOptions): number | undefined {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const r = opts.messages[i]?.toolResult?.response as { turnsLeft?: number; stop?: boolean } | undefined;
    if (r && typeof r.turnsLeft === 'number') return r.turnsLeft;
  }
  return undefined;
}

/** URLs this conversation has already fetched (any result). */
function fetchedUrls(opts: GenerateOptions): string[] {
  const out: string[] = [];
  for (const m of opts.messages) {
    for (const c of m.toolCalls ?? []) if (c.name === 'fetch_page') out.push(String((c.args as { url?: string }).url ?? ''));
  }
  return out;
}

/** The first search-result URL in the conversation not yet fetched. */
function nextUnfetched(opts: GenerateOptions): string | undefined {
  const done = new Set(fetchedUrls(opts));
  for (const m of opts.messages) {
    const r = m.toolResult;
    if (r?.name !== 'web_search') continue;
    for (const res of (r.response as { results?: Array<{ url?: string }> }).results ?? []) {
      if (res.url && !done.has(res.url)) return res.url;
    }
  }
  return undefined;
}

/**
 * An HONEST, DILIGENT research agent — the ordinary request every cap has to keep
 * working. It does what the kickoff and the tool descriptions literally ask:
 *
 *   - `update_plan` first, and (`replan`) again after every step — the PLAN tool
 *     says "then again as you learn", the kickoff says "(3) revise the plan as you
 *     learn";
 *   - one `web_search`, then `fetch_page` on the best unseen result, alternating,
 *     until the budget is spent (`fullBudget`) or `tools` calls are made;
 *   - (`reopen`) re-reads N pages it already fetched — the deep-dive-refiner's
 *     focus text ("fetch_page listing URLs for details still marked n/a") is
 *     exactly this, and those fetches are cached, i.e. free of budget;
 *   - then stops and writes sections at the lengths the guidance asks for.
 *
 * ONE tool call per turn, which is how a real model behaves most of the time.
 */
class HonestDiligentProvider extends MockLlmProvider {
  readonly seen: Seen[] = [];
  private queries = 0;
  constructor(
    private readonly template: ResearchTemplate<any>,
    private readonly o: { replan?: boolean; reopen?: number; tools?: number; fullBudget?: boolean; prose?: string } = {},
  ) {
    super();
  }

  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.calls += 1;
    const usage = { inputTokens: 200, outputTokens: 80 };
    const kind: Seen['kind'] = opts.responseSchema ? 'structured' : opts.tools?.length ? 'loop' : 'text';
    const row: Seen = { call: this.calls, kind, agent: agentOf(this.template, opts), chars: flatChars(opts), outChars: 0 };
    this.seen.push(row);
    const done = (r: GenerateResult): GenerateResult => {
      row.outChars = r.text.length + JSON.stringify(r.toolCalls).length;
      return r;
    };

    if (opts.responseSchema) {
      const value = sampleRealistic(opts.responseSchema as Record<string, unknown>);
      return done({ text: JSON.stringify(value), toolCalls: [], usage });
    }
    if (!opts.tools?.length) return done({ text: PROSE, toolCalls: [], usage });

    const msgs = opts.messages;
    const toolMsgs = msgs.filter((m) => m.role === 'tool').length;
    const lastTool = [...msgs].reverse().find((m) => m.role === 'tool')?.toolResult;
    const call = (c: ToolCall) => done({ text: '', toolCalls: [c], usage });
    const plan = (n: number) => call({ id: `p${toolMsgs}`, name: 'update_plan', args: { steps: [{ task: `research step ${n}`, status: 'doing' }] } });

    if (toolMsgs === 0) return plan(0);
    const left = turnsLeft(opts);
    const spent = msgs.filter((m) => m.role === 'tool' && (m.toolResult?.name === 'web_search' || m.toolResult?.name === 'fetch_page')).length;
    const budgetDone = left === 0 || (!this.o.fullBudget && spent >= (this.o.tools ?? 6));

    if (!budgetDone) {
      if (this.o.replan && lastTool?.name !== 'update_plan') return plan(spent);
      const url = spent % 2 === 1 ? nextUnfetched(opts) : undefined;
      if (url) return call({ id: `f${toolMsgs}`, name: 'fetch_page', args: { url } });
      this.queries += 1;
      return call({ id: `s${toolMsgs}`, name: 'web_search', args: { query: `laundromat for sale Miami ${['revenue', 'SDE', 'lease', 'permits', 'multiples', 'reviews'][this.queries % 6]} ${this.queries}` } });
    }
    // Budget spent: re-open pages already read (cached, free), then stop.
    const reopened = msgs.filter((m) => m.role === 'tool' && (m.toolResult?.response as { pages?: Array<{ cached?: boolean }> })?.pages?.some((p) => p.cached)).length;
    const mine = fetchedUrls(opts);
    if (this.o.reopen && reopened < this.o.reopen && mine.length) {
      return call({ id: `r${toolMsgs}`, name: 'fetch_page', args: { url: mine[reopened % mine.length]! } });
    }
    return done({ text: 'Ready to write.', toolCalls: [], usage });
  }
}

function install(p: MockLlmProvider): void {
  for (const name of ['gemini-vertex', 'ollama']) __setProviderForTests(name, p);
}

async function run(template: ResearchTemplate<any>, params: Record<string, unknown>, extra: Partial<Parameters<typeof runResearch>[0]> = {}) {
  const progress: string[] = [];
  let checkpoint: Checkpoint | undefined;
  const out = await runResearch({
    template,
    params: template.paramsSchema.parse(params) as Record<string, unknown>,
    jobId: `d-legit-${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: '2026-08-17T00:00:00.000Z',
    onProgress: (p) => {
      progress.push(p.message);
    },
    onCheckpoint: (cp) => {
      checkpoint = cp;
    },
    ...extra,
  });
  return { out, progress, checkpoint: checkpoint! };
}

const FLORIDA_COMPREHENSIVE = { industry: 'laundromats', location: 'Miami-Dade County, FL', mode: 'comprehensive' };
const FLORIDA_ESSENTIAL = { industry: 'laundromats', location: 'Miami-Dade County, FL', mode: 'essential' };

/** Per-agent rollup of a `seen` list. */
function perAgent(seen: Seen[]) {
  const rows = new Map<string, { agent: string; loopCalls: number; loopChars: number; writeCalls: number; writeChars: number; largestLoop: number }>();
  for (const p of seen) {
    const r = rows.get(p.agent) ?? { agent: p.agent, loopCalls: 0, loopChars: 0, writeCalls: 0, writeChars: 0, largestLoop: 0 };
    if (p.kind === 'loop') {
      r.loopCalls += 1;
      r.loopChars += p.chars;
      r.largestLoop = Math.max(r.largestLoop, p.chars);
    } else {
      r.writeCalls += 1;
      r.writeChars += p.chars;
    }
    rows.set(p.agent, r);
  }
  return [...rows.values()];
}

// =============================================================================
// 1 · The honest baseline — the denominator for every D-attack claim
// =============================================================================

describe('1 · honest baseline on the red-team model (essential by default: budgets 2/2, maxIterations 10 per producer)', () => {
  it('runs in ESSENTIAL mode with budget 2 per producer — the harness numbers are essential-mode numbers', () => {
    // The red-team model declares no modes and the harness passes no `mode`, so
    // every reach-table row was measured at budgetScale 0.5: scout 3→2, refiner 2→2.
    const mode = resolveMode(redTeamModel.modes, undefined);
    expect(mode.key).toBe('essential');
    expect(mode.config.budgetScale).toBe(0.5);
    expect(Math.max(2, Math.round(3 * mode.config.budgetScale))).toBe(2);
  });

  it('stock MockLlmProvider: 11 generate calls, 8 loop calls, 4 turns, 27.2k loop chars; obedient(no payloads): 13 calls, 10 loop, 4 turns, 47.5k loop chars', async () => {
    // A: the stock mock (plan → 2 searches → stop, no fetch).
    const stock = installMockProvider();
    const seenStock: SeenPrompt[] = [];
    const base = stock.generate.bind(stock);
    stock.generate = async (opts) => {
      seenStock.push({ call: seenStock.length + 1, kind: opts.responseSchema ? 'structured' : opts.tools?.length ? 'loop' : 'text', system: opts.system, body: opts.messages.map((m) => m.text ?? JSON.stringify(m.toolResult ?? m.toolCalls ?? '')).join('\n') });
      return base(opts);
    };
    const a = await run(redTeamModel, {});
    // B: the obedient mock with nothing to obey (plan → search → fetch → search → stop).
    const obedient = installObedientProvider([]);
    const b = await run(redTeamModel, {});

    const loopChars = (s: SeenPrompt[]) => s.filter((p) => p.kind === 'loop').reduce((n, p) => n + p.system.length + p.body.length, 0);
    const rows = [
      { provider: 'stock MockLlmProvider', calls: stock.calls, loop: seenStock.filter((p) => p.kind === 'loop').length, 'loop chars': loopChars(seenStock), turns: a.out.turnsUsed, sources: a.out.sources.length, 'engine $': usd(a.out.trace.cost.usd), status: a.out.trace.status },
      { provider: 'obedient, no payloads', calls: obedient.calls, loop: obedient.seen.filter((p) => p.kind === 'loop').length, 'loop chars': loopChars(obedient.seen), turns: b.out.turnsUsed, sources: b.out.sources.length, 'engine $': usd(b.out.trace.cost.usd), status: b.out.trace.status },
    ];
    // eslint-disable-next-line no-console
    console.table(rows);

    for (const r of [a, b]) {
      expect(r.out.trace.status).toBe('completed');
      expect(r.out.meta.sections ?? []).toEqual([]); // nothing degraded — the honest run is whole
    }
    // The property every attack row is measured against: the honest obedient
    // control is 4 turns / 10 loop calls / ~47k loop chars — at PRODUCTION density,
    // 8 results per query; it read ~42k while the fixture returned 5 (R8-30). A cap
    // that stops THIS is a cap on the product.
    expect(b.out.turnsUsed).toBe(4);
    expect(obedient.seen.filter((p) => p.kind === 'loop').length).toBe(10);
    expect(loopChars(obedient.seen)).toBeGreaterThan(43_000);
    expect(loopChars(obedient.seen)).toBeLessThan(52_000);
    // …and the engine's $ is a per-call figure: 13 calls × fixed usage + 4 search turns.
    expect(b.out.trace.cost.searchCalls).toBe(4);
    expect(b.out.trace.cost.inputTokens).toBe(13 * 200);
  });
});

// =============================================================================
// 2 · The Florida flagship — comprehensive, honest and diligent
// =============================================================================

describe('2 · Florida comprehensive, honest & diligent — the denominator', () => {
  /** Loop calls per producer, next to its budget and its iteration bound. */
  function loopTable(p: HonestDiligentProvider, out: ResearchOutput) {
    return florida.agents
      .filter((a) => a.role === 'producer')
      .map((a) => {
        const calls = p.seen.filter((s) => s.kind === 'loop' && s.agent === a.id);
        const at = out.trace.agents.find((x) => x.id === a.id)!;
        const budget = a.researchBudget!;
        return { agent: a.id, budget, turns: at.turnsUsed, 'loop calls': calls.length, maxIterations: 2 * budget + 6, 'at bound': calls.length === 2 * budget + 6 ? 'STALLED' : '', 'loop chars': k(calls.reduce((n, s) => n + s.chars, 0)), 'largest req': k(Math.max(0, ...calls.map((s) => s.chars))) };
      });
  }

  it('one tool per turn, plan once, full budget: 172 calls = 157 loop + 15 writes / 92 turns; 4.03M loop chars + 0.55M write chars = 4.58M; largest loop request 60.6k, largest write 67.7k; est. $0.31 loop + $0.69 write LLM vs $1.65 search', async () => {
    const p = new HonestDiligentProvider(florida, { fullBudget: true });
    install(p);
    const { out, checkpoint } = await run(florida, FLORIDA_COMPREHENSIVE);
    expect(out.trace.status).toBe('completed');
    expect(out.meta.sections ?? []).toEqual([]); // whole: nothing lost, nothing unenriched

    const loop = p.seen.filter((s) => s.kind === 'loop');
    const writes = p.seen.filter((s) => s.kind === 'structured');
    const loopChars = loop.reduce((n, s) => n + s.chars, 0);
    const writeChars = writes.reduce((n, s) => n + s.chars, 0);
    const est = estimateUsd(p.seen, 'pro');
    // eslint-disable-next-line no-console
    console.log('\n=== FLORIDA COMPREHENSIVE, HONEST (plan once) — per producer ===');
    // eslint-disable-next-line no-console
    console.table(loopTable(p, out));
    // eslint-disable-next-line no-console
    console.table([{
      'generate calls': p.calls, 'loop calls': loop.length, turns: out.turnsUsed, writes: writes.length,
      'loop chars': k(loopChars), 'write chars': k(writeChars), 'TOTAL chars': k(loopChars + writeChars),
      'largest loop req': k(Math.max(...loop.map((s) => s.chars))), 'largest write': k(Math.max(...writes.map((s) => s.chars))),
      'est LLM $ (loop/write)': `${usd(est.loop)} / ${usd(est.write)}`, 'engine search $': usd(out.trace.cost.searchUsd),
      sources: out.sources.length, 'pages fetched': checkpoint.extracted?.length ?? 0, 'checkpoint bytes': k(JSON.stringify(checkpoint).length), 'report chars': k(JSON.stringify(out.report).length),
    }]);

    // (a) every producer spent its whole budget and concluded — turns == Σ budgets, no loop at its bound.
    const budgets = florida.agents.filter((a) => a.role === 'producer').reduce((n, a) => n + (a.researchBudget ?? config.search.maxTurns), 0);
    expect(out.turnsUsed).toBe(budgets); // 92
    for (const r of loopTable(p, out)) expect(r['at bound'], `${r.agent} hit maxIterations`).toBe('');
    // (b) the loop's request grows LINEARLY with turns (search results + page
    //     stubs + plan args stay in the conversation; bodies are trimmed to
    //     KEEP_FULL_PAGES): the 24-turn deal-scout's largest request is ~3.2× an
    //     8-turn agent's (~3.3× at production density), i.e. within 1.5× of the
    //     3× a linear bound predicts.
    //     (Fake pages are ~1k chars, so KEEP_FULL_PAGES is invisible here — the
    //     real 6k-page case is the July trace: deal-scout 1.9M input tokens over
    //     ~46 iterations pre-C4.)
    const largest = (id: string) => Math.max(...loop.filter((s) => s.agent === id).map((s) => s.chars));
    expect(largest('deal-scout')).toBeLessThan(4.5 * largest('market-analyst'));
    // (c) the whole honest run is under 5M chars (~1.25M tokens): the denominator
    //     for every "×N" D-attack claims. It was 3.94M / a 4.5M bound while the
    //     fixture returned 5 results per query; production returns 8 (R8-30), and
    //     every figure in this test's title moved with it.
    expect(loopChars + writeChars).toBeLessThan(5_000_000);
    // (d) the honest job's estimated LLM spend is under 1/20 of the ceiling; at
    //     Tavily rates SEARCH is the larger honest line.
    expect(est.loop + est.write).toBeLessThan(maxCostForMode(florida.modes!.comprehensive!, config.workflow.maxJobCostUsd) / 20);
    expect(out.trace.cost.searchUsd).toBeGreaterThan(est.loop + est.write);
  });

  it('re-planning after every step (what the real model does: plans ≈ turns+1 in out/*/trace.json) — 234 loop calls / 78 of 92 turns; 8 of 10 producers hit maxIterations = 2·budget+6 and never conclude; 5.69M loop chars (1.4× plan-once)', async () => {
    // Same honest script, plus one `update_plan` after each step — the tool
    // description ("then again as you learn"), the kickoff ("(3) revise the plan
    // as you learn"), and the two real July traces (market-analyst 7 plans / 6
    // turns, deal-scout 23/21 and 24/24, compliance 8/6) all say this is ordinary.
    // With cross-agent cached reads (free, one iteration each) it runs out of
    // ITERATIONS before it runs out of BUDGET.
    const p = new HonestDiligentProvider(florida, { replan: true, fullBudget: true });
    install(p);
    const { out } = await run(florida, FLORIDA_COMPREHENSIVE);
    expect(out.trace.status).toBe('completed');
    expect(out.meta.sections ?? []).toEqual([]);
    const table = loopTable(p, out);
    // eslint-disable-next-line no-console
    console.log('\n=== FLORIDA COMPREHENSIVE, HONEST (re-plan each step) — per producer ===');
    // eslint-disable-next-line no-console
    console.table(table);
    const loop = p.seen.filter((s) => s.kind === 'loop');
    const loopChars = loop.reduce((n, s) => n + s.chars, 0);
    // eslint-disable-next-line no-console
    console.table([{ 'loop calls': loop.length, turns: out.turnsUsed, 'loop chars': k(loopChars), 'est loop $': usd(estimateUsd(p.seen, 'pro').loop), 'stalled producers': table.filter((r) => r['at bound']).length }]);
    // Measured today (a property test below says what SHOULD hold):
    expect(table.filter((r) => r['at bound']).length).toBe(8);
    expect(out.turnsUsed).toBe(78);
    // …and the trace now SAYS so: `GatherStop` reaches a note and a field on every
    // producer (mutation: drop `trace.gatherStop = gres.stop` / the closing note).
    for (const a of out.trace.agents.filter((x) => x.role === 'producer')) {
      expect(a.gatherStop, a.id).toBeDefined();
      expect(a.notes.some((n) => n.includes(`Research loop ended: ${a.gatherStop}`)), a.id).toBe(true);
    }
  });

  it.fails('PROPERTY (fails today): an honest producer that re-plans once per step and re-reads ≤ 6 cached pages spends its whole budget and concludes — today deal-scout gets 22/24, valuation & deep-dive-refiner 7/10, and none of the eight says "Ready to write"', async () => {
    const p = new HonestDiligentProvider(florida, { replan: true, fullBudget: true });
    install(p);
    const { out } = await run(florida, FLORIDA_COMPREHENSIVE);
    const budgets = florida.agents.filter((a) => a.role === 'producer').reduce((n, a) => n + (a.researchBudget ?? config.search.maxTurns), 0);
    // The iteration bound is `2·budget + 6`: one plan and one tool per turn leaves
    // exactly 6 spare iterations for the initial plan, the stop turn and every
    // cached re-read — the thing the shared evidence store exists to encourage.
    // Free iterations (plan, cached fetch, budget-reached refusal) count against
    // the same bound as paid ones. Fix sketch: bound free iterations on their own
    // (≥ budget+2 plans, ≥ 2×targetCount cached reads) or bound the loop's CHARS,
    // and record the stop reason in the trace. Naively lowering the bound (D-attack)
    // cuts these honest agents further; naively raising it lets plan-spam run longer.
    expect(out.turnsUsed).toBe(budgets);
  });

  it('honest re-planning is what the prompts ask for: 3 instructions to revise the plan, none saying how often', () => {
    const gatherSrc = SRC('engine/gather.ts');
    const promptSrc = SRC('engine/prompt.ts');
    expect(gatherSrc).toContain('then again as you learn');
    expect(gatherSrc).toContain('Pass the FULL updated list each time');
    expect(promptSrc).toContain('revise the plan as you learn');
    expect(`${gatherSrc}\n${promptSrc}`).not.toMatch(/at most \d+ plan/i);
  });
});

// =============================================================================
// 3 · Retry economics for HONEST failures
// =============================================================================

/** The obedient mock, made to throw ONCE at the first call matching `when` — a 503, not a bad answer. */
class FlakyOnce extends ObedientMockProvider {
  thrown = 0;
  constructor(private readonly when: (opts: GenerateOptions, call: number) => boolean) {
    super([]);
  }
  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    if (this.thrown === 0 && this.when(opts, this.calls + 1)) {
      this.thrown = 1;
      // Recorded as seen (it was sent, and a provider may bill it) but no usage
      // comes back — the transport failed.
      this.calls += 1;
      throw new Error('503 UNAVAILABLE (transient)');
    }
    return super.generate(opts);
  }
}

describe('3 · what an honest run pays for ONE flaky provider call', () => {
  const baseline = async () => {
    const mock = installObedientProvider([]);
    const { out } = await run(redTeamModel, {});
    return { calls: mock.calls, loop: mock.seen.filter((s) => s.kind === 'loop').length, turns: out.turnsUsed, usd: out.trace.cost.usd, searchCalls: out.trace.cost.searchCalls };
  };

  it('a 503 on the WRITE: +1 call, +0 turns, +$0 search — the loop is not re-bought (gatherCompleted on `done`)', async () => {
    const b = await baseline();
    const flaky = new FlakyOnce((opts) => !!opts.responseSchema); // the scout's first write
    install(flaky);
    const { out } = await run(redTeamModel, {});
    expect(out.trace.status).toBe('completed');
    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.attempts).toBe(2);
    expect(scout.notes.join('\n')).toMatch(/Reusing evidence already gathered/);
    // The honest bill for one flaky write: exactly one extra generate call and NO
    // extra search turn. Mutation that reds it: `ctx.research.done = gatherCompleted(gres)`
    // → `= false` in research-engine.ts (the loop is re-run: +5 calls, +2 turns).
    expect(flaky.calls).toBe(b.calls + 1);
    expect(flaky.seen.filter((s) => s.kind === 'loop').length).toBe(b.loop);
    expect(out.turnsUsed).toBe(b.turns);
    expect(out.trace.cost.searchCalls).toBe(b.searchCalls);
    expect(out.trace.cost.usd).toBeCloseTo(b.usd, 6); // the failed call returned no usage
  });

  it('a 503 in the LOOP (after the first search): the whole loop re-runs — +3 calls, +1 search re-bought (+$0.016), and the trace counts the thrown loop’s turn too: turnsUsed 5 = searchCalls 5 (before the fix: 4)', async () => {
    const b = await baseline();
    // The scout's third loop call: after plan and one search — one turn already paid.
    let loopCalls = 0;
    const flaky = new FlakyOnce((opts) => !!opts.tools?.length && ++loopCalls === 3);
    install(flaky);
    const { out } = await run(redTeamModel, {});
    expect(out.trace.status).toBe('completed');
    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.attempts).toBe(2);
    expect(scout.notes.join('\n')).not.toMatch(/Reusing evidence/);
    // Paid before the throw: plan + 1 search (1 turn, charged to the sink). The
    // retry runs the full loop again: search, fetch → budget. The first search's
    // results are already in `evidence.sources`, but the SEARCH is re-billed —
    // only pages are cached, queries are not.
    expect(out.trace.cost.searchCalls).toBe(b.searchCalls + 1);
    expect(flaky.calls).toBe(b.calls + 3); // the thrown call + plan + search re-sent
    expect(out.trace.cost.usd - b.usd).toBeCloseTo(0.016 + 2 * (200 * 0.3 + 80 * 2.5) / 1e6, 4);
    // …and `turnsUsed` — the number the job summary and the admin's per-agent row
    // show — is counted as each turn is CHARGED, like the cost, so the thrown loop's
    // turn is in it too: 3 searchCalls, 3 turns. It used to be added only when
    // `gather` returned (2 turns shown for 3 billed). Mutation that reds this: drop
    // the `onTurn` callback and add `gres.turns` after the loop again.
    expect(scout.cost.searchCalls).toBe(3);
    expect(scout.turnsUsed).toBe(3);
    expect(out.turnsUsed).toBe(b.turns + 1); // 5, like searchCalls
  });

  it('a diligent agent on budget 10 that re-plans every step and re-opens 6 cached listings ends STALLED at 26 iterations — the honest scenario', async () => {
    // Exactly the deep-dive-refiner's shape: researchBudget 10 (maxIterations 26),
    // "fetch_page listing URLs for details still marked n/a" (cached → free), and
    // the plan tool's "then again as you learn". Iterations: 1 plan + 10×(plan+tool)
    // + 6 cached re-opens = 27 > 26 — the stop turn never comes.
    const one: ResearchTemplate<any> = {
      ...redTeamModel,
      modes: { comprehensive: { label: 'c', budgetScale: 1, depth: 'standard' }, essential: { label: 'e', budgetScale: 1, depth: 'light' } },
      agents: [{ ...redTeamModel.agents[0]!, researchBudget: 10 }, redTeamModel.agents[2]!],
    };
    const p = new HonestDiligentProvider(one, { replan: true, fullBudget: true, reopen: 6 });
    install(p);
    const { out } = await run(one, {});
    expect(out.trace.status).toBe('completed'); // stalled is NOT a failure today
    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.turnsUsed).toBe(10);
    const loop = p.seen.filter((s) => s.kind === 'loop' && s.agent === 'scout');
    // The loop hit the iteration bound: 2·10+6 = 26 generate calls, no "Ready to write".
    expect(loop.length).toBe(2 * 10 + 6);
    expect(scout.attempts).toBe(1);
    // …and its research is NOT reusable: `gatherCompleted` says stalled ≠ finished.
    // Measured below: what that costs when the write then fails once.
  });

  it('…and if its write then hits ONE 503, the retry re-runs the loop and STALLS AGAIN: 18 turns billed for a 10-turn budget (its own pages are now cached, so 8 more searches), vs 10 when the loop had concluded', async () => {
    const one: ResearchTemplate<any> = {
      ...redTeamModel,
      modes: { comprehensive: { label: 'c', budgetScale: 1, depth: 'standard' }, essential: { label: 'e', budgetScale: 1, depth: 'light' } },
      agents: [{ ...redTeamModel.agents[0]!, researchBudget: 10 }, redTeamModel.agents[2]!],
    };
    class StalledThenFlaky extends HonestDiligentProvider {
      thrown = 0;
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        if (opts.responseSchema && this.thrown === 0) {
          this.thrown = 1;
          this.calls += 1;
          throw new Error('503 UNAVAILABLE (transient)');
        }
        return super.generate(opts);
      }
    }
    const p = new StalledThenFlaky(one, { replan: true, fullBudget: true, reopen: 6 });
    install(p);
    const { out } = await run(one, {});
    expect(out.trace.status).toBe('completed');
    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.attempts).toBe(2);
    // The loop spent its whole allowance and ran out of iterations — that FINISHED
    // its research, so the retry after the 503 reuses it. Before the fix this was
    // `stalled` → not reusable → 18 search/fetch turns billed for a 10-turn budget
    // (the retry stalled again). Mutation that reds this: drop the
    // `stalled && turnsUsed >= maxTurns → 'budget'` line at the end of gather().
    expect(scout.notes.join('\n')).toMatch(/Reusing evidence/);
    expect(out.turnsUsed).toBe(10);
    expect(out.trace.cost.searchCalls).toBe(10);
    // The same agent with the same 503 but a loop that CONCLUDED (no re-opens: 22
    // iterations, stops with "Ready to write") pays 10. That delta — 10 turns —
    // is the price of `stalled` today, and it is charged to an honest, diligent
    // agent that followed the tool description. A "no retry after stalled" rule
    // would instead DEGRADE this agent's sections on the first flaky write.
    const q = new StalledThenFlaky(one, { replan: true, fullBudget: true, reopen: 0 });
    install(q);
    const { out: concluded } = await run(one, {});
    expect(concluded.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(concluded.trace.agents.find((a) => a.id === 'scout')!.notes.join('\n')).toMatch(/Reusing evidence/);
    expect(concluded.turnsUsed).toBe(10);
    // eslint-disable-next-line no-console
    console.table([
      { loop: 'stalled (26 iters), then one 503 on write', turns: out.turnsUsed, 'engine $': usd(out.trace.cost.usd), attempts: scout.attempts },
      { loop: 'concluded (22 iters), then one 503 on write', turns: concluded.turnsUsed, 'engine $': usd(concluded.trace.cost.usd), attempts: 2 },
    ]);
  });
});

// =============================================================================
// 4 · Query length and output size — the honest shapes a cap must clear
// =============================================================================

describe('4 · honest sizes for a cap to have a property behind it', () => {
  const OUT = path.resolve(HERE, '../../../../out');
  const realTraces = existsSync(OUT) ? readdirSync(OUT).map((d) => path.join(OUT, d, 'trace.json')).filter((f) => existsSync(f)) : [];
  it.skipIf(realTraces.length === 0)('honest queries: 81 real gemini-2.5-flash queries in out/*/trace.json — p50 68, p90 90, max 118 chars (a `site:` OR-chain from the deal-scout focus text)', () => {
    // From the July local runs kept in `out/` (real model, real search). The
    // longest honest query is a legitimate `site:a OR site:b OR site:c` chain that
    // the deal-scout's own focus text invites. A query cap must be ≥ 2× the longest
    // honest query observed (≥ 236) or it cuts a query the template asks for.
    const queries: string[] = [];
    let longestNote = 0;
    for (const f of realTraces) {
      const t = JSON.parse(readFileSync(f, 'utf8')) as { agents: Array<{ notes: string[] }> };
      for (const a of t.agents) for (const n of a.notes ?? []) {
        longestNote = Math.max(longestNote, n.length);
        const m = /Searched: (.*)$/.exec(n);
        if (m) queries.push(m[1]!);
      }
    }
    const L = queries.map((q) => q.length).sort((a, b) => a - b);
    const p = (x: number) => L[Math.min(L.length - 1, Math.floor(L.length * x))]!;
    // eslint-disable-next-line no-console
    console.table([{ 'real queries': L.length, min: L[0], p50: p(0.5), p90: p(0.9), max: L[L.length - 1], 'longest trace note': longestNote }]);
    expect(L.length).toBeGreaterThan(50);
    expect(L[L.length - 1]).toBeLessThanOrEqual(150); // no honest query anywhere near a 300-char cap
    expect(queries.some((q) => /site:\S+ OR site:/.test(q))).toBe(true); // …and the long ones are `site:` chains
    // The property for a cap: ≥ 2× the longest honest observed.
    expect(2 * L[L.length - 1]!).toBeLessThanOrEqual(300);
  });

  it('honest sections: Florida asks for 18 prose fields of ≥150–600 words; the largest real section is deep_dives at 40.5k chars (6 profiles); exec summary 8.9–10.0k chars', () => {
    // From the template: the words the guidance asks for, summed, is the honest
    // output floor of a comprehensive report — before Markdown, JSON escaping and
    // Spanish (longer than English).
    const src = SRC('templates/florida-business-for-sale.ts');
    const asks = [...src.matchAll(/≥(\d+) words/g)].map((m) => Number(m[1]));
    const words = asks.reduce((n, w) => n + w, 0);
    expect(asks.length).toBe(18);
    expect(words).toBe(5650);
    // 5,650 words × ~6.5 chars ≈ 37k chars of prose MINIMUM across the report, on
    // top of lists, tables and profiles. The largest single write is deep_dives
    // (6 profiles "toward a full page" each): 40.5k chars real ≈ 10–13k tokens
    // JSON-escaped. A writer output cap has to be ≥ 2× that: ≥ ~26k tokens. The
    // current cap (32,768) clears it by 1.25×; a "16k" cap would cut an honest
    // Spanish comprehensive deep_dives.
    expect(config.llm.maxOutputTokens).toBeGreaterThanOrEqual(2 * 13_000);
    // And the mock's realistic-length writes for the whole comprehensive report:
    const p = new HonestDiligentProvider(florida, { fullBudget: false, tools: 2 });
    install(p);
    return run(florida, FLORIDA_COMPREHENSIVE).then(({ out }) => {
      const largest = Math.max(...Object.entries(out.report).map(([, v]) => JSON.stringify(v).length));
      expect(out.trace.status).toBe('completed');
      expect(largest).toBeGreaterThan(15_000); // deep_dives at the guidance's lengths, ONE profile (real: 4–6 → 35–40k)
      expect(largest / 4).toBeLessThan(config.llm.maxOutputTokens / 2); // …and still under half the cap
    });
  });
});

// =============================================================================
// 5 · The ceiling: protection vs obstacle — honest headroom, and one poisoned page
// =============================================================================

describe('5 · the $20 ceiling vs an honest comprehensive job vs the harness worst spend payload', () => {
  it('Florida declares NO per-mode maxCostUsd — both modes ride the deployment default ($20); honest real comprehensive was $3.89 (5.1× headroom), essential modelled ~$1.95 (10×)', () => {
    expect(florida.modes!.comprehensive!.maxCostUsd).toBeUndefined();
    expect(florida.modes!.essential!.maxCostUsd).toBeUndefined();
    expect(maxCostForMode(florida.modes!.comprehensive!, config.workflow.maxJobCostUsd)).toBe(20);
    expect(maxCostForMode(florida.modes!.essential!, config.workflow.maxJobCostUsd)).toBe(20);
    // Real datapoint (out/local-aa4b3edf, 2026-07-07, gemini flash+pro, es, 13
    // agents, pre-C4 page trimming): $3.885843 = $3.006 LLM (4.10M in / 206k out)
    // + $0.88 search (55 calls). D1 models $0.24/credit × 18 = $4.32.
    expect(20 / 3.885843).toBeGreaterThan(5);
    expect(20 / (0.39 * 5)).toBeGreaterThan(10);
  });

  it('plan-spam obeyed by deal-scout alone or by ALL 10 producers adds < 2% / < 5% of the ceiling — before the loop fixes +1.45M chars (+$0.16, 0.8%) and +3.53M (+$0.46, 2.3%) with turns collapsing 79→12; now the same-URL cap and plan stubbing make it cost about nothing — the report completes either way', async () => {
    // Honest control (same diligent script, honest web).
    const ctl = new HonestDiligentProvider(florida, { replan: true, fullBudget: true });
    install(ctl);
    const control = await run(florida, FLORIDA_COMPREHENSIVE);
    const ctlLoop = ctl.seen.filter((s) => s.kind === 'loop').reduce((n, s) => n + s.chars, 0);
    const ctlEst = estimateUsd(ctl.seen, 'pro');

    // A: the plan-spam page is read and obeyed by ONE agent (deal-scout, budget 24 →
    // 2·24+6 = 54 iterations, the largest bound in the model). Everyone else stays honest.
    const spam = payload('plan-spam');
    class OnePoisoned extends HonestDiligentProvider {
      constructor(t: ResearchTemplate<any>, private readonly victims: Set<string>) {
        super(t, { replan: true, fullBudget: true });
      }
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        const agent = agentOf(florida, opts);
        if (opts.tools?.length && this.victims.has(agent)) {
          const toolMsgs = opts.messages.filter((m) => m.role === 'tool').length;
          const text = opts.messages.map((m) => m.text ?? (m.toolResult ? JSON.stringify(m.toolResult) : '')).join('\n');
          if (text.includes(spam.sentinel)) {
            const move = spam.obeyLoop!({ toolMsgs, text, spent: 0 });
            if (move && move !== 'stop') {
              this.seen.push({ call: ++this.calls, kind: 'loop', agent, chars: flatChars(opts), outChars: JSON.stringify(move).length });
              return { text: '', toolCalls: move, usage: { inputTokens: 200, outputTokens: 80 } };
            }
          }
          // Before the poison is read: one search (poison ranks first) then fetch it.
          if (toolMsgs === 1) {
            this.seen.push({ call: ++this.calls, kind: 'loop', agent, chars: flatChars(opts), outChars: 0 });
            return { text: '', toolCalls: [{ id: 'q', name: 'web_search', args: { query: 'laundromat business for sale Miami' } }], usage: { inputTokens: 200, outputTokens: 80 } };
          }
          if (toolMsgs === 2) {
            this.seen.push({ call: ++this.calls, kind: 'loop', agent, chars: flatChars(opts), outChars: 0 });
            return { text: '', toolCalls: [{ id: 'f', name: 'fetch_page', args: { url: spam.page.url } }], usage: { inputTokens: 200, outputTokens: 80 } };
          }
        }
        return super.generate(opts);
      }
    }
    restore = poisonWeb(['plan-spam']);

    const one = new OnePoisoned(florida, new Set(['deal-scout']));
    install(one);
    const a = await run(florida, FLORIDA_COMPREHENSIVE);
    const aLoop = one.seen.filter((s) => s.kind === 'loop').reduce((n, s) => n + s.chars, 0);
    const aEst = estimateUsd(one.seen, 'pro');
    const scoutCalls = one.seen.filter((s) => s.kind === 'loop' && s.agent === 'deal-scout').length;

    const producers = new Set(florida.agents.filter((x) => x.role === 'producer').map((x) => x.id));
    const all = new OnePoisoned(florida, producers);
    install(all);
    const b = await run(florida, FLORIDA_COMPREHENSIVE);
    const bLoop = all.seen.filter((s) => s.kind === 'loop').reduce((n, s) => n + s.chars, 0);
    const bEst = estimateUsd(all.seen, 'pro');

    const ceiling = maxCostForMode(florida.modes!.comprehensive!, config.workflow.maxJobCostUsd);
    // eslint-disable-next-line no-console
    console.table([
      { run: 'honest control', 'loop calls': ctl.seen.filter((s) => s.kind === 'loop').length, 'loop chars': k(ctlLoop), turns: control.out.turnsUsed, 'est LLM $': usd(ctlEst.loop + ctlEst.write), 'engine $ (incl. search)': usd(control.out.trace.cost.usd), status: control.out.trace.status },
      { run: 'plan-spam × deal-scout', 'loop calls': one.seen.filter((s) => s.kind === 'loop').length, 'loop chars': k(aLoop), turns: a.out.turnsUsed, 'est LLM $': usd(aEst.loop + aEst.write), 'engine $ (incl. search)': usd(a.out.trace.cost.usd), status: a.out.trace.status, 'Δ loop chars': k(aLoop - ctlLoop), 'Δ est $': usd(aEst.loop - ctlEst.loop), '% of ceiling': `${(((aEst.loop - ctlEst.loop) / ceiling) * 100).toFixed(2)}%` },
      { run: 'plan-spam × all 10 producers', 'loop calls': all.seen.filter((s) => s.kind === 'loop').length, 'loop chars': k(bLoop), turns: b.out.turnsUsed, 'est LLM $': usd(bEst.loop + bEst.write), 'engine $ (incl. search)': usd(b.out.trace.cost.usd), status: b.out.trace.status, 'Δ loop chars': k(bLoop - ctlLoop), 'Δ est $': usd(bEst.loop - ctlEst.loop), '% of ceiling': `${(((bEst.loop - ctlEst.loop) / ceiling) * 100).toFixed(2)}%` },
    ]);

    // The poison was read and obeyed: deal-scout ran to its iteration bound.
    expect(scoutCalls).toBe(2 * 24 + 6);
    // Both attacked jobs still COMPLETE with every section — plan-spam is waste,
    // not denial. Whether that waste is a finding is D-attack's; the control says
    // how big it is.
    expect(a.out.trace.status).toBe('completed');
    expect(b.out.trace.status).toBe('completed');
    expect(a.out.meta.sections ?? []).toEqual([]);
    expect(b.out.meta.sections ?? []).toEqual([]);
    // The ceiling is NOT the mechanism that bounds it — `maxIterations` is: even
    // with every producer spammed, the estimated extra spend is under 5% of the
    // ceiling, so a "lower ceiling" proposal cannot reach it without first holding
    // honest jobs (which sit at ~20% of it, real).
    expect(bEst.loop - ctlEst.loop).toBeLessThan(ceiling * 0.05);
    expect(aEst.loop - ctlEst.loop).toBeLessThan(ceiling * 0.02);
    // And in the fixed-usage engine $, the attacked job costs LESS than the honest
    // one (fewer real turns) — the mock's $ column cannot see this attack at all.
    expect(a.out.trace.cost.usd).toBeLessThanOrEqual(control.out.trace.cost.usd);
  });
});

// =============================================================================
// 6 · Sources and checkpoint size — honest comprehensive
// =============================================================================

describe('6 · what an honest comprehensive job stores', () => {
  it('checkpoint 185k chars here (8 pages, 137k report); real bound ≈ 200k report + 350k sources + 60 pages × 6k + 13 × 1.5k handoffs ≈ 0.94MB, all in GCS — Firestore carries only progress/cost/summary', async () => {
    const p = new HonestDiligentProvider(florida, { replan: true, fullBudget: true });
    install(p);
    const { out, checkpoint } = await run(florida, FLORIDA_COMPREHENSIVE);
    expect(out.trace.status).toBe('completed');
    const bytes = JSON.stringify(checkpoint).length;
    const extracted = checkpoint.extracted ?? [];
    const bodies = extracted.reduce((n, e) => n + (e.content?.length ?? 0), 0);
    // eslint-disable-next-line no-console
    console.table([{
      sources: out.sources.length, 'checkpoint bytes': k(bytes), 'pages carried': extracted.length, 'page bodies chars': k(bodies),
      'report chars': k(JSON.stringify(checkpoint.report).length), 'handoffs chars': k(JSON.stringify(checkpoint.handoffs ?? {}).length),
      'agentTraces chars': k(JSON.stringify(checkpoint.agentTraces ?? []).length),
      'real upper bound est.': `${k(200_000 + 360_000 + 60 * 6_000 + 13 * 1_500)} (report+sources+60×6k pages+handoffs)`,
    }]);
    // Properties: the checkpoint's page list is capped (mutation that reds it:
    // CHECKPOINT_MAX_PAGES 60 → Infinity would not change THIS honest run — 8
    // pages — so the cap is asserted directly against the constant's contract).
    expect(extracted.length).toBeLessThanOrEqual(60);
    // Handoffs are cut at MAX_HANDOFF_CHARS each — 13 agents × 1.5k = ≤ 19.5k.
    for (const h of Object.values(checkpoint.handoffs ?? {})) expect(h.length).toBeLessThanOrEqual(1_501);
    // No page body over the extract cap + note (6,000 + ~250).
    for (const e of extracted) expect(e.content?.length ?? 0).toBeLessThan(6_400);
    // The checkpoint's slim agent traces carry NO notes (the trace does; it is GCS too).
    for (const a of checkpoint.agentTraces ?? []) expect(a.notes).toEqual([]);
    // Everything of size goes to GCS (`uploadJson` in run-job.ts). What reaches
    // Firestore per job is `progress` (one line), `cost`, `summary`, headline —
    // the only model-authored string of unbounded length among them is
    // `progress.message` = `Searched: <query>` (bounded by gatherMaxOutputTokens
    // ≈ 16k chars, far under the 1MB doc limit).
    expect(bytes).toBeLessThan(1_000_000);
  });

  it('essential vs comprehensive honest turns: 40 vs 92 (Σ budgets × budgetScale, 8 vs 10 producers — D1\'s figures); est. $1.31 vs $2.65 all-in: essential is ~50% of the cost at 28% of the credits', async () => {
    const p = new HonestDiligentProvider(florida, { fullBudget: true });
    install(p);
    const c = await run(florida, FLORIDA_COMPREHENSIVE);
    const q = new HonestDiligentProvider(florida, { fullBudget: true });
    install(q);
    const e = await run(florida, FLORIDA_ESSENTIAL);
    // eslint-disable-next-line no-console
    console.table([
      { mode: 'comprehensive', turns: c.out.turnsUsed, 'loop calls': p.seen.filter((s) => s.kind === 'loop').length, 'chars': k(p.seen.reduce((n, s) => n + s.chars, 0)), 'est LLM $': usd(Object.values(estimateUsd(p.seen, 'pro')).reduce((a, b) => a + b, 0)), 'engine search $': usd(c.out.trace.cost.searchUsd), agents: c.out.trace.agents.length },
      { mode: 'essential', turns: e.out.turnsUsed, 'loop calls': q.seen.filter((s) => s.kind === 'loop').length, 'chars': k(q.seen.reduce((n, s) => n + s.chars, 0)), 'est LLM $': usd(Object.values(estimateUsd(q.seen, 'pro')).reduce((a, b) => a + b, 0)), 'engine search $': usd(e.out.trace.cost.searchUsd), agents: e.out.trace.agents.length },
    ]);
    expect(c.out.turnsUsed).toBe(92);
    expect(e.out.turnsUsed).toBe(40);
    // A per-mode ceiling with a property behind it: ≥ 2× the honest p95 of THAT
    // mode, not one $20 for both — essential's honest cost is half of comprehensive's.
    expect(e.out.turnsUsed).toBeLessThan(c.out.turnsUsed / 2 + 1);
  });
});
