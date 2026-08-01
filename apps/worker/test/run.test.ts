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

import { createJob, getApp, createApp, getJob, markCompleted, markHeld } from '@agent-researcher/core';
import { app } from '../src/index.js';

const JOB = 'job-1';

const run = (jobId: string = JOB) => app.inject({ method: 'POST', url: '/run', payload: { jobId } });
const runWithNoJobId = () => app.inject({ method: 'POST', url: '/run', payload: {} });

async function seedJob(jobId = JOB) {
  await createApp({ appId: 'fbizlab', name: 'fbizlab', role: 'app' });
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

  it('acks a throw only once the job has actually been parked', async () => {
    // The engine's guard parks the job before rethrowing, so this is the ordinary
    // shape: an outcome exists, and retrying would only burn tokens.
    await seedJob();
    await markHeld(JOB, { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });
    runJob.mockRejectedValue(new Error('vertex exploded'));

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
