/**
 * Refuter for cluster M-B2 (free `update_plan` / cached-fetch calls, the flat
 * `maxIterations = 2·budget+6`, note eviction, progress flooding, `stalled` at
 * 100% budget, unrecorded stop reason).
 *
 * Section 1 reads the two REAL July traces (out/*\/trace.json) and checks the
 * finders' arithmetic itself: are the tool notes one per iteration (no batching)?
 * which agents sit EXACTLY at their bound? what is the honest maximum run of
 * consecutive plan / free calls — the number a breaker must tolerate?
 *
 * Section 2 replays the real deal-scout sequence (24 P + 24 paid + 6 cached = 54)
 * through today's `gather` and pins that it ends `stalled` at 100% budget.
 *
 * Section 3 is the arithmetic behind "400 update_plan calls in ONE turn": what
 * fits in `gatherMaxOutputTokens`.
 *
 * Mock tier only. No src/ change. Skips section 1 if the traces are absent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { gather, createEvidence, gatherCompleted, type GatherResult } from '../../src/engine/gather.js';
import { config } from '../../src/config.js';
import { resolveModel, __setProviderForTests } from '../../src/llm/models.js';
import { getTemplate } from '../../src/templates/registry.js';
import { MockLlmProvider } from '../mocks/llm.js';
import type { GenerateOptions, GenerateResult, ToolCall } from '../../src/llm/provider.js';
import { __setExtraPages, type Page } from '../fixtures/fake-web.js';

// vitest.config runs from packages/core; the traces live at the repo root.
const OUT_DIR = resolve(process.cwd(), '../../out');
const traceDirs = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((d) => existsSync(resolve(OUT_DIR, d, 'trace.json'))) : [];

interface TraceAgent { id: string; role: string; turnsUsed?: number; notes?: string[]; cost?: { usd?: number; searchCalls?: number; inputTokens?: number } }
interface Trace { agents: TraceAgent[]; language: string; cost?: { usd: number } }

const florida = getTemplate('florida-business-for-sale')!;
const budgetOf = (id: string) => florida.agents.find((a) => a.id === id)?.researchBudget ?? NaN;
const isTool = (n: string) => /Plan updated|Searched:|Search failed|Fetched \d|Reused cached/.test(n);
const kindOf = (n: string) => (/Plan updated/.test(n) ? 'P' : /Reused cached/.test(n) ? 'c' : /Searched:|Search failed/.test(n) ? 'S' : 'F');
const tsOf = (n: string) => Date.parse(n.slice(0, 24));

function loadTraces(): Array<{ dir: string; trace: Trace }> {
  return traceDirs.map((dir) => ({ dir, trace: JSON.parse(readFileSync(resolve(OUT_DIR, dir, 'trace.json'), 'utf8')) as Trace }));
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

// ============================================================================
// 1 · The REAL July traces: is D-legit's "hit its bound with 0 searches" true?
// ============================================================================

describe.skipIf(traceDirs.length === 0)('refute B2 · the two real July traces (gemini-2.5-flash loop), read for ourselves', () => {
  it('every producer’s tool notes are ≤ 2·budget+6 (its bound), and three agent-runs sit EXACTLY at it — two of them with ZERO paid turns', () => {
    const rows: Array<{ dir: string; agent: string; budget: number; bound: number; toolNotes: number; plans: number; cached: number; turns: number; atBound: boolean; usd?: number }> = [];
    for (const { dir, trace } of loadTraces()) {
      for (const a of trace.agents) {
        if (a.role !== 'producer') continue;
        const notes = (a.notes ?? []).filter(isTool);
        const budget = budgetOf(a.id);
        const bound = budget * 2 + 6;
        rows.push({
          dir, agent: a.id, budget, bound,
          toolNotes: notes.length,
          plans: notes.filter((n) => kindOf(n) === 'P').length,
          cached: notes.filter((n) => kindOf(n) === 'c').length,
          turns: a.turnsUsed ?? 0,
          atBound: notes.length === bound,
          usd: a.cost?.usd,
        });
      }
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    // The bound holds as an upper limit on every real agent-run (one note per iteration).
    for (const r of rows) expect(r.toolNotes, `${r.dir}/${r.agent}`).toBeLessThanOrEqual(r.bound);
    // Turns are searched+fetched notes; plans and cached reads are free of budget.
    for (const r of rows) expect(r.toolNotes - r.plans - r.cached, `${r.dir}/${r.agent} turns`).toBe(r.turns);

    const atBound = rows.filter((r) => r.atBound);
    expect(atBound.map((r) => `${r.agent}:${r.toolNotes}/${r.turns}t`).sort()).toEqual(
      ['deal-scout:54/24t', 'deep-dive-refiner:26/0t', 'risk-analyst:16/0t'].sort(),
    );
    // The two zero-turn loops: with `forceTools: turnsUsed === 0` (Gemini mode ANY)
    // a loop that never spends a turn CANNOT return "no tools" — the iteration
    // bound is its ONLY exit. 22 plans + 4 cached reads, then 18 plans in a row.
    const refiner = rows.find((r) => r.agent === 'deep-dive-refiner' && r.atBound)!;
    expect([refiner.plans, refiner.cached, refiner.turns]).toEqual([22, 4, 0]);
    // What it cost: the agent's whole bill (loop + pro write) — the loop bought nothing.
    expect(refiner.usd).toBeGreaterThan(0.3);
    // The honest deal-scout at 54/54 with 24/24 spent: today's `gather` classes that `stalled`.
    const scout = rows.find((r) => r.agent === 'deal-scout' && r.atBound)!;
    expect(scout.turns).toBe(scout.budget);
  });

  it('one tool call per model turn, always: 292 real tool calls, no two notes closer than 1 s, while the loop-exit "Writing" note follows the last one within 5 ms', () => {
    let minGap = Infinity;
    let total = 0;
    let exitGapMax = 0;
    for (const { trace } of loadTraces()) {
      for (const a of trace.agents) {
        const all = a.notes ?? [];
        const notes = all.filter(isTool);
        total += notes.length;
        for (let i = 1; i < notes.length; i++) minGap = Math.min(minGap, tsOf(notes[i]!) - tsOf(notes[i - 1]!));
        // Only where the loop exited by the BOUND (no final model call in between):
        // the emit overhead is then the whole gap between the last tool note and "Writing".
        const bound = budgetOf(a.id) * 2 + 6;
        const last = notes.at(-1);
        const writing = all.find((n) => /Writing \(/.test(n));
        if (last && writing && notes.length === bound) exitGapMax = Math.max(exitGapMax, tsOf(writing) - tsOf(last));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`real tool calls: ${total}; min gap between two tool notes: ${minGap} ms; max gap last-tool-note → "Writing": ${exitGapMax} ms`);
    expect(total).toBeGreaterThan(250);
    // A batched response would put two notes ms apart (emit is ~1 ms — the exit
    // note proves it). Every gap is a full model round-trip: one call per turn.
    expect(exitGapMax).toBeLessThanOrEqual(5);
    expect(minGap).toBeGreaterThan(1000);
  });

  it('the honest maximum: 2 consecutive plans (every non-pathological agent), but 5 consecutive FREE calls in the honest deep-dive-refiner (P c P c P, then its one paid fetch) — a ≥4 free-call breaker cuts a real honest agent before its only paid turn', () => {
    const rows: Array<{ dir: string; agent: string; seq: string; maxPlans: number; maxFree: number; turns: number }> = [];
    for (const { dir, trace } of loadTraces()) {
      for (const a of trace.agents) {
        const seq = (a.notes ?? []).filter(isTool).map(kindOf).join('');
        if (!seq) continue;
        let mp = 0, cp = 0, mf = 0, cf = 0;
        for (const ch of seq) {
          cp = ch === 'P' ? cp + 1 : 0; mp = Math.max(mp, cp);
          cf = ch === 'P' || ch === 'c' ? cf + 1 : 0; mf = Math.max(mf, cf);
        }
        rows.push({ dir, agent: a.id, seq, maxPlans: mp, maxFree: mf, turns: a.turnsUsed ?? 0 });
      }
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    const pathological = rows.filter((r) => r.turns === 0);
    const honest = rows.filter((r) => r.turns > 0);
    expect(pathological.map((r) => r.agent).sort()).toEqual(['deep-dive-refiner', 'risk-analyst']);
    expect(pathological.every((r) => r.maxPlans >= 16)).toBe(true);
    // No honest agent ever emitted 3 plans in a row: a consecutive-PLAN breaker at
    // 3 or 4 costs no real honest agent and ends both plan-loops at call 3-4.
    expect(Math.max(...honest.map((r) => r.maxPlans))).toBe(2);
    // But the honest refiner (1 paid turn) re-read the shortlist first: P c P c P F P.
    const honestRefiner = honest.find((r) => r.agent === 'deep-dive-refiner')!;
    expect(honestRefiner.seq).toBe('PcPcPFP');
    expect(honestRefiner.maxFree).toBe(5);
    // B-legit's "honest peaks at 3" is its own personas; the real honest peak is 5.
    expect(Math.max(...honest.map((r) => r.maxFree))).toBe(5);
  });
});

// ============================================================================
// 2 · Replay the real deal-scout sequence through today's gather
// ============================================================================

const LOTS: Page[] = Array.from({ length: 30 }, (_, i) => ({
  url: `https://example-marketplace.test/listing/refute-lot-${i + 1}`,
  title: `Lot ${i + 1} laundromat for sale, Miami-Dade FL`,
  snippet: `Coin laundry lot ${i + 1}.`,
  content: `Lot ${i + 1} coin laundry, Miami-Dade. Asking price $${300 + i * 5},000.`,
  tags: ['laundromat', 'for sale', 'listing', `refq${i + 1}z`],
}));

/** Emits the given P/S/F/c sequence, one call per response, then "Ready to write." */
class Replay extends MockLlmProvider {
  private i = 0;
  private fetched: string[] = [];
  /** What the LOOP handed back for each `update_plan` — the plan breaker's other half. */
  readonly planResponses: Array<Record<string, unknown>> = [];
  constructor(private readonly seq: string, private readonly cachedUrl = LOTS[0]!.url) { super(); }
  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.calls += 1;
    const usage = { inputTokens: 100, outputTokens: 30 };
    if (!opts.tools?.length) return super.generate(opts);
    for (const m of opts.messages) {
      if (m.role !== 'tool' || m.toolResult?.name !== 'update_plan') continue;
      const r = m.toolResult.response as Record<string, unknown>;
      if (!this.planResponses.includes(r)) this.planResponses.push(r);
    }
    const ch = this.seq[this.i++];
    if (!ch) return { text: 'Ready to write.', toolCalls: [], usage };
    let call: ToolCall;
    if (ch === 'P') call = { id: `p${this.i}`, name: 'update_plan', args: { steps: [{ task: `step ${this.i}`, status: 'doing' }] } };
    else if (ch === 'S') call = { id: `s${this.i}`, name: 'web_search', args: { query: `laundromat for sale Miami refq${this.i}z` } };
    else if (ch === 'F') {
      const url = LOTS[(this.fetched.length + 1) % LOTS.length]!.url; // never LOTS[0], the seeded cached page
      this.fetched.push(url);
      call = { id: `f${this.i}`, name: 'fetch_page', args: { url } };
    } else call = { id: `c${this.i}`, name: 'fetch_page', args: { url: this.fetched.length ? this.fetched[this.i % this.fetched.length]! : this.cachedUrl } };
    return { text: '', toolCalls: [call], usage };
  }
}

async function replay(seq: string, maxTurns: number): Promise<GatherResult & { iterations: number }> {
  const p = new Replay(seq);
  __setProviderForTests('gemini-vertex', p);
  __setProviderForTests('ollama', p);
  const res = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns, evidence: createEvidence() });
  return { ...res, iterations: p.calls };
}

describe('refute B2 · today’s gather on the real sequences', () => {
  it('the real deal-scout (24 P + 24 paid + 6 cached = 54 = its bound) ends `budget` at 24/24 — spent allowance, reusable (before the fix: `stalled`, and a flaky write re-bought it)', async () => {
    restore = __setExtraPages(LOTS);
    // The literal order from out/local-4837f6e3 (P plan, S search, F fetch, c cached re-read).
    const real = 'PSPFFFPSPFFFPccSPFPSPSPcPFPcPSPPSPcPSPSPSPPSPPcSPSSPSS';
    expect(real.length).toBe(54);
    const r = await replay(real, 24);
    // 52, not the full 54: the trace's last eight turns come AFTER the 24th paid
    // call, so every search in them is refused ("Budget reached") — eight turns in
    // a row that bought nothing, which the general breaker now ends (R7-3). Two
    // LLM calls of the real trace were pure loss. What this test is about is
    // unchanged: the allowance was spent, so the loop counts as finished.
    expect(r.iterations).toBe(52);
    expect(r.turns).toBe(24);
    // Mutation that reds this: drop `if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget'`
    // at the end of gather() → stop 'stalled', gatherCompleted false.
    expect(r.stop).toBe('budget');
    expect(gatherCompleted(r)).toBe(true);
  });

  it('the two real plan-loops end at the breaker, not at the bound: deep-dive-refiner (PcPcPcPc + 18 P, was 26/26 with 0 searches) and risk-analyst (16 P, was 16/16) — ended after 4 plan-only turns, `stalled`, and the trace says why', async () => {
    restore = __setExtraPages(LOTS);
    // The literal orders from out/local-aa4b3edf. Both loops sat at exactly 2·budget+6
    // iterations having searched nothing; under Gemini's mode ANY the model could not
    // answer without a tool call, so re-planning was the only move it had.
    for (const [seq, budget, name] of [['PcPcPcPc' + 'P'.repeat(18), 10, 'deep-dive-refiner'], ['P'.repeat(16), 5, 'risk-analyst']] as const) {
      const notes: string[] = [];
      const evidence = createEvidence();
      evidence.extractedUrls.add(LOTS[0]!.url);
      evidence.extracted.push({ url: LOTS[0]!.url, ok: true, content: LOTS[0]!.content });
      const p = new Replay(seq);
      __setProviderForTests('gemini-vertex', p);
      __setProviderForTests('ollama', p);
      const r = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: budget, evidence, onNote: (n) => { notes.push(n); } });
      const bound = 2 * budget + 6;
      // Mutation that reds this: raise PLAN_TURNS_LIMIT past the bound (or drop the break).
      expect(p.calls, `${name}: iterations`).toBeLessThan(bound);
      expect(p.calls, `${name}: iterations`).toBeLessThanOrEqual(seq.indexOf('PPPP') + 4);
      expect(r.turns).toBe(0);
      expect(r.stop).toBe('stalled');
      expect(notes.some((n) => /Stopping research: 4 plan updates in a row/.test(n)), `${name}: the stop is said`).toBe(true);
      expect(notes.at(-1)).toMatch(/^Research loop ended: stalled \(0\/\d+ turns\)/);
      expect(notes.filter((n) => n.startsWith('Plan updated')).length).toBeLessThanOrEqual(seq.indexOf('PPPP') + 4);
      // The nudge came first, ASSERTED. This comment used to sit over the note count
      // above it, which says nothing about what the model was handed: deleting the
      // whole `stopPlanning` block left the suite green (round 7, R7-31 / G1-verify
      // F5). What the loop TELLS the model is the half of the breaker that offers it
      // a way out; the other half (dropping `forceTools`) was already pinned.
      expect(p.planResponses.some((r) => r.stopPlanning === true), `${name}: the model was told to stop planning`).toBe(true);
      expect(String(p.planResponses.find((r) => r.stopPlanning)?.message)).toMatch(/web_search \/ fetch_page a NEW url now/);
      expect(p.planResponses[0]?.stopPlanning, 'not on the first plan of the run').toBeUndefined();
    }
  });

  it('one free cached re-read per turn no longer walks around the breaker: `(Pc)*` ends at 12 iterations, not the 54 bound — and the honest `P c P c P F` refiner is untouched (R7-3)', async () => {
    restore = __setExtraPages(LOTS);
    // The dodge, measured in round 7 (G1-break F2): the plan breaker only looked at
    // turns that were ONLY `update_plan`, so appending one free call per turn made
    // it blind. `[update_plan, fetch_page(cached)]` on repeat cost 54 LLM calls and
    // 974,761 prompt chars for 0 turns and 0 evidence. Here the same shape is one
    // call per turn, alternating, which is the real pathological refiner's `(Pc)*`.
    const evidence = createEvidence();
    evidence.extractedUrls.add(LOTS[0]!.url);
    evidence.extracted.push({ url: LOTS[0]!.url, ok: true, content: LOTS[0]!.content });
    const notes: string[] = [];
    const p = new Replay('Pc'.repeat(27));
    __setProviderForTests('gemini-vertex', p);
    __setProviderForTests('ollama', p);
    const r = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: 24, evidence, onNote: (n) => { notes.push(n); } });

    // The first two re-reads return the page body (progress); from the third the
    // body is refused, and eight such turns in a row end the loop. Mutation that
    // reds this: `NO_PROGRESS_TURNS_LIMIT` past the bound, or `buysNothing()`
    // returning false for a stubbed cached read.
    expect(p.calls).toBe(12);
    expect(p.calls).toBeLessThan(2 * 24 + 6);
    expect(r.turns).toBe(0);
    expect(r.stop).toBe('stalled');
    expect(notes.some((n) => /Stopping research: 8 turns in a row with no new evidence/.test(n))).toBe(true);

    // The honest counter-example, from out/local-4837f6e3: a refiner that re-reads
    // pages the scout fetched and then pays for one of its own. A blanket
    // "no free calls in a row" breaker would cut this; a cached read that returns a
    // BODY is progress, so it runs to the end.
    const seeded = createEvidence();
    seeded.extractedUrls.add(LOTS[0]!.url);
    seeded.extracted.push({ url: LOTS[0]!.url, ok: true, content: LOTS[0]!.content });
    const h = new Replay('PcPcPFP');
    __setProviderForTests('gemini-vertex', h);
    __setProviderForTests('ollama', h);
    const honest = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: 24, evidence: seeded });
    expect(h.calls, 'every turn of the honest sequence ran, plus the one that says "ready"').toBe(8);
    expect(honest.turns, 'its one paid fetch').toBe(1);
    expect(honest.stop).toBe('done');
  });

  it('after three plan-only turns the next call is NOT forced to call a tool — under Gemini mode ANY that was the only way out of a plan-loop the loop itself offered none for', async () => {
    restore = __setExtraPages(LOTS);
    class Forced extends Replay {
      readonly forced: Array<boolean | undefined> = [];
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        if (opts.tools?.length) this.forced.push(opts.forceTools);
        return super.generate(opts);
      }
    }
    const p = new Forced('PPP');
    __setProviderForTests('gemini-vertex', p);
    __setProviderForTests('ollama', p);
    const r = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: 5, evidence: createEvidence() });
    // Calls 1-3 planned (forced: nothing bought yet); call 4 is free to answer in
    // prose, and the model says "Ready to write". Mutation that reds this: keep
    // `forceTools: turnsUsed === 0` without the plan-turn clause.
    expect(p.forced.slice(0, 3)).toEqual([true, true, true]);
    expect(p.forced[3]).toBe(false);
    expect(r.turns).toBe(0);
    // …and a plan-only exit with nothing bought is not research done (turns 0).
    expect(gatherCompleted(r)).toBe(false);
  });

  it('only the LATEST plan travels in full: earlier update_plan calls keep their place in the conversation with their steps stubbed (Gemini needs the call/response pair; the model needs one plan)', async () => {
    restore = __setExtraPages(LOTS);
    class Watch extends Replay {
      fullPlansPerCall: number[] = [];
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        if (opts.tools?.length) {
          const plans = opts.messages.flatMap((m) => (m.role === 'model' ? m.toolCalls ?? [] : [])).filter((c) => c.name === 'update_plan');
          this.fullPlansPerCall.push(plans.filter((c) => Array.isArray((c.args as { steps?: unknown }).steps) && ((c.args as { steps: unknown[] }).steps.length > 0)).length);
          // Every plan call is still THERE — only its steps are replaced.
          expect(plans.every((c) => 'steps' in c.args)).toBe(true);
        }
        return super.generate(opts);
      }
    }
    const p = new Watch('PSPSPSPS');
    __setProviderForTests('gemini-vertex', p);
    __setProviderForTests('ollama', p);
    await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: 6, evidence: createEvidence() });
    // From the third call on there is more than one plan in the history and
    // exactly one still carries its steps. Mutation that reds this: drop
    // `trimOldPlans(messages)` before the call.
    expect(p.fullPlansPerCall.slice(2).every((n) => n === 1)).toBe(true);
    expect(p.fullPlansPerCall.length).toBeGreaterThan(4);
  });

  it('the honest refiner (P c P c P F P) ends `done` today with 1 turn — and would have been cut at call 4 by a ≥4 consecutive-FREE-call breaker; a consecutive-PLAN breaker leaves it alone (max 1 plan in a row)', async () => {
    restore = __setExtraPages(LOTS);
    // Seed the store as the deal-scout did: the shortlist pages are cached for the refiner.
    const evidence = createEvidence();
    evidence.extractedUrls.add(LOTS[0]!.url);
    evidence.extracted.push({ url: LOTS[0]!.url, ok: true, content: LOTS[0]!.content });
    const p = new Replay('PcPcPFP');
    __setProviderForTests('gemini-vertex', p);
    __setProviderForTests('ollama', p);
    const r = await gather({ model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }], maxTurns: 10, evidence });
    expect(r.turns).toBe(1);
    expect(r.stop).toBe('done');
    // The breaker arithmetic on this honest sequence:
    const seq = 'PcPcPFP';
    const freeRunBeforeFirstPaid = seq.indexOf('F');
    expect(freeRunBeforeFirstPaid).toBe(5); // ≥ 4 → the proposed breaker fires before the paid fetch
    expect(Math.max(...seq.split(/[^P]/).map((s) => s.length))).toBe(1); // a plan-only breaker never fires
  });
});

// ============================================================================
// 3 · "400 update_plan calls in ONE turn" vs gatherMaxOutputTokens
// ============================================================================

describe('refute B2 · what fits in one loop response', () => {
  it('at gatherMaxOutputTokens=4096, ~227 minimal update_plan calls fit at most (≈18 tokens each — the number this test PRINTS; its title used to say ~150/≈27); 400 in one turn is unreachable, and evicting the "Writing" note needs ≥299 notes from ONE agent', () => {
    expect(config.llm.gatherMaxOutputTokens).toBe(4096);
    // A minimal call as the model must emit it: name + args JSON. ~4 chars/token is
    // generous for JSON punctuation; the real ratio is nearer 3, i.e. MORE tokens.
    const minimal = 'update_plan' + JSON.stringify({ steps: [{ task: 'spam 1 (PZ-FLOOD)', status: 'pending' }] });
    const tokensPerCall = Math.ceil(minimal.length / 4);
    const maxCallsPerTurn = Math.floor(config.llm.gatherMaxOutputTokens / tokensPerCall);
    // eslint-disable-next-line no-console
    console.log(`minimal update_plan call: ${minimal.length} chars ≈ ${tokensPerCall} tokens → ≤ ${maxCallsPerTurn} calls per 4,096-token turn`);
    expect(maxCallsPerTurn).toBeLessThan(300); // cannot evict from a single turn
    expect(maxCallsPerTurn).toBeLessThan(400); // the F2 fixture's shape is unreachable in production
    // Sustained over a loop it IS reachable: the deal-scout's 54 iterations × 6 plans/turn = 324 > 299.
    const scoutBound = 24 * 2 + 6;
    expect(Math.ceil(299 / scoutBound)).toBe(6);
    // …but a budget-4 agent (the F2 fixture, bound 14) would need 22 plans per turn on every turn.
    expect(Math.ceil(299 / (4 * 2 + 6))).toBe(22);
  });
});
