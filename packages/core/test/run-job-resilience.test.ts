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
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runJob } from '../src/engine/run-job.js';
import { createJob, getJob, markFailed, setJobCost, setProgress } from '../src/jobs/firestore.js';
import { installMockProvider } from './mocks/llm.js';
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
    spy.mockRestore();
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
    spy.mockRestore();
  });

  it('finishes a healthy job when the progress write fails', async () => {
    // Worse than parking: a rejection here surfaced inside the research loop and
    // failed the attempt as `stalled`, which makes the retry re-buy every search.
    await seed('h4b');
    const jobs = await import('../src/jobs/firestore.js');
    const spy = vi.spyOn(jobs, 'setProgress').mockRejectedValue(new Error('firestore unavailable'));

    const res = await runJob(input('h4b'));
    expect(res.status).toBe('completed');
    spy.mockRestore();
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

    spy.mockRestore();
    booked.mockRestore();
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
    spy.mockRestore();
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
    spy.mockRestore();
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
