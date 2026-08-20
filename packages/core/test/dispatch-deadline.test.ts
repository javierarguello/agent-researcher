/**
 * A dispatch that runs out of wall clock stops cleanly and is RESUMED — it does not
 * leave the report half-written and unowned.
 *
 * C5: the worker had no clock at all. `runJob` ran to the end and Cloud Run killed
 * the request at its `--timeout`, mid-agent, and the in-flight agents' spend was
 * lost twice — never added to `trace.cost`, and re-run from zero next dispatch. The
 * deadline cannot be bought off with a bigger number: Cloud Tasks caps an HTTP
 * dispatch deadline at 30 minutes and Cloud Run's timeout is what kills the process.
 * The only way a job gets more than 30 minutes is by spanning dispatches, which the
 * checkpoint already supports — so the fix is to stop STARTING agents in time to
 * checkpoint and return.
 *
 * Time is stubbed rather than waited on: `Date.now` is a counter the provider mock
 * advances, so "an agent took ten minutes" is deterministic and the suite stays
 * fast. `new Date()` is untouched (V8 does not route it through `Date.now`), so the
 * trace timestamps below are real ones.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runJob } from '../src/engine/run-job.js';
import { createJob, getJob } from '../src/jobs/firestore.js';
import { installMockProvider } from './mocks/llm.js';
import { OBJECTS } from './mocks/storage.js';
import { compactModel, runModel } from './fixtures/compact-model.js';
import type { ResearchTemplate } from '../src/templates/types.js';
import { z } from 'zod';
import { __registerTemplateForTests, __clearTestTemplates } from '../src/templates/registry.js';
import { writableConfig } from './writable-config.js';

const APP = 'app1';
const USER = 'buyer@x.com';

const seed = (jobId: string) =>
  createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);

const input = (jobId: string, deadlineAt?: number) => ({
  jobId, appId: APP, userId: USER, template: compactModel.id, params: {},
  ...(deadlineAt != null ? { deadlineAt } : {}),
});

/** A virtual clock only work advances, so elapsed time is a function of the run. */
function stubClock(msPerCall: number) {
  // Seeded from the REAL clock, not a round constant: `trace.durationMs` is
  // `Date.now() - Date.parse(startedAt)` and `startedAt` comes from `new Date()`,
  // which V8 does not route through `Date.now`. A fixed 2023 seed made every
  // duration in the trace negative — an artifact of the test, in a field other
  // tests read.
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    now += msPerCall;
    return base(opts);
  };
  return { mock, at: () => now, start: now };
}

beforeEach(() => {
  __clearTestTemplates();
  __registerTemplateForTests(compactModel);
  installMockProvider();
  writableConfig.workflow.maxJobAttempts = 2;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A model whose FIRST wave is wider than `maxConcurrentAgents`.
 *
 * The two checks are in different places and the compact model cannot tell them
 * apart: it has one agent per wave, so the wave check alone stops everything and
 * deleting the per-agent one is 0 red — which is how these tests first shipped.
 * Three independent producers with a concurrency of 2 puts the line INSIDE a wave,
 * which is the only shape where the per-agent check is the one that fires.
 */
const wideModel: ResearchTemplate<Record<string, unknown>> = {
  ...compactModel,
  id: 'e2e-wide',
  sections: [
    ...compactModel.sections.filter((x) => x.key !== 'recommendation'),
    ...['second', 'third'].map((key) => ({
      key,
      title: key,
      guidance: 'One sentence.',
      schema: z.object({ note: z.string().describe('One sentence.') }),
    })),
  ],
  agents: [
    ...compactModel.agents.filter((a) => a.id !== 'advisor'),
    ...['second', 'third'].map((key) => ({
      id: `scout-${key}`,
      role: 'producer' as const,
      objective: 'Find something.',
      produces: [key],
      researchBudget: 1,
      model: 'flash',
      gatherModel: 'gather',
    })),
  ],
};

describe('where the line falls', () => {
  it('stops the agents of a wave the pool has not reached yet', async () => {
    // Three producers, concurrency 2, and a budget that only the first two fit
    // inside. The third must come back `pending` — not failed, not degraded — which
    // is what a re-dispatch picks up. Mutation that reds this: delete the check
    // inside the pool callback.
    __registerTemplateForTests(wideModel);
    writableConfig.llm.maxConcurrentAgents = 2;
    const clock = stubClock(60_000);
    const out = await runModel(wideModel, {}, 'wide1', { deadlineAt: clock.start + 150_000, finalize: false });

    expect(out.trace.status).toBe('incomplete');
    const pending = out.trace.agents.filter((a) => a.status === 'pending').map((a) => a.id);
    const ok = out.trace.agents.filter((a) => a.status === 'ok').map((a) => a.id);
    expect(ok.length, 'nothing ran at all — the budget was too small to tell anything').toBeGreaterThan(0);
    expect(pending.length, 'every agent of the wave ran: the in-wave check did not fire').toBeGreaterThan(0);
    expect(ok.length + pending.length).toBe(3);
  });

  it('does not announce a wave it will not run', async () => {
    // The wave-level check, and the reason it is BEFORE the `emit`: a dispatch out
    // of clock would otherwise tell the buyer "Wave 2/2: advisor" and then do
    // nothing for the rest of the dispatch. Mutation that reds this: delete the
    // check at the top of the wave loop (the in-wave one still stops the work, so
    // only the progress line can see the difference).
    __registerTemplateForTests(compactModel);
    const clock = stubClock(60_000);
    const steps: string[] = [];
    await runModel(compactModel, {}, 'wide2', {
      deadlineAt: clock.start + 90_000,
      finalize: false,
      onProgress: (p) => { steps.push(p.message); },
    });
    expect(steps.some((m) => m.startsWith('Wave 1/')), 'the fixture never got going').toBe(true);
    expect(steps.filter((m) => m.startsWith('Wave 2/')), 'announced a wave it never ran').toEqual([]);
  });

  it('runs the whole finalize pass, deadline or no deadline', async () => {
    // The last attempt must not be cut short: stopping there degrades sections for
    // a reason that is not a failure, and there is no later dispatch to pick them
    // up. Asserted on the SECTIONS, not on the status — a finalized dispatch says
    // `completed` either way, which is why the first version of this test was 0
    // red when the `!bestEffort` guard was removed.
    __registerTemplateForTests(compactModel);
    const clock = stubClock(60_000);
    const out = await runModel(compactModel, {}, 'wide3', { deadlineAt: clock.start - 1, finalize: true });

    expect(out.trace.status).toBe('completed');
    expect(out.trace.agents.map((a) => a.status)).toEqual(['ok', 'ok']);
    expect(out.meta.sections ?? [], 'the finalize pass degraded a section it had time to write').toEqual([]);
  });
});

describe('a dispatch that runs out of wall clock', () => {
  it('stops between agents, keeps what finished, and the next dispatch finishes the job', async () => {
    await seed('dl1');
    // One minute of virtual time per model call, and a budget that the FIRST agent
    // fits inside and the second does not.
    const clock = stubClock(60_000);
    const first = await runJob(input('dl1', clock.start + 90_000));

    // Not failed, not degraded, not delivered: incomplete, which is the status the
    // worker turns into a 503 and the queue re-dispatches.
    expect(first.status).toBe('incomplete');
    const held = await getJob('dl1');
    expect(held!.status, 'the job must not be delivered half-written').not.toBe('completed');

    // The work that finished is SAVED — this is the half that makes the stop worth
    // doing rather than just polite.
    // Restore FIRST: `vi.restoreAllMocks()` takes down every spy, including one
    // created just above it, and a spy that is restored before it is used records
    // nothing — the assertion below then reads `undefined` and says the checkpoint
    // was never read, which would be a false finding about the code.
    vi.restoreAllMocks(); // real clock, fresh provider: the second dispatch has time
    const engine = await import('../src/engine/research-engine.js');
    const spy = vi.spyOn(engine, 'runResearch');
    const secondMock = installMockProvider();
    const second = await runJob(input('dl1'));

    expect(second.status).toBe('completed');
    expect((await getJob('dl1'))!.status).toBe('completed');
    const resume = spy.mock.calls[0]?.[0]?.resume;
    expect(resume, 'the second dispatch never read the checkpoint').toBeDefined();
    expect(resume!.doneAgentIds, 'the agent that beat the deadline was not kept').toContain('scout');
    expect(resume!.doneAgentIds, 'an agent that never started was recorded as done').not.toContain('advisor');
    expect(secondMock.calls, 'the second dispatch re-bought the finished agent').toBeGreaterThan(0);
  });

  it('says so where an admin looks, and does not call it a failure', async () => {
    // "Three steps failed and will be retried" and "the dispatch ran out of clock
    // with three steps still to start" are different facts and only one of them is
    // a job to look at. `warnings` is admin-only and in English.
    await seed('dl2');
    const clock = stubClock(60_000);
    await runJob(input('dl2', clock.start + 90_000));

    // On the TRACE, not the job summary: `setJobSummary` runs once, at the end of a
    // COMPLETED job, so an incomplete dispatch has no summary to carry it. The trace
    // is written every dispatch and is what the admin job page reads.
    const key = [...OBJECTS.keys()].find((k) => k.includes('dl2') && k.includes('trace.json'));
    expect(key, 'the dispatch wrote no trace').toBeTruthy();
    const trace = JSON.parse(String(OBJECTS.get(key!))) as { status: string; warnings?: string[] };
    expect(trace.status).toBe('incomplete');
    expect((trace.warnings ?? []).join(' ')).toContain('wall-clock budget');
    expect((trace.warnings ?? []).join(' ')).toContain('resumes them from the checkpoint');
  });

  it('runs to the end when there is no deadline — the CLI and every prior dispatch', async () => {
    // The feature is opt-in from the caller. A missing `deadlineAt` must behave
    // exactly as it did before it existed, or every non-worker caller changes.
    await seed('dl3');
    stubClock(600_000); // ten virtual minutes per call: far past any budget
    const out = await runJob(input('dl3'));
    expect(out.status).toBe('completed');
  });

  it('ignores the deadline on the finalizing dispatch', async () => {
    // The last attempt is the one that must not be cut short: stopping there would
    // degrade sections for a reason that is not a failure, and there is no ninth
    // dispatch to pick them up.
    writableConfig.workflow.maxJobAttempts = 1; // this dispatch IS the finalize pass
    await seed('dl4');
    const clock = stubClock(60_000);
    const out = await runJob(input('dl4', clock.start - 1)); // already past it
    expect(out.status).toBe('completed');
  });
});
