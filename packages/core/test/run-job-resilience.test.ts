/**
 * What a dispatch does when the infrastructure around it misbehaves (H3-H5).
 *
 * The common shape: an error that has nothing to do with the research decided the
 * job's fate. A retired template or a blip on `markRunning` stranded the job with
 * the buyer's slot held; a failed dashboard write parked a healthy job or forced a
 * retry to re-buy the entire research loop; and the bookkeeping ran before the
 * delivery was accepted, so a refused delivery still counted a completed report and
 * deleted the only copy of the work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runJob } from '../src/engine/run-job.js';
import { createJob, getJob, markFailed, setJobAttempts, setJobCost, setProgress } from '../src/jobs/firestore.js';
import { installMockProvider } from './mocks/llm.js';
import { config } from '../src/config.js';
import { writableConfig } from './writable-config.js';
import { OBJECTS } from './mocks/storage.js';
import { compactModel } from './fixtures/compact-model.js';
import { __registerTemplateForTests, __clearTestTemplates } from '../src/templates/registry.js';

const APP = 'app1';
const USER = 'buyer@x.com';

const input = (jobId: string, template = compactModel.id) => ({
  jobId, appId: APP, userId: USER, template, params: {}, creditsSpent: 1,
});

async function seed(jobId: string): Promise<void> {
  await createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);
}

beforeEach(() => {
  __clearTestTemplates();
  __registerTemplateForTests(compactModel);
  installMockProvider();
});

// Every case here spies on a module the OTHER cases depend on — `markCompleted`
// resolving the job, `setJobCost` rejecting. Restoring at the end of the test body
// means one real failure skips its own restore and cascades into four unrelated
// red tests, which buries the regression that actually happened. Unwinding here
// runs whether the assertions passed or threw.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a job is never left without an outcome', () => {
  it('parks itself when the template it was queued for is gone', async () => {
    // A deploy retires a template while jobs are queued for it. This threw before
    // the guard that parks the job, so the worker acked a 200 while the document
    // still read `queued` — and nothing ever touched it again.
    await seed('h3a');
    await expect(runJob(input('h3a', 'a-template-we-retired'))).rejects.toThrow(/unknown template/i);

    const job = (await getJob('h3a'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.reason).toBe('run_failed');
  });

  it('parks itself when the bookkeeping write fails', async () => {
    // The transient case, and the common one: Firestore blips on `markRunning` or
    // `setJobAttempts`, both of which ran outside the guard.
    await seed('h3b');
    const jobs = await import('../src/jobs/firestore.js');
    const spy = vi.spyOn(jobs, 'setJobAttempts').mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(runJob(input('h3b'))).rejects.toThrow(/firestore unavailable/i);
    expect((await getJob('h3b'))!.status).toBe('held');
  });
});

describe('a job that parks itself hands its slot back', () => {
  it('releases the slot when the prologue throws', async () => {
    // Untested until now, and it is what stops the buyer being stuck: `markHeld`
    // succeeded, so the worker acks 200 and nothing ever retries — if the release
    // did not happen here it never happens at all.
    await seed('h7a');
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('h7a', true);

    await expect(runJob(input('h7a', 'a-template-we-retired'))).rejects.toThrow();

    expect((await getJob('h7a'))!.status).toBe('held');
    expect(await slots.inFlightSlots(APP, USER)).toBe(0);
  });
});

describe('a dashboard write does not decide the job', () => {
  it('finishes a healthy job when the cost write fails', async () => {
    // `onTrace` is awaited at every wave boundary, so one failed write threw out of
    // the engine and parked a job that was running perfectly well.
    await seed('h4a');
    const jobs = await import('../src/jobs/firestore.js');
    const spy = vi.spyOn(jobs, 'setJobCost').mockRejectedValue(new Error('firestore unavailable'));

    const res = await runJob(input('h4a'));
    expect(res.status).toBe('completed');
    expect((await getJob('h4a'))!.status).toBe('completed');
  });

  it('finishes a healthy job when the progress write fails', async () => {
    // Worse than parking: a rejection here surfaced inside the research loop and
    // failed the attempt as `stalled`, which makes the retry re-buy every search.
    await seed('h4b');
    const jobs = await import('../src/jobs/firestore.js');
    const spy = vi.spyOn(jobs, 'setProgress').mockRejectedValue(new Error('firestore unavailable'));

    const res = await runJob(input('h4b'));
    expect(res.status).toBe('completed');
  });
});

describe('nothing is booked until the delivery is accepted', () => {
  it('books no completed report when the delivery is refused', async () => {
    // The enqueue-failure cleanup resolves the job mid-run; `markCompleted` then
    // refuses. The stats used to be written before that check, so this job was
    // counted as a completed report — and counted AGAIN as a failure by whoever
    // resolved it.
    await seed('h5a');
    const stats = await import('../src/stats/store.js');
    const booked = vi.spyOn(stats, 'recordReportStats').mockResolvedValue(undefined as never);

    const jobs = await import('../src/jobs/firestore.js');
    const original = jobs.markCompleted;
    const spy = vi.spyOn(jobs, 'markCompleted').mockImplementation(async (id, files) => {
      await markFailed(id, 'resolved by an admin while it ran');
      return original(id, files);
    });

    const res = await runJob(input('h5a'));
    expect(res.status).toBe('failed');
    expect(booked).not.toHaveBeenCalled();
  });

  it('keeps the checkpoint when the delivery is refused', async () => {
    // The other half of the same reorder, and the half nobody asserted: moving the
    // delete back above the check survived the whole core suite. The checkpoint is
    // the only copy of work an admin could resurrect, and a refused delivery is
    // exactly when they would want to.
    await seed('h5b');
    const jobs = await import('../src/jobs/firestore.js');
    const original = jobs.markCompleted;
    const spy = vi.spyOn(jobs, 'markCompleted').mockImplementation(async (id, files) => {
      await markFailed(id, 'resolved by an admin while it ran');
      return original(id, files);
    });

    await runJob(input('h5b'));
    expect([...OBJECTS.keys()].some((k) => k.includes('h5b') && k.includes('checkpoint'))).toBe(true);
  });
});

describe('a duplicate dispatch cannot overwrite the run that owns the job', () => {
  /** Run a job and hand back the checkpoint saver the engine was given. */
  async function saverFor(jobId: string) {
    await seed(jobId);
    const engine = await import('../src/engine/research-engine.js');
    const spy = vi.spyOn(engine, 'runResearch');
    await runJob(input(jobId));
    const onCheckpoint = spy.mock.calls[0]?.[0]?.onCheckpoint;
    // No inline restore. There was one, justified by "the saver is then driven
    // against a live engine" — which is false: the saver is run-job's `onCheckpoint`
    // closure and it calls `isCurrentDispatch` and `uploadJson`, never `runResearch`.
    // Measured at zero calls, and removing the restore leaves the file green. The
    // `afterEach` handles it like every other spy here.
    expect(onCheckpoint).toBeTypeOf('function');
    return onCheckpoint!;
  }

  const CP = { report: {}, sources: [], extracted: [], doneAgentIds: ['x'], cost: undefined } as never;
  const savedFor = (jobId: string) => [...OBJECTS.keys()].filter((k) => k.includes(jobId) && k.includes('checkpoint'));

  it('does not save once another dispatch has claimed the job', async () => {
    // Cloud Tasks is at-least-once, and `running` is deliberately not in the
    // worker's skip list because resume depends on it. So a duplicate delivery can
    // start a second engine on the same checkpoint, and last-writer-wins throws
    // away whichever agents the other one had already finished.
    //
    // Driven at the saver itself: the compact fixture finishes in a single wave, so
    // a whole run never reaches a second save and "nothing was written" would be
    // true no matter what this guard did.
    const save = await saverFor('h6a');
    const jobs = await import('../src/jobs/firestore.js');
    // Back to live first: `markRunning` refuses a finished job now, because a
    // duplicate delivery slipping past the worker's status read used to resurrect
    // `completed` into `running` and re-run the whole research from zero.
    await seed('h6a');
    await jobs.markRunning('h6a', 'some-other-dispatch');

    await save(CP);
    expect(savedFor('h6a')).toHaveLength(0);
  });

  it('saves normally while the job is still ours', async () => {
    // The control: without it, a saver that never saved anything would pass above.
    const save = await saverFor('h6b');
    await save(CP);
    expect(savedFor('h6b').length).toBeGreaterThan(0);
  });
});

describe('a stale dispatch delivers nothing and overwrites nothing', () => {
  // The dispatch token guarded the checkpoint and the terminal writes, and nothing
  // else. `markCompleted` refuses a stale run — but the artifacts are uploaded and
  // the checkpoint deleted BEFORE that call, so the refusal came too late: a stale
  // run overwrote `report.json` with its older report and then deleted the
  // checkpoint the live run was resuming from.
  const seedJob = (jobId: string) =>
    createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);

  it('does not overwrite the delivered report, and leaves the checkpoint alone', async () => {
    await seedJob('st1');
    const jobs = await import('../src/jobs/firestore.js');
    const spy = vi.spyOn(jobs, 'markCompleted');

    // Claimed by someone else MID-RUN. Doing it before `runJob` proves nothing:
    // the prologue calls `markRunning` and takes the job for itself, so this run
    // would own it again — which is exactly how a duplicate delivery starts.
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let claimed = false;
    mock.generate = async (opts) => {
      if (!claimed) {
        claimed = true;
        await jobs.markRunning('st1', 'a-different-dispatch');
      }
      return base(opts);
    };

    const res = await runJob(input('st1'));

    // `superseded`, not `incomplete`: the worker ACKs this one. A 503 would retry
    // the stale task, which would then take the job back from the run that owns
    // it — and every cycle of that pays for another research pass.
    expect(res.status, 'a stale run must not report a delivery').toBe('superseded');
    expect(res.files).toEqual([]);
    expect([...OBJECTS.keys()].some((k) => k.includes('st1') && k.includes('report.json'))).toBe(false);
    expect(spy, 'it should never have got as far as the terminal write').not.toHaveBeenCalled();
    // …and the DASHBOARD is untouched too. The trace and the cost are what an
    // admin reads to decide about a job; a stale run used to overwrite both with
    // its own older numbers while the live one was still going.
    const staleTrace = [...OBJECTS.keys()].filter((k) => k.includes('st1') && k.includes('trace.json'));
    expect(staleTrace, 'a superseded run rewrote the job’s history').toEqual([]);
  });

  it('still delivers when the job is ours', async () => {
    // The control: "delivers nothing, ever" would pass the assertions above.
    await seedJob('st2');
    const res = await runJob(input('st2'));
    expect(res.status).toBe('completed');
    expect([...OBJECTS.keys()].some((k) => k.includes('st2') && k.includes('report.json'))).toBe(true);
  });
});

describe('what the admin dashboard is told about a partial delivery', () => {
  /** A producer, and a refiner that only deepens the producer's section. */
  const enrichModel = {
    id: 'stats-enrich', name: 'Enrich', description: 'x', version: 1,
    basePrompt: 'Be useful.',
    paramsSchema: z.object({}),
    sections: [{ key: 'base', title: 'Base', guidance: 'Write it.', schema: z.object({ text: z.string() }) }],
    agents: [
      { id: 'producer', role: 'producer', objective: 'Produce.', produces: ['base'], researchBudget: 1 },
      { id: 'refiner', role: 'producer', objective: 'Refine.', enriches: ['base'], dependsOn: ['producer'], researchBudget: 1 },
    ],
    buildBrief: () => 'Find things.',
  } as never;

  /** Fail only the enrichment pass, by the prompt that is unique to it. */
  function failEnrichment(): void {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      const text = opts.messages.map((m) => m.text ?? '').join('\n');
      if (opts.responseSchema && text.includes('Improve and enrich the sections below')) {
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };
  }

  /** Seeded on its LAST attempt, so this dispatch finalizes instead of resuming. */
  const seedFinal = async (jobId: string): Promise<void> => {
    await createJob({ jobId, appId: APP, userId: USER, templateId: 'stats-enrich', params: {}, status: 'queued' } as never);
    await setJobAttempts(jobId, config.workflow.maxJobAttempts - 1);
  };

  it('does not count an unenriched-only report as a degraded delivery', async () => {
    // `degraded: !!output.meta.sections` was true for ANY status, so a report that
    // lost nothing and had one shallow refiner lit the admin's "Degraded / partial
    // delivery" KPI — the number someone acts on. The two statuses exist because
    // they are not the same event.
    __registerTemplateForTests(enrichModel);
    failEnrichment();
    await seedFinal('s1');
    const stats = await import('../src/stats/store.js');
    const booked = vi.spyOn(stats, 'recordReportStats').mockResolvedValue(undefined as never);

    const res = await runJob(input('s1', 'stats-enrich'));
    expect(res.status, 'the job itself still delivers').toBe('completed');
    // The precondition. Without an `unenriched` entry the assertion below is
    // about a report with nothing wrong with it, and proves nothing.
    const stored = JSON.parse(OBJECTS.get([...OBJECTS.keys()].find((k) => k.includes('s1') && k.endsWith('report.json'))!)!.toString()) as { meta: { sections?: Array<{ status: string }> } };
    expect(stored.meta.sections?.map((x) => x.status)).toEqual(['unenriched']);
    expect(booked.mock.calls[0]?.[0].degraded, 'nothing was lost').toBeFalsy();
  });

  it('carries what each agent’s loop did into the summary the admin page reads', async () => {
    // `JobSummary.agents` copied six fields, and neither `turnsUsed` nor
    // `gatherStop` was among them — so the admin table rendered an agent that made
    // 22 plan updates and ZERO searches exactly like one that did 21 real turns
    // (round 7, R7-30). The column that shows it is pinned in the admin suite; this
    // is the half that WRITES it, which nothing asserted.
    await seed('sum1');
    const res = await runJob(input('sum1'));
    expect(res.status).toBe('completed');

    const summary = (await getJob('sum1'))!.summary as { agents?: Array<Record<string, unknown>> };
    const scout = summary.agents?.find((a) => a.id === 'scout')!;
    // Mutation that reds this: drop the two spread fields in `run-job.ts`'s agents map.
    expect(scout.turnsUsed, 'the turns its loop paid for').toBeGreaterThan(0);
    expect(scout.gatherStop, 'how the loop ended').toBeTruthy();
    // A synthesizer never had a loop: absent, not zero — a `0 · —` row reads as a
    // failed agent to whoever is deciding about a refund.
    const advisor = summary.agents?.find((a) => a.id === 'advisor');
    if (advisor) expect(advisor.gatherStop).toBeUndefined();
    // …and WHAT each one is, so the row that shows no turns says why it shows none.
    // `AgentTrace.kind` was added for exactly that sentence and reached the trace
    // and no screen, because this map did not copy it either (round 8, R8-27).
    // Mutation that reds this: drop the `kind` spread in `run-job.ts`.
    expect(scout.kind).toBe('researcher');
    if (advisor) expect(advisor.kind, 'the agent with no loop is the one that needs saying').toBe('writer');
  });

  it('still counts one when a section really was lost', async () => {
    // The control. Without it the fix above also passes on a field wired to
    // `false`, which is the failure this whole backlog keeps finding.
    __registerTemplateForTests(enrichModel);
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) =>
      (opts.responseSchema ? { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } } : base(opts));
    await seedFinal('s2');
    const stats = await import('../src/stats/store.js');
    const booked = vi.spyOn(stats, 'recordReportStats').mockResolvedValue(undefined as never);

    const res = await runJob(input('s2', 'stats-enrich'));
    expect(res.status).toBe('completed');
    const stored = JSON.parse(OBJECTS.get([...OBJECTS.keys()].find((k) => k.includes('s2') && k.endsWith('report.json'))!)!.toString()) as { meta: { sections?: Array<{ status: string }> } };
    expect(stored.meta.sections?.map((x) => x.status)).toEqual(['lost']);
    expect(booked.mock.calls[0]?.[0].degraded).toBe(true);
  });
});

describe('a stale dispatch writes no outcome of any kind', () => {
  // The delivery path was guarded and the other three exits were not. Everything
  // here is about a run that has already lost the job to a newer dispatch and is
  // still holding the numbers an admin reads and the slot the buyer needs.
  const seedJob = (jobId: string) =>
    createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);

  /** Hand the job to another dispatch on the first model call. */
  function stolenMidRun(jobId: string, jobs: typeof import('../src/jobs/firestore.js')): void {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let claimed = false;
    mock.generate = async (opts) => {
      if (!claimed) {
        claimed = true;
        await jobs.markRunning(jobId, 'a-different-dispatch');
      }
      return base(opts);
    };
  }

  it('does not overwrite the cost the live run is reporting', async () => {
    // The LAST and authoritative write of the field the admin dashboard shows as
    // the job's cost. The per-wave writes were guarded; this one sat between the
    // engine returning and the delivery gate, so a stale run's older total landed
    // on top of the live run's every time.
    await seedJob('st3');
    const jobs = await import('../src/jobs/firestore.js');
    await setJobCost('st3', { usd: 9.99, llmUsd: 9.99, searchUsd: 0, inputTokens: 1, outputTokens: 1, searchCalls: 0 } as never);
    stolenMidRun('st3', jobs);

    const res = await runJob(input('st3'));
    expect(res.status).toBe('superseded');
    expect((await getJob('st3'))!.cost?.usd, 'the live run’s number, untouched').toBe(9.99);
  });

  it('does not park the job or release the buyer’s slot', async () => {
    // The whole `held` branch ran before the gate: it uploaded a trace, called
    // `markHeld`, and released the slot. `markHeld` refuses a stale dispatch, but
    // its result was discarded and its three siblings never checked at all.
    //
    // `releaseJobSlot` is the one that costs money: it keys on the job's `slotHeld`
    // flag, not on the dispatch, so a stale run hitting its ceiling frees the LIVE
    // run's slot and the buyer starts a second report while the first is going.
    await seedJob('st4');
    const jobs = await import('../src/jobs/firestore.js');
    const slots = await import('../src/jobs/slots.js');
    const held = vi.spyOn(jobs, 'markHeld');
    const released = vi.spyOn(slots, 'releaseJobSlot');
    const ceiling = config.workflow.maxJobCostUsd;
    writableConfig.workflow.maxJobCostUsd = 0.000001; // every run parks on this
    try {
      stolenMidRun('st4', jobs);
      const res = await runJob(input('st4'));
      expect(res.status, 'not held — this run does not get to decide that').toBe('superseded');
      expect(held).not.toHaveBeenCalled();
      expect(released).not.toHaveBeenCalled();
    } finally {
      writableConfig.workflow.maxJobCostUsd = ceiling;
    }
  });

  it('never writes an OUTCOME progress line', async () => {
    // The latch is deliberately loose on `onProgress`: it only trips at a wave
    // boundary, so a step line written between the theft and the next boundary
    // still lands. That is the accepted cost of not spending a Firestore read per
    // progress line, and it is a step line — the live run overwrites it within
    // seconds.
    //
    // What must NEVER land is a terminal one. `phase: 'incomplete'` and
    // `phase: 'held'` are what the buyer's UI reads as "this stopped", and a
    // superseded run wrote them over a job that was still going.
    await seedJob('st6');
    const jobs = await import('../src/jobs/firestore.js');
    stolenMidRun('st6', jobs);
    const res = await runJob(input('st6'));
    expect(res.status).toBe('superseded');

    const phase = (await getJob('st6'))!.progress?.phase;
    expect(['incomplete', 'held', 'done'], 'a superseded run told the buyer the job had stopped').not.toContain(phase);
  });

  it('does not release the slot when the park itself is REFUSED', async () => {
    // The window the gates above cannot close. `stillOurs()` is checked before the
    // engine's uploads; a re-dispatch that lands between that check and `markHeld`
    // gets a park REFUSED by the transaction — and the four call sites discarded
    // that answer, so the run went on to release the slot (which keys on the job's
    // `slotHeld` flag, not on the dispatch, so it frees the LIVE run's), write a
    // `held` progress line over a job that was still going, and tell the worker
    // `held` about an outcome nobody recorded.
    //
    // Driven with a spy rather than by timing the race: the race is real but not
    // schedulable, and what is under test is what the run does with a `false`.
    //
    // No progress-phase assertion here, deliberately. The engine emits its own
    // `held` notice at the ceiling, and at that moment this run still owned the
    // job — that line was true when it was written. The stale-latch case is the
    // one above; what this case is about is what happens AFTER the refusal.
    await seedJob('st7');
    const jobs = await import('../src/jobs/firestore.js');
    const slots = await import('../src/jobs/slots.js');
    const held = vi.spyOn(jobs, 'markHeld').mockResolvedValue(false);
    const released = vi.spyOn(slots, 'releaseJobSlot');
    const ceiling = config.workflow.maxJobCostUsd;
    writableConfig.workflow.maxJobCostUsd = 0.000001; // every run parks on this
    try {
      const res = await runJob(input('st7'));
      expect(held, 'the park was never attempted, so the refusal was not exercised').toHaveBeenCalled();
      expect(res.status, 'reported an outcome the job never took').toBe('superseded');
      expect(released, 'freed a slot this run no longer owns').not.toHaveBeenCalled();
    } finally {
      writableConfig.workflow.maxJobCostUsd = ceiling;
    }
  });

  it('still parks and releases when the job IS ours', async () => {
    // The control. "Never parks, never releases" would pass everything above.
    await seedJob('st5');
    const jobs = await import('../src/jobs/firestore.js');
    const slots = await import('../src/jobs/slots.js');
    const held = vi.spyOn(jobs, 'markHeld');
    const released = vi.spyOn(slots, 'releaseJobSlot');
    const ceiling = config.workflow.maxJobCostUsd;
    writableConfig.workflow.maxJobCostUsd = 0.000001;
    try {
      const res = await runJob(input('st5'));
      expect(res.status).toBe('held');
      expect(held).toHaveBeenCalled();
      expect(released).toHaveBeenCalled();
    } finally {
      writableConfig.workflow.maxJobCostUsd = ceiling;
    }
  });
});

describe('a dispatch that could not save anything does not hand the bill to the next one', () => {
  // The load path parks an UNREADABLE checkpoint, and its comment says a MISSING
  // one is normal — which it is, when nothing was attempted. It also covers the
  // case where every save was attempted and every one failed, and that is the
  // expensive half: the next dispatch finds no object, starts from zero, and
  // re-buys every agent this one already paid for, up to `maxJobAttempts` times,
  // behind a warn that repeats per agent.
  const seedJob = (jobId: string) =>
    createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);
  const checkpointsFor = (jobId: string) => [...OBJECTS.keys()].filter((k) => k.includes(jobId) && k.includes('checkpoint'));

  /** The first agent finishes (so a checkpoint IS attempted), the second never does. */
  function oneAgentThenFailure(): void {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    let structured = 0;
    mock.generate = async (opts) => {
      if (opts.responseSchema && ++structured > 2) {
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };
  }

  /** Fail only the checkpoint upload; the report and the trace still store fine. */
  async function breakCheckpointUploads(): Promise<void> {
    const storage = await import('../src/storage/gcs.js');
    const real = storage.uploadObject;
    vi.spyOn(storage, 'uploadObject').mockImplementation(async (o) => {
      if (o.name.includes('checkpoint')) throw new Error('storage unavailable');
      return real(o);
    });
  }

  it('parks instead of asking to be retried', async () => {
    await seedJob('cs1');
    oneAgentThenFailure();
    await breakCheckpointUploads();

    const res = await runJob(input('cs1'));
    expect(res.status, '`incomplete` re-dispatches into a full re-buy').toBe('held');
    const job = (await getJob('cs1'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.detail).toMatch(/checkpoint/i);
    // The admin decides about MONEY here, so the figure has to be the real one.
    // `parkAndRethrow` reports 0 because the paths it serves park before anything
    // has run; this job has run.
    expect(job.hold?.spentUsd, 'a job that spent nothing needs no decision').toBeGreaterThan(0);
    expect(checkpointsFor('cs1'), 'the premise: nothing was written').toEqual([]);
  });

  it('does not park a dispatch whose saves worked but whose agents did not', async () => {
    // Why this is not just "incomplete → park". Measured while writing it: even a
    // dispatch where NO agent succeeded still writes a checkpoint at the wave
    // boundary (saved: 1, failed: 0), so "no agent finished" and "nothing was
    // written" are different states and only the second is expensive.
    //
    // Stated plainly because it limits the test above: narrowing the guard to
    // `checkpointsSaved === 0` is GREEN across this file. The extra clause is a
    // statement of intent for a future path that attempts no save at all, and no
    // assertion here can tell the two apart.
    await seedJob('cs2');
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) =>
      (opts.responseSchema ? { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } } : base(opts));

    const res = await runJob(input('cs2'));
    expect(res.status, 'nothing attempted, nothing to park for').toBe('incomplete');
    expect((await getJob('cs2'))!.status).not.toBe('held');
  });

  it('still resumes normally when the saves work', async () => {
    // The control: "park on any incomplete" would pass the first case, and
    // "never park" would pass the second.
    await seedJob('cs3');
    oneAgentThenFailure();

    const res = await runJob(input('cs3'));
    expect(res.status).toBe('incomplete');
    expect(checkpointsFor('cs3').length, 'a checkpoint the next dispatch can resume from').toBeGreaterThan(0);
  });
});

describe('the park that every unexpected throw takes', () => {
  // `parkAndRethrow` was the FIFTH park site and the one left behind when the
  // other four were routed through `park()`. It discarded `markHeld`'s answer and
  // released the slot regardless — so a run whose park was REFUSED, because the
  // job had already been resolved by a person, handed back a slot that was not
  // its own and the buyer could start a second report while the first still ran.
  //
  // Driven through `runJob` rather than against `markHeld` directly: the unit
  // behaviour was already covered and stayed green through the defect, because
  // what was wrong was the WIRING.
  it('does not release the slot when the park is refused', async () => {
    await createJob({ jobId: 'pr1', appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('pr1', true);
    // Resolved by an admin. `markHeld` refuses a resolved job even with no
    // dispatch id, which is what makes this reachable from the outer catch.
    await markFailed('pr1', 'closed by an admin');

    // A retired template throws in the prologue — the shortest route to
    // `parkAndRethrow`, and it happens before anything claims the job.
    await expect(runJob(input('pr1', 'a-template-we-retired'))).rejects.toThrow(/unknown template/i);

    expect(await slots.inFlightSlots(APP, USER), 'it gave away the live run’s slot').toBe(1);
    expect((await getJob('pr1'))!.status, 'and it must not have reopened a resolved job').toBe('failed');
  });

  it('still releases it when the park sticks — the control', async () => {
    // "Never release" locks the buyer out of the product for as long as nobody
    // looks at their job, which is the failure the unconditional release existed
    // to prevent.
    await createJob({ jobId: 'pr2', appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('pr2', true);

    await expect(runJob(input('pr2', 'a-template-we-retired'))).rejects.toThrow(/unknown template/i);

    expect((await getJob('pr2'))!.status).toBe('held');
    expect(await slots.inFlightSlots(APP, USER)).toBe(0);
  });
});
