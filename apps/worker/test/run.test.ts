/**
 * The worker's dispatch contract: what a job's outcome tells Cloud Tasks to do.
 *
 * This is a two-value decision — ack (200) or retry (5xx) — and both mistakes are
 * silent. An `incomplete` job that acks is abandoned half-finished with the buyer's
 * credits spent. A `held` job that returns a retryable status is re-dispatched
 * forever into the same wall it was parked at, and each dispatch re-runs the
 * headline call. Nothing in the product surfaces either one; only this does.
 *
 * `runJob` is mocked on purpose. What it decides is tested to death in
 * `packages/core`; what is tested here is the translation of its answer into an
 * HTTP status, which is the worker's entire job.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { runJob, notify } = vi.hoisted(() => ({
  runJob: vi.fn(),
  notify: vi.fn(async () => {}),
}));

vi.mock('@agent-researcher/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-researcher/core')>()),
  runJob,
  // The report-ready email is best-effort and has its own tests; here it only
  // matters WHETHER it is attempted.
  sendAppEmail: notify,
}));

import { createJob, getApp, createApp, getJob, markCompleted, markHeld, setJobSummary, sectionsNotice } from '@agent-researcher/core';
import { app } from '../src/index.js';

const JOB = 'job-1';

const run = (jobId: string = JOB) => app.inject({ method: 'POST', url: '/run', payload: { jobId } });
/** The mail body the worker actually handed `sendAppEmail`. */
const lastMail = () => (notify.mock.calls.at(-1) as unknown as [{ htmlBody: string; textBody: string }])[0];
const runWithNoJobId = () => app.inject({ method: 'POST', url: '/run', payload: {} });

async function seedJob(jobId = JOB) {
  // `emailFrom` and `webUrl` are what make the report-ready mail possible at all —
  // `notifyReportReady` returns early without them. The fixture omitted both, so
  // the notify assertions below could never have failed.
  await createApp({
    appId: 'fbizlab', name: 'fbizlab', role: 'app',
    emailFrom: 'reports@fbizlab.test', webUrl: 'https://fbizlab.test',
  } as never);
  await createJob({
    jobId, appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale', params: {},
  });
}

beforeEach(() => {
  runJob.mockReset();
  notify.mockClear();
  runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'completed' });
});

describe('what the worker tells the queue', () => {
  it('acks a completed job', async () => {
    await seedJob();
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('completed');
  });

  it('asks to be retried when the job is incomplete', async () => {
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'incomplete' });

    // 503 is what makes Cloud Tasks come back with backoff, and coming back is the
    // whole resume mechanism: `runJob` picks up from the checkpoint.
    const res = await run();
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('incomplete');
  });

  it('acks a SUPERSEDED dispatch instead of asking for a retry', async () => {
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'superseded' });

    // This task lost the job to a newer dispatch. A 503 retries THIS task, which
    // then takes the job back from the run that owns it, which supersedes the
    // first one again — a loop, and every cycle of it pays for another pass over
    // whatever the checkpoint had not finished. It used to return `incomplete`,
    // which is exactly the 503 path above.
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('superseded');
  });

  it('acks a HELD job instead of asking for a retry', async () => {
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'held' });

    // A held job is waiting for a person, not for a retry. Re-dispatching it walks
    // straight back into whatever parked it — and pays for a headline call each
    // time round. It comes back only when an admin approves it, which enqueues a
    // fresh task of its own.
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('held');
  });

  it('acks a failed job — retrying a deterministic failure just burns tokens', async () => {
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'failed' });
    expect((await run()).statusCode).toBe(200);
  });

  it('emails the buyer when the report is ready — and only then', async () => {
    // `notify` was mocked and never asserted, which is why the fixture could omit
    // the two fields that make sending possible at all and nobody noticed. This is
    // the buyer's only signal that a job they paid for has finished.
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 3, status: 'completed' });
    expect((await run()).statusCode).toBe(200);
    expect(notify).toHaveBeenCalled();
  });

  it('tells the buyer in the email that the dossier is incomplete', async () => {
    // This is the production caller, and it is the whole point of the fix: the
    // notice existed and was rendered on the viewer, the shared page and the PDF
    // cover, while the ONE message that arrives unprompted — and that many buyers
    // read instead of opening the PDF — announced the report as finished.
    //
    // `runJob` writes the summary before it marks the job completed, so the mock
    // does the same: a test that set the summary first would pass against a
    // worker that reads the job BEFORE running it, which is not the order here.
    await seedJob();
    const notice = sectionsNotice('en', [{ status: 'lost' }]);
    runJob.mockImplementation(async () => {
      await setJobSummary(JOB, { notice } as never);
      return { files: [], reportBytes: 0, sourcesFound: 3, status: 'completed' };
    });

    expect((await run()).statusCode).toBe(200);
    const sent = lastMail();
    expect(sent.htmlBody).toContain(notice);
    expect(sent.textBody).toContain(notice);
  });

  it('and does not hedge a report that came back whole', async () => {
    // The live control. A mail that always carries the caveat is as wrong as one
    // that never does — it tells a buyer holding a complete dossier that part of
    // it is missing.
    //
    // Two mutations had to be run to arrive at these assertions, and both are
    // worth the comment:
    //  - `not.toMatch(/could not be completed/)` stayed green against a default
    //    hedge worded differently ("some sections may be incomplete");
    //  - comparing the mail to `reportReadyTemplate(...)` built here stayed green
    //    too, because both sides come out of the same mutated function. A guard
    //    that reads its own constant cannot fail.
    // So: nothing extra between the body and the button, and the text is the
    // three paragraphs it has always been — neither claim reuses the code.
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 3, status: 'completed' });

    await run();
    const sent = lastMail();
    expect(sent.htmlBody).toMatch(/ready to view\.<\/p>\s*<a href=/);
    const paras = sent.textBody.split('\n\n');
    expect(paras, `an extra paragraph reached a buyer whose report was fine: ${sent.textBody}`).toHaveLength(3);
    expect(paras[2]).toMatch(/^AI-generated research/);
  });

  it('does not email on a job that did not finish', async () => {
    await seedJob();
    runJob.mockResolvedValue({ files: [], reportBytes: 0, sourcesFound: 0, status: 'incomplete' });
    await run();
    expect(notify).not.toHaveBeenCalled();
  });

  it('acks a throw only once the job has actually been parked', async () => {
    // The engine's guard parks the job before rethrowing, so this is the ordinary
    // shape: an outcome exists, and retrying would only burn tokens.
    //
    // The park has to happen INSIDE the mock. Marking the job held first made the
    // worker's own idempotency skip answer before `runJob` was ever called, so this
    // test never reached the branch it is named for — hard-coding that branch's
    // status, or making it 503 a parked job forever, both left it green.
    await seedJob();
    runJob.mockImplementation(async () => {
      await markHeld(JOB, { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });
      throw new Error('vertex exploded');
    });

    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('held');
  });

  it('asks for a retry when the throw recorded no outcome at all', async () => {
    // This test used to assert the opposite, and its name carried the reason:
    // "runJob already recorded the outcome". Its own call order did not guarantee
    // that — a throw in the prologue (a retired template, a blip on markRunning)
    // happened before the guard — so acking retired the task while the document
    // still read `queued` and the buyer's only slot stayed held forever.
    await seedJob();
    runJob.mockRejectedValue(new Error('firestore unavailable'));

    const res = await run();
    expect(res.statusCode).toBe(503);
    expect((await getJob(JOB))!.status).toBe('queued');
  });
});

describe('it does not run a job twice', () => {
  it.each(['completed', 'failed', 'held'] as const)('skips a job already %s', async (status) => {
    await seedJob();
    if (status === 'completed') await markCompleted(JOB, []);
    else {
      const { markFailed, markHeld } = await import('@agent-researcher/core');
      if (status === 'failed') await markFailed(JOB, 'nope');
      else await markHeld(JOB, { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });
    }

    // Cloud Tasks is at-least-once, so the same task can arrive twice. Re-running a
    // finished job would spend a second job's worth of tokens on a report that
    // already exists; re-running a held one would undo the pause.
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.json().skipped).toBe(true);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('runs a queued job', async () => {
    await seedJob();
    expect((await run()).statusCode).toBe(200);
    expect(runJob).toHaveBeenCalledOnce();
  });
});

describe('requests that are not worth retrying', () => {
  it('rejects a body with no jobId (4xx = permanent)', async () => {
    const res = await runWithNoJobId();
    expect(res.statusCode).toBe(400);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('404s an unknown job rather than asking to be retried', async () => {
    // A task for a job that does not exist will never succeed. A 5xx here would
    // have the queue retry it until it gives up.
    const res = await run('nope');
    expect(res.statusCode).toBe(404);
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe('health', () => {
  it('answers without touching anything', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
