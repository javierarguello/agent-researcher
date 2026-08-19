/**
 * What a retry buys again, and what it should not (C2).
 *
 * An agent has two halves: a budgeted research loop that buys searches and page
 * bodies, and one structured call that writes the sections. The retry loop wraps
 * BOTH — so a write that failed re-ran the whole loop, buying fresh searches and
 * fresh fetches for evidence that was already paid for and still sitting in the
 * shared store. Three in-run attempts × eight dispatches made that up to 24
 * research loops for one agent.
 *
 * The cost ceiling bounds the damage in dollars; it does nothing about the waste,
 * and every dollar spent re-buying is a dollar not spent finishing the report.
 *
 * These tests count CALLS, not dollars: the point is what was bought, and a rate
 * that changes must not quietly change the meaning of the assertion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { web } = vi.hoisted(() => ({
  web: { searches: 0, fetches: 0 },
}));

vi.mock('../src/tools/web-search.js', () => ({
  searchCostPerCall: () => 0.01,
  canExtractPages: () => true,
  searchWeb: async (query: string) => {
    web.searches += 1;
    return [{ title: `Result for ${query}`, url: `https://example.com/${web.searches}`, snippet: 'snippet' }];
  },
  extractPages: async (urls: string[]) => {
    web.fetches += urls.length;
    return urls.map((url) => ({ url, ok: true, content: 'Full page content.' }));
  },
}));

import { gatherCompleted } from '../src/engine/gather.js';
import { runResearch, type Checkpoint } from '../src/engine/research-engine.js';
import { compactModel } from './fixtures/compact-model.js';
import { installMockProvider, MockLlmProvider } from './mocks/llm.js';
import { config } from '../src/config.js';

const params = () => compactModel.paramsSchema.parse({}) as Record<string, unknown>;

/** The scout's sections, i.e. the structured write we can make fail. */
const WRITES_FINDINGS = (schema: unknown) => JSON.stringify(schema).includes('findings');

/**
 * A provider whose structured WRITE fails `times` calls.
 *
 * Note the unit: `synthesizeStructured` already repairs once on its own, so TWO
 * failed calls is what it takes to fail an attempt and reach the engine's retry —
 * the thing under test here.
 */
function failingWrites(times: number): MockLlmProvider {
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  let failed = 0;
  mock.generate = async (opts) => {
    if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && failed < times) {
      failed += 1;
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
  return mock;
}

beforeEach(() => {
  web.searches = 0;
  web.fetches = 0;
});

describe('a retry after a failed WRITE does not re-buy the research', () => {
  it('runs the research loop once, however many times the write fails', async () => {
    installMockProvider();
    const clean = await runResearch({ template: compactModel, params: params(), jobId: 'w1', generatedAt: 't' });
    const oneLoop = web.searches;
    expect(clean.trace.status).toBe('completed');
    expect(oneLoop).toBeGreaterThan(0);

    web.searches = 0;
    failingWrites(2);
    const retried = await runResearch({ template: compactModel, params: params(), jobId: 'w2', generatedAt: 't' });

    // The second attempt reuses the evidence the first one bought. Re-running the
    // loop would not recover anything — it would go and buy more of the same.
    expect(retried.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBe(oneLoop);
  });

  it('still finishes the report, using the evidence already bought', async () => {
    failingWrites(2);
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w3', generatedAt: 't' });

    expect(out.trace.status).toBe('completed');
    expect(out.meta.sections ?? []).toEqual([]);
    expect(out.sources.length).toBeGreaterThan(0);
  });

  it('says so in the trace, so the saving is visible', async () => {
    failingWrites(2);
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w4', generatedAt: 't' });
    const notes = out.trace.agents.find((a) => a.id === 'scout')!.notes.join(' ');
    expect(notes).toMatch(/reusing evidence already gathered/i);
  });
});

describe('but a retry after a failed SEARCH still researches', () => {
  it('re-runs the loop when the loop itself threw', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let blown = false;
    mock.generate = async (opts) => {
      // Throw from a tool-calling turn: that is the research loop failing, not the
      // write. Recovery has to still mean "go and research".
      if (opts.tools?.length && !blown) {
        blown = true;
        throw new Error('provider blew up mid-loop');
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w5', generatedAt: 't' });

    expect(out.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBeGreaterThan(0); // it did research, on the retry
    expect(out.trace.status).toBe('completed');
  });

  it('re-runs the loop when the last pass found nothing at all', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let researching = false; // becomes true once the first attempt has given up
    let writes = 0;

    mock.generate = async (opts) => {
      // Attempt 1's whole research loop answers with prose and no tool calls, so
      // `gather` ends having spent no turns and bought nothing at all.
      if (opts.tools?.length && !researching) {
        return { text: 'Nothing to look up.', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && writes < 2) {
        writes += 1;
        // Two failed writes end attempt 1 (synthesize repairs once on its own).
        if (writes === 2) researching = true;
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w6', generatedAt: 't' });

    // Reusing "nothing" would hand the write an empty dossier for good. An empty
    // pass is not evidence, so it does not count as research already done.
    expect(out.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(2);
    expect(web.searches).toBeGreaterThan(0);
  });
});

describe('a retry only reuses research that FINISHED', () => {
  it('re-researches when the last loop never actually concluded', async () => {
    // Javier, 2026-07-31: a retry takes what is FINISHED, never something half
    // done. An agent that was cut off with budget LEFT never decided it had
    // enough — treating that as "already researched" freezes a half-built dossier
    // in place for every later attempt.
    //
    // The shape here: one search, then plan updates forever. The plan breaker
    // ends that loop after four plan-only turns, `stalled`, with budget unspent.
    // (The cost ceiling is the other unfinished ending, and it is unreachable from
    // here by design: a ceiling stop ends the job rather than retrying into it.)
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let writes = 0;
    let searched = false;

    mock.generate = async (opts) => {
      if (opts.tools?.length) {
        if (!searched) {
          searched = true;
          return { text: '', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [{ id: 's', name: 'web_search', args: { query: 'once' } }] };
        }
        // …then never stops planning → cut off by the breaker, budget left.
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 'p', name: 'update_plan', args: { steps: [{ task: 'again', status: 'doing' }] } }],
        };
      }
      if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && writes < 2) {
        writes += 1;
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w9', generatedAt: 't' });

    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.attempts).toBe(2);
    const notes = scout.notes.join(' ');
    expect(notes).not.toMatch(/reusing evidence already gathered/i);
    // Two passes, so it genuinely went back out rather than reusing an unfinished one.
    expect(notes.match(/Researching/g)?.length).toBe(2);
    expect(scout.gatherStop).toBe('stalled');
  });

  it('reuses a loop that spent its whole allowance and then ran out of iterations — nothing was half done', async () => {
    // The real July deal-scout: 24 paid turns, 24 plan updates and 6 cached
    // re-reads = exactly 2·budget+6 iterations, never a spare one to say "ready".
    // Every turn it could buy, it bought; a re-run buys the same allowance again.
    // That loop used to be classed `stalled` — one flaky write re-bought the job's
    // most expensive research. Cut off with budget LEFT (the test above) is the
    // half-done case; cut off with the budget SPENT is finished.
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let writes = 0;

    mock.generate = async (opts) => {
      // Never stops asking for tools → spends the allowance, then hits the bound.
      if (opts.tools?.length) {
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 's', name: 'web_search', args: { query: 'again' } }],
        };
      }
      if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema) && writes < 2) {
        writes += 1;
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w9b', generatedAt: 't' });

    const scout = out.trace.agents.find((a) => a.id === 'scout')!;
    expect(scout.attempts).toBe(2);
    expect(scout.gatherStop).toBe('budget');
    const notes = scout.notes.join(' ');
    // Mutation that reds this: drop `if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget'`.
    expect(notes).toMatch(/reusing evidence already gathered/i);
    expect(notes.match(/Researching/g)?.length).toBe(1);
  });

  it('reports how the loop ended, so the caller can tell the two apart', async () => {
    // The distinction has to come from `gather`, not from guessing at the turn
    // count: a full allowance and a loop cut off at the same turn look identical
    // from outside.
    installMockProvider();
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w10', generatedAt: 't' });
    expect(out.trace.status).toBe('completed');
    expect(gatherCompleted({ turns: 3, stop: 'done' })).toBe(true);
    expect(gatherCompleted({ turns: 3, stop: 'budget' })).toBe(true);
    expect(gatherCompleted({ turns: 3, stop: 'ceiling' })).toBe(false);
    expect(gatherCompleted({ turns: 3, stop: 'stalled' })).toBe(false);
    expect(gatherCompleted({ turns: 0, stop: 'done' })).toBe(false);
  });
});

describe('a re-dispatch does not re-download pages this job already has', () => {
  it('carries fetched page bodies in the checkpoint', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let fetched = false;
    mock.generate = async (opts) => {
      // The shared mock only ever searches; make one turn fetch a page too.
      if (opts.tools?.length && !fetched) {
        fetched = true;
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 'f1', name: 'fetch_page', args: { url: 'https://example.com/page-1' } }],
        };
      }
      return base(opts);
    };

    const first = await runResearch({ template: compactModel, params: params(), jobId: 'w7', generatedAt: 't' });
    expect(web.fetches).toBe(1);
    expect(first.checkpoint.extracted?.length).toBe(1);

    // Resume with the same page requested again: the shared cache answers it.
    web.fetches = 0;
    const mock2 = installMockProvider();
    const base2 = mock2.generate.bind(mock2);
    let again = false;
    mock2.generate = async (opts) => {
      if (opts.tools?.length && !again) {
        again = true;
        return {
          text: '',
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [{ id: 'f1', name: 'fetch_page', args: { url: 'https://example.com/page-1' } }],
        };
      }
      return base2(opts);
    };

    // `gatheredAgentIds` cleared too: with it, the scout would not run a loop at
    // all (see "a re-dispatch does not re-buy a finished loop" below) and this
    // test would pass without the cache ever being asked.
    const resume: Checkpoint = { ...first.checkpoint, doneAgentIds: [], gatheredAgentIds: [], report: {} };
    await runResearch({ template: compactModel, params: params(), jobId: 'w7', generatedAt: 't', resume });

    // A page fetch is the most expensive call in the loop. Carrying only `sources`
    // meant every resumed dispatch bought all of them again.
    expect(web.fetches).toBe(0);
  });

  it('bounds what it carries, so the checkpoint cannot grow without limit', async () => {
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: 'c' }));
    const resume = { report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [] } as Checkpoint;
    installMockProvider();

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'w8', generatedAt: 't', resume });
    // It is written after every agent, so unbounded growth is a real cost of its own.
    expect(out.checkpoint.extracted!.length).toBeLessThanOrEqual(60);
  });
});

// --- Across dispatches (M-D1) ---------------------------------------------------
//
// The tests above are one dispatch. Production has eight, and until M-D1 each of
// them re-bought the loop: `research.done` was a per-dispatch local, so a write
// that failed on dispatch 1 was re-researched from scratch on dispatches 2..8 —
// the checkpoint carried the pages but not "this agent's loop finished". And a
// write that failed the SAME way each time was retried on all eight, because
// nothing told a deterministic failure from a transient one.

/** A provider whose scout WRITE answers `text` on every call (never repairs). */
function scoutWrites(text: string): MockLlmProvider {
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema)) {
      return { text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
  return mock;
}

/** A provider whose scout WRITE throws — a provider error, not a validation one. */
function scoutWriteThrows(): MockLlmProvider {
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (opts.responseSchema && WRITES_FINDINGS(opts.responseSchema)) throw new Error('503 UNAVAILABLE');
    return base(opts);
  };
  return mock;
}

/** One production-shaped dispatch: not the finalize pass (dispatches 1..7 are not). */
const dispatch = (jobId: string, resume?: Checkpoint) =>
  runResearch({ template: compactModel, params: params(), jobId, generatedAt: 't', finalize: false, ...(resume ? { resume } : {}) });

describe('a re-dispatch does not re-buy a finished loop', () => {
  it('carries "this agent’s loop finished" in the checkpoint and writes from that evidence on the next dispatch', async () => {
    scoutWrites('not json');
    const first = await dispatch('x1');
    expect(first.trace.status).toBe('incomplete');
    expect(first.trace.agents.find((a) => a.id === 'scout')!.status).toBe('failed');
    expect(web.searches).toBeGreaterThan(0);
    // The loop finished (`gatherCompleted`) even though the write did not — that
    // is what the checkpoint now says, next to the pages the loop bought.
    expect(first.checkpoint.gatheredAgentIds).toEqual(['scout']);

    web.searches = 0;
    scoutWrites('not json');
    const second = await dispatch('x1', first.checkpoint);
    const scout = second.trace.agents.find((a) => a.id === 'scout')!;
    // Not one search: the write reads what dispatch 1 bought. Mutation that reds
    // it: `research = { done: gathered.has(agent.id) }` → `{ done: false }` in
    // research-engine.ts (the loop runs again: searches > 0, "Researching" note).
    expect(web.searches).toBe(0);
    expect(scout.notes.join('\n')).toMatch(/Reusing evidence already gathered/);
    expect(scout.notes.join('\n')).not.toMatch(/Researching \(/);
    expect(scout.turnsUsed).toBe(first.trace.agents.find((a) => a.id === 'scout')!.turnsUsed); // the row keeps the loop it wrote from
  });

  it('a checkpoint from before the field existed resumes exactly as it did: the loop runs again (an addition is a migration)', async () => {
    scoutWrites('not json');
    const first = await dispatch('x2');
    // What a job held or re-dispatched across the deploy resumes from — no
    // `gatheredAgentIds`, no `writeFailures`. Written out as a literal so the
    // fixture cannot silently grow the fields.
    const old: Checkpoint = {
      report: first.checkpoint.report,
      sources: first.checkpoint.sources,
      extracted: first.checkpoint.extracted,
      doneAgentIds: first.checkpoint.doneAgentIds,
      handoffs: first.checkpoint.handoffs,
      degraded: first.checkpoint.degraded,
      agentTraces: first.checkpoint.agentTraces,
      cost: first.checkpoint.cost,
    };
    expect(old).not.toHaveProperty('gatheredAgentIds');
    expect(old).not.toHaveProperty('writeFailures');

    web.searches = 0;
    scoutWrites('not json');
    const second = await dispatch('x2', old);
    // Today's behaviour for yesterday's checkpoint: no claim about the loop, so the
    // loop is bought (a re-fetch is a cache miss, not a wrong answer)…
    expect(web.searches).toBeGreaterThan(0);
    expect(second.trace.agents.find((a) => a.id === 'scout')!.notes.join('\n')).toMatch(/Researching \(/);
    // …and no signature to compare against, so this dispatch is the FIRST time the
    // failure is seen: it is retried, not given up on.
    expect(second.trace.status).toBe('incomplete');
    expect(second.checkpoint.writeFailures?.scout?.dispatches).toBe(1);
    expect(second.checkpoint.gatheredAgentIds).toEqual(['scout']); // and it is carried from here on
  });
});

describe('a gathered agent keeps the evidence it paid for (R7-11)', () => {
  it('its own pages survive the checkpoint cap, and it is still trusted not to re-buy them', async () => {
    // The cap drops the OLDEST pages, which are the earliest agent's — and an agent
    // marked `gathered` never runs its loop again, so anything of its own that fell
    // out was gone for good: it wrote from pages it had never fetched, and could not
    // buy them back. `Checkpoint.extracted`'s doc called that "a cache miss, not a
    // correctness problem", which stopped being true when `gatheredAgentIds` landed.
    // Mutation that reds this: `extracted: evidence.extracted.slice(-CHECKPOINT_MAX_PAGES)`.
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'keep1', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        // The scout fetched the ten OLDEST pages and finished its loop.
        gatheredAgentIds: ['scout'],
        fetchedByAgent: { scout: pages.slice(0, 10).map((p) => p.url) },
      } as never,
    });

    const carried = out.checkpoint.extracted ?? [];
    expect(carried.length).toBeLessThanOrEqual(60);
    for (const p of pages.slice(0, 10)) {
      expect(carried.some((c) => c.url === p.url), `the scout's own ${p.url} was dropped`).toBe(true);
    }
    // …and it stays gathered, because nothing of its own was lost.
    expect(out.checkpoint.gatheredAgentIds).toContain('scout');
  });

  it('and when they cannot all be kept, it loses `gathered` instead of writing from evidence it never gathered', async () => {
    // Paying twice beats writing from someone else's research. Mutation that reds
    // this: keep `gatheredAgentIds: [...gathered]` unconditionally.
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'keep2', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'],
        fetchedByAgent: { scout: pages.map((p) => p.url) }, // all 80: more than the cap
      } as never,
    });
    expect(out.checkpoint.gatheredAgentIds ?? []).not.toContain('scout');
  });

  it('a RESUMED writer still ranks the pages it paid for first (R7-31 F9)', async () => {
    // The dossier's first tier is "pages this writer's own loop fetched", and
    // `research.fetched` was a per-dispatch local — so a re-dispatched writer's own
    // evidence ranked like everyone else's and it wrote from store order. The
    // checkpoint carries the URLs now. Mutation that reds this: seed `fetched` with
    // an empty set again.
    const pages = Array.from({ length: 20 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    const mine = pages[17]!; // late in the store, so store order would not surface it
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    const prompts: string[] = [];
    mock.generate = async (opts) => {
      if (opts.responseSchema) prompts.push(opts.messages.map((m) => m.text ?? '').join('\n'));
      return base(opts);
    };
    await runResearch({
      template: compactModel, params: params(), jobId: 'own1', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'], fetchedByAgent: { scout: [mine.url] },
      } as never,
    });
    const write = prompts.find((p) => p.includes('[P1] Full page content'))!;
    expect(write, 'the writer got a dossier').toBeTruthy();
    expect(write).toContain(`[P1] Full page content — ${mine.url}`);
  });

  it('a checkpoint from before the field resumes exactly as it did — newest pages, no preference', async () => {
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'keep3', generatedAt: 't',
      resume: { report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [] } as never,
    });
    const carried = out.checkpoint.extracted ?? [];
    expect(carried.length).toBeLessThanOrEqual(60);
    expect(carried.some((c) => c.url === 'https://x/0'), 'nothing owned it, so the oldest still go').toBe(false);
  });
});

describe('the dispatch that finishes early says what it is doing', () => {
  it('emits the ASSEMBLING phase, not planning — the phase is what the buyer’s client looks up', async () => {
    // Finalize-in-place emitted `phase: 'planning'` with `kind: 'assembling'`, and a
    // client renders the phase's manifest label in bold over the kind's line: the
    // buyer read "Planning" above "Assembling the report." (round 7, R7-19).
    // Mutation that reds this: `emit('planning', …)` again.
    scoutWrites('not json');
    const first = await dispatch('ph1');
    expect(first.trace.status, 'the premise: dispatch 1 asks to be resumed').toBe('incomplete');

    scoutWrites('still not json');
    const events: Array<{ phase: string; kind: string }> = [];
    await runResearch({
      template: compactModel, params: params(), jobId: 'ph1', generatedAt: 't', finalize: false,
      resume: first.checkpoint,
      onProgress: (p) => { events.push({ phase: p.phase, kind: p.kind }); },
    });
    const finalizing = events.find((e) => e.kind === 'assembling');
    expect(finalizing, 'the finalize-in-place line').toBeTruthy();
    expect(finalizing!.phase).toBe('assembling');
    expect(events.some((e) => e.phase === 'planning' && e.kind === 'assembling')).toBe(false);
  });
});

describe('a write that fails the same way on two dispatches is given up on', () => {
  it('the second identical failure ends the job: the section degrades, the warning names the repeated failure, no third dispatch is asked for', async () => {
    scoutWrites('not json');
    const first = await dispatch('s1');
    expect(first.trace.status).toBe('incomplete');
    expect(first.checkpoint.writeFailures).toEqual({ scout: { signature: 'json:Unexpected token', dispatches: 1 } });

    scoutWrites('still not json'); // a different excerpt, the same failure
    const second = await dispatch('s1', first.checkpoint);
    // In-dispatch attempts as ever (×2 in the test env, ×3 in production)…
    expect(second.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(config.workflow.agentMaxAttempts);
    // …but not a third dispatch: with the scout given up on and the advisor
    // waiting on it, nothing is retryable, so the engine finishes NOW — advisor
    // best-effort, findings lost — instead of returning `incomplete` six more
    // times. Mutation that reds it: `REPEATED_WRITE_FAILURE_DISPATCHES = 2` → 3.
    expect(second.trace.status).toBe('completed');
    expect(second.checkpoint.writeFailures?.scout).toEqual({ signature: 'json:Unexpected token', dispatches: 2 });
    expect(second.meta.sections).toEqual([{ key: 'findings', status: 'lost' }]);
    expect(second.trace.agents.find((a) => a.id === 'advisor')!.status).toBe('ok');
    expect(second.trace.warnings?.join('\n')).toMatch(
      /Degraded \[findings\] from agent "scout" after exhausting retries\/re-dispatches: the write failed the same way on 2 dispatches \[json:Unexpected token\]: .*Model did not return valid JSON/,
    );
    // And a dispatch that somehow resumes from here (an approval, say) does not run
    // the scout at all: no calls of its own, its row is the checkpoint's.
    const mock = scoutWrites('not json');
    const third = await dispatch('s1', second.checkpoint);
    expect(third.trace.status).toBe('completed');
    expect(third.trace.agents.find((a) => a.id === 'scout')!.notes).toEqual([]);
    expect(mock.calls).toBe(0);
  });

  it('a transient failure has no signature: it is retried on every dispatch, as before', async () => {
    scoutWriteThrows();
    const first = await dispatch('t1');
    expect(first.trace.status).toBe('incomplete');
    expect(first.trace.agents.find((a) => a.id === 'scout')!.error).toMatch(/503/);
    // Nothing to compare next time: a 5xx says nothing about what the model does
    // with this evidence. Mutation that reds it: the attempt loop's catch in
    // research-engine.ts recording every failure as `lastWriteFailure`, not only a
    // `StructuredOutputError` (the second dispatch would then finish, degraded).
    expect(first.checkpoint.writeFailures).toEqual({});

    scoutWriteThrows();
    const second = await dispatch('t1', first.checkpoint);
    expect(second.trace.status).toBe('incomplete'); // still worth a third dispatch
    expect(second.checkpoint.writeFailures).toEqual({});
    expect(second.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(config.workflow.agentMaxAttempts);
  });

  it('a DIFFERENT failure starts the count over: JSON on one dispatch, schema on the next, and the job is still retried', async () => {
    scoutWrites('not json');
    const first = await dispatch('d1');
    expect(first.checkpoint.writeFailures?.scout).toEqual({ signature: 'json:Unexpected token', dispatches: 1 });

    // Valid JSON, wrong shape: `findings` (and the handoff the producer schema asks
    // for) missing entirely.
    scoutWrites('{"nothing": true}');
    const second = await dispatch('d1', first.checkpoint);
    expect(second.trace.status).toBe('incomplete');
    expect(second.checkpoint.writeFailures?.scout).toEqual({ signature: 'schema:_handoff:invalid_type,findings:invalid_type', dispatches: 1 });

    // The same schema failure again → that is the second dispatch on THIS signature.
    scoutWrites('{"nothing": false}');
    const third = await dispatch('d1', second.checkpoint);
    expect(third.trace.status).toBe('completed');
    expect(third.checkpoint.writeFailures?.scout).toEqual({ signature: 'schema:_handoff:invalid_type,findings:invalid_type', dispatches: 2 });
    expect(third.meta.sections).toEqual([{ key: 'findings', status: 'lost' }]);
  });
});
