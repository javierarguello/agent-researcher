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

describe('the job\'s turn count survives a resume (R8-16)', () => {
  const resumeWith = (extra: Record<string, unknown>) => ({
    template: compactModel, params: params(), jobId: 'turns', generatedAt: 't',
    resume: { report: {}, sources: [], extracted: [], doneAgentIds: [], degraded: [], ...extra } as never,
  });

  it('counts the turns it actually took, not the search calls it was billed for', async () => {
    // R7-13 seeded the counter from `cost.searchCalls` — the BILLED calls. A turn
    // that reached no backend (an empty url, a fetch with no search key, a provider
    // that failed before charging) was billed as 0 and forgotten on resume, so the
    // admin's per-agent rows still did not sum to the "Search turns" above them.
    // Mutation that reds this: seed from `cost.searchCalls` again.
    installMockProvider();
    const carried = await runResearch(resumeWith({
      turnsUsed: 9,
      cost: { usd: 0, llmUsd: 0, searchUsd: 0, inputTokens: 0, outputTokens: 0, searchCalls: 2 },
    }));
    installMockProvider();
    const billed = await runResearch(resumeWith({
      cost: { usd: 0, llmUsd: 0, searchUsd: 0, inputTokens: 0, outputTokens: 0, searchCalls: 2 },
    }));
    // Same dispatch, same work: the only difference is what each was seeded with.
    expect(carried.turnsUsed - billed.turnsUsed).toBe(7);
  });

  it('and a checkpoint written before the field existed still resumes from the billed count', async () => {
    // The migration half: `turnsUsed` is absent on every checkpoint in flight when
    // this ships, and the old approximation beats restarting the buyer's count at
    // zero. Mutation that reds this: drop the `?? input.resume?.cost?.searchCalls`.
    installMockProvider();
    const legacy = await runResearch(resumeWith({
      cost: { usd: 0, llmUsd: 0, searchUsd: 0, inputTokens: 0, outputTokens: 0, searchCalls: 5 },
    }));
    installMockProvider();
    const fresh = await runResearch(resumeWith({}));
    expect(legacy.turnsUsed - fresh.turnsUsed).toBe(5);
  });

  it('and the count it carries forward is the one the next dispatch resumes from', async () => {
    // Mutation that reds this: drop `turnsUsed: counter.turns` from `snapshot()`.
    installMockProvider();
    const out = await runResearch(resumeWith({ turnsUsed: 4 }));
    expect(out.checkpoint.turnsUsed).toBe(out.turnsUsed);
    expect(out.checkpoint.turnsUsed).toBeGreaterThanOrEqual(4);
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

  it('and when it fetched MORE than a checkpoint can carry, it keeps its own newest and no foreign page (R8-3)', async () => {
    // R7-11 made this case drop `gathered` — pay the loop twice rather than write
    // from someone else's research. That rule cost money for nothing: re-buying
    // cannot carry more than the cap either, so the agent paid a second loop to
    // arrive at the same 60 pages, and could be cut off and made to pay again on
    // every dispatch (round 8, R8-3). What the rule was protecting is enforced
    // directly instead — the pages it resumes from are its OWN, newest first, and
    // no foreign page displaces one. Mutation that reds this: drop the
    // `.slice(-CHECKPOINT_MAX_PAGES)` on the resumed `fetchedByAgent`.
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'keep2', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'],
        fetchedByAgent: { scout: pages.slice(0, 80).map((p) => p.url) }, // all 80: more than the cap
      } as never,
    });
    expect(out.checkpoint.gatheredAgentIds ?? [], 'settles instead of re-buying').toContain('scout');
    const carried = out.checkpoint.extracted ?? [];
    expect(carried.length).toBeLessThanOrEqual(60);
    // Its own newest 60 — pages 20..79 — and nothing else.
    expect(carried.map((p) => p.url)).toEqual(pages.slice(20).map((p) => p.url));
  });

  it('a RESUMED writer still ranks the pages it paid for first (R7-31 F9)', async () => {
    // The dossier's first tier is "pages this writer's own loop fetched", and
    // `research.fetched` was a per-dispatch local — so a re-dispatched writer's own
    // evidence ranked like everyone else's and it wrote from store order. The
    // checkpoint carries the URLs now.
    //
    // The two seeds are given DIFFERENT observable consequences on purpose. With
    // one fetched url and nothing else, "seed `fetched` with an empty set again"
    // measured 0 red (round 8, R8-28): `touched` is seeded from the same
    // `fetchedByAgent` map and its tier is taken immediately after, so the page was
    // `[P1]` either way. So: 15 urls this loop merely SAW, all late in the store,
    // and one of them it also fetched.
    //   - seed `fetched` empty → `[P1]` is the first touched page, not `mine`.
    //   - seed `touched` empty → the head of the store (`/0`) takes a slot the
    //     writer's own results should have.
    const pages = Array.from({ length: 20 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    const mine = pages[17]!; // late in the store, so store order would not surface it
    const seen = pages.slice(5).map((p) => p.url); // 15 > MAX_PAGES: the store head must not fit
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
        gatheredAgentIds: ['scout'], fetchedByAgent: { scout: [mine.url] }, touchedByAgent: { scout: seen },
      } as never,
    });
    const write = prompts.find((p) => p.includes('[P1] Full page content'))!;
    expect(write, 'the writer got a dossier').toBeTruthy();
    expect(write).toContain(`[P1] Full page content — ${mine.url}`);
    expect(write, 'the store head took a slot the loop’s own results had paid for').not.toContain('https://x/0');
  });

  it('records what a loop was SHOWN, not only what it fetched — the half a resume reads', async () => {
    // The write side of the same field. Seeding it in a test proves the read; this
    // proves there is anything to read. Mutation that reds this: stop recording
    // `research.touched`.
    installMockProvider();
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'seen2', generatedAt: 't', finalize: false });
    const seen = out.checkpoint.touchedByAgent?.scout ?? [];
    const fetched = out.checkpoint.fetchedByAgent?.scout ?? [];
    expect(seen.length, 'its search results').toBeGreaterThan(0);
    // Everything it fetched, it also saw — the sets nest, which is what makes
    // `touched` the second tier and `fetched` the first.
    for (const u of fetched) expect(seen).toContain(u);
  });

  it('a RESUMED writer keeps the SNIPPETS its loop was shown, not a diversity cut of the shared store (R7-12)', async () => {
    // Both preference sets were empty on a resume, so everything was the foreign
    // tier — where the per-host cap applies. On a July-shaped store (190 sources,
    // 90% one marketplace) a resumed deal-scout got 35 of its 48 snippet slots
    // instead of 43: eight listings displaced by diversity it never asked for, in
    // the writer whose job is a shortlist of listings. Mutation that reds this:
    // seed `touched` from `fetchedByAgent` alone.
    const market = Array.from({ length: 170 }, (_, i) => ({ url: `https://bizbuysell.test/l/${i}`, title: `Listing ${i}`, snippet: `S${i}` }));
    const others = ['blog.test', 'directory.test', 'news.test', 'forum.test'].flatMap((h, k) =>
      Array.from({ length: 5 }, (_, i) => ({ url: `https://${h}/p/${k}${i}`, title: `Other ${k}${i}`, snippet: 'x' })),
    );
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    const prompts: string[] = [];
    mock.generate = async (opts) => {
      if (opts.responseSchema) prompts.push(opts.messages.map((m) => m.text ?? '').join('\n'));
      return base(opts);
    };
    await runResearch({
      template: compactModel, params: params(), jobId: 'seen1', generatedAt: 't',
      resume: {
        report: {}, sources: [...market, ...others], extracted: [], doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'],
        // What its loop saw last dispatch: its own marketplace results.
        touchedByAgent: { scout: market.slice(0, 60).map((r) => r.url) },
      } as never,
    });
    const write = prompts.find((p) => p.includes('URL: '))!;
    const hosts = [...write.matchAll(/\n\s+URL: (\S+)/g)].map((m) => new URL(m[1]!).hostname);
    expect(hosts.length).toBe(48);
    expect(hosts.every((h) => h === 'bizbuysell.test'), 'its own results, not a diversity cut').toBe(true);
  });

  it('carries at most 60 pages when a gathered agent owns 60 of them (R8-2)', async () => {
    // `rest.slice(-Math.max(0, 60 - mine.length))` is `slice(-0)` once `mine` reaches
    // the cap — and `-0 === 0`, so `slice(-0)` returns the WHOLE array. The cap
    // turned itself off exactly when it was needed most, and the checkpoint is
    // re-uploaded after every agent. Both existing fixtures sit outside the branch:
    // one has 10 owned pages, the other 80 owned of 80 (so `rest` is empty).
    // Mutation that reds this: `rest.slice(-Math.max(0, CHECKPOINT_MAX_PAGES - mine.length))`.
    const pages = Array.from({ length: 100 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'cap60', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'], fetchedByAgent: { scout: pages.slice(0, 60).map((p) => p.url) },
      } as never,
    });
    expect((out.checkpoint.extracted ?? []).length).toBeLessThanOrEqual(60);
  });

  it('and when a gathered agent owns MORE than the cap, it keeps its own and drops the foreign (R8-2)', async () => {
    // The second half of the same line: with 70 owned of 100 the old code kept all 30
    // FOREIGN pages and dropped ten of the agent's own oldest — the exact inverse of
    // the rule this function exists to enforce.
    const pages = Array.from({ length: 100 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'cap70', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'], fetchedByAgent: { scout: pages.slice(0, 70).map((p) => p.url) },
      } as never,
    });
    const carried = out.checkpoint.extracted ?? [];
    expect(carried.length).toBeLessThanOrEqual(60);
    expect(carried.every((p) => Number(p.url.split('/').pop()) < 70), 'no foreign page beat an owned one').toBe(true);
  });

  it('a dispatch that spends NOTHING still leaves the gathered agent gathered (R8-3)', async () => {
    // The shape that made this permanent: the checkpoint is re-written after every
    // dispatch, including one that is held at the ceiling before any agent runs. An
    // agent with 61+ recorded urls could never satisfy `carry()`'s "all of its own
    // survived" test, so every one of those snapshots dropped it from
    // `gatheredAgentIds` and the next dispatch re-bought a loop it had already paid
    // for. Nothing here re-runs it, so only the resumed list being capped can save it.
    // A dispatch held at the ceiling calls no provider, and the recorded list is
    // still capped on the way out — the agent's own seeded urls go through the same
    // record path a finished loop does. Mutation that reds this: record `all`.
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    const mock = installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'held', generatedAt: 't', finalize: false,
      costCeilingUsd: 1,
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'],
        fetchedByAgent: { scout: pages.map((p) => p.url) },
        cost: { usd: 5, llmUsd: 5, searchUsd: 0, inputTokens: 0, outputTokens: 0, searchCalls: 0 },
      } as never,
    });
    expect(mock.calls, 'the premise: this dispatch ran nothing').toBe(0);
    expect(out.checkpoint.gatheredAgentIds ?? []).toContain('scout');
  });

  it('an agent already at the cap that fetches one more page keeps the NEWEST (R8-3)', async () => {
    // The other half: a loop cut off mid-way accumulates across dispatches, so the
    // recorded list crosses the cap while the agent is still running. Trimming only
    // what the checkpoint was loaded with would let this dispatch's own snapshot go
    // over again. Mutation that reds this: record `all` instead of
    // `all.slice(-CHECKPOINT_MAX_PAGES)`.
    const fresh = 'https://example-marketplace.test/listing/sunshine-coin-laundry';
    const old = Array.from({ length: 60 }, (_, i) => `https://x/${i}`);
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      if (opts.tools?.length) {
        const toolMsgs = opts.messages.filter((m) => m.role === 'tool').length;
        if (toolMsgs === 0) return { text: '', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [{ id: 'f1', name: 'fetch_page', args: { url: fresh } }] };
        return { text: 'Ready to write.', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'atcap', generatedAt: 't', finalize: false,
      resume: {
        report: {}, sources: [], extracted: [], doneAgentIds: [], degraded: [],
        fetchedByAgent: { scout: old },
      } as never,
    });
    const recorded = out.checkpoint.fetchedByAgent?.scout ?? [];
    expect(recorded, 'the premise: it fetched the new page').toContain(fresh);
    expect(recorded.length).toBeLessThanOrEqual(60);
    expect(recorded).not.toContain('https://x/0'); // the oldest went, not the newest
    // And an admin can see that it happened: a section written from 60 of an agent's
    // 61 pages is a fine outcome, but a silent one is how "it read everything" gets
    // believed. Mutation that reds this: drop the `warnings.push`.
    expect((out.checkpoint.warnings ?? []).join('\n')).toMatch(/scout: fetched 61 pages, more than the 60/);
  });

  it('a gathered agent that recorded more URLs than the cap re-buys its loop ONCE, not on every dispatch (R8-3)', async () => {
    // `gatheredIds` kept an agent only if EVERY url in `fetchedByAgent` survived the
    // 60-page cap, and nothing trimmed that list — so an agent with 61+ recorded URLs
    // could never satisfy it and re-bought its whole loop on all eight dispatches.
    // M-D1, re-opened. Mutation that reds this: drop the `.slice(-CHECKPOINT_MAX_PAGES)`
    // when recording, or compare against the untrimmed list.
    const pages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const first = await runResearch({
      template: compactModel, params: params(), jobId: 'regath', generatedAt: 't', finalize: false,
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'], fetchedByAgent: { scout: pages.map((p) => p.url) },
      } as never,
    });
    // It gave up `gathered` once — its evidence did not fit — but what it carries
    // forward is now consistent with the cap, so the next dispatch can settle.
    expect((first.checkpoint.fetchedByAgent?.scout ?? []).length).toBeLessThanOrEqual(60);
    installMockProvider();
    const second = await runResearch({
      template: compactModel, params: params(), jobId: 'regath', generatedAt: 't', finalize: false,
      resume: { ...first.checkpoint, doneAgentIds: [] } as never,
    });
    expect(second.checkpoint.gatheredAgentIds, 'settles instead of re-buying forever').toContain('scout');
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
    expect(first.checkpoint.writeFailures).toEqual({ scout: { signature: 'json:parse', dispatches: 1 } });

    scoutWrites('still not json'); // a different excerpt, the same failure
    const second = await dispatch('s1', first.checkpoint);
    // In-dispatch attempts as ever (×2 in the test env, ×3 in production)…
    expect(second.trace.agents.find((a) => a.id === 'scout')!.attempts).toBe(config.workflow.agentMaxAttempts);
    // …but not a third dispatch: with the scout given up on and the advisor
    // waiting on it, nothing is retryable, so the engine finishes NOW — advisor
    // best-effort, findings lost — instead of returning `incomplete` six more
    // times. Mutation that reds it: `REPEATED_WRITE_FAILURE_DISPATCHES = 2` → 3.
    expect(second.trace.status).toBe('completed');
    expect(second.checkpoint.writeFailures?.scout).toEqual({ signature: 'json:parse', dispatches: 2 });
    expect(second.meta.sections).toEqual([{ key: 'findings', status: 'lost' }]);
    expect(second.trace.agents.find((a) => a.id === 'advisor')!.status).toBe('ok');
    expect(second.trace.warnings?.join('\n')).toMatch(
      /Degraded \[findings\] from agent "scout" after exhausting retries\/re-dispatches: the write failed the same way on 2 dispatches \[json:parse\]: .*Model did not return valid JSON/,
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
    expect(first.checkpoint.writeFailures?.scout).toEqual({ signature: 'json:parse', dispatches: 1 });

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
