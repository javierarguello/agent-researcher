/**
 * E · EXTRACTION — the incident actually reaching the counter.
 *
 * `e-extraction.test.ts` proves the engine SEES a prompt echo: it asserts
 * `out.promptEchoes` on the value `runResearch` returns. That is one half. The
 * other half is that `runJob` — the thing a paid dispatch actually calls — books
 * it, and no test asked. Round 11, `echo-book-1`: the booking loop had been pasted
 * inside `onCheckpoint`'s stale-dispatch branch (`5fa80a7`), so on every job that
 * kept ownership — i.e. every ordinary job — it never ran. The guard fired, the
 * report was redacted, and the counter Javier built to decide "what to do about a
 * source that tries this" read zero forever.
 *
 * The whole core suite was green with the booking dead, which is the fact worth
 * keeping: the engine-level assertion pins the PUSH (`research-engine.ts:776`) and
 * says nothing about the call site.
 *
 * So this file drives `runJob` and reads the counter back through `getAppStats` —
 * the same function the admin dashboard reads. Not a spy: a spy would pass again
 * the day someone books the incident into a field nobody displays.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/tools/web-search.js', () => import('../fixtures/fake-web.js'));
vi.mock('../../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
  downloadObject: async () => undefined,
  deleteObject: async () => {},
  signJobFiles: async (f: unknown) => f,
  listJobFiles: async () => [],
  signRead: async () => '',
}));

import { runJob } from '../../src/engine/run-job.js';
import { createJob, getJob, setJobAttempts } from '../../src/jobs/firestore.js';
import { getAppStats } from '../../src/stats/store.js';
import { __registerTemplateForTests } from '../../src/templates/registry.js';
import { payload, poisonWeb } from '../fixtures/poisoned-web.js';
import { installObedientProvider } from '../mocks/obedient-llm.js';
import { redTeamModel } from '../fixtures/red-team-model.js';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; vi.restoreAllMocks(); });

describe('E · a prompt echo is booked by the path a paid job takes', () => {
  it('increments the app counter the admin reads, on an ordinary job that keeps ownership', async () => {
    __registerTemplateForTests(redTeamModel);
    installObedientProvider([payload('prompt-dump')]);
    restore = poisonWeb(['prompt-dump']);

    const params = redTeamModel.paramsSchema.parse({}) as Record<string, unknown>;
    const jobId = 'echo-book-1';
    await createJob({ jobId, appId: 'fbizlab', userId: 'u@x.com', template: redTeamModel.id, params });
    // Final attempt, so this dispatch finalizes rather than parking for a resume.
    await setJobAttempts(jobId, 1);

    // Nothing here makes the dispatch stale: `stillOurs()` holds all the way
    // through, which is precisely the case the misplaced loop could not reach.
    await runJob({ jobId, appId: 'fbizlab', userId: 'u@x.com', template: redTeamModel.id, params });

    // FIRST: prove the attack actually landed and the guard fired on this run.
    // Without this the test could go red because the poisoned page never ranked,
    // and "not booked" would be indistinguishable from "nothing to book" — the
    // failure mode that makes a reproduction worthless.
    const job = (await getJob(jobId))!;
    expect(job.status).toBe('completed');
    expect((job.summary?.warnings ?? []).join(' '), 'the guard never fired — nothing to book')
      .toMatch(/repeating this agent/i);

    // THEN: the incident reaches the counter.
    const stats = await getAppStats('fbizlab');
    expect(stats?.promptEchoBlocked, 'the incident never reached the counter').toBeGreaterThan(0);
    // The FIELD count too: an echo that redacted six fields and one that redacted
    // one are not the same event, and the admin surface distinguishes them.
    expect(stats?.promptEchoFields as number).toBeGreaterThan(0);
    expect(stats?.promptEchoLastAt, 'nothing dates the incident').toBeTruthy();
  });
});
