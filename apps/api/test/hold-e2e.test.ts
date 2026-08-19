/**
 * End to end: a job that runs out of budget, the admin decision, and what the
 * buyer's credits do at every step.
 *
 * Everything else about holds is tested a layer down (`packages/core`, against
 * scripted answers). This is the seam nothing else covers: the HTTP surface. The
 * buyer creates a job over the API, the worker runs it, the ADMIN resolves it over
 * the API, and the worker runs it again — the same four hops production makes,
 * with the queue standing in as a direct `runJob` call (the queue's only job is to
 * make that call).
 *
 * The model is a two-agent stand-in registered for the test, not a production
 * model. That is what makes this affordable to run for real:
 *
 *   npm test                          scripted answers, seconds
 *   npm run llm:up && TEST_LLM=ollama npm run test -w @agent-researcher/api
 *                                     the same assertions, a real local model
 *
 * Same test, both ways. The scripted run keeps the flow honest on every commit;
 * the live run is the one that proves a real model driving a real tool loop still
 * ends up held, approvable, and finishable.
 */
import { writableConfig } from './writable-config.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

// Cloud Storage is aliased to an in-memory fake for the whole suite (see
// vitest.config.ts), so nothing here reaches a real bucket, and the checkpoint one
// dispatch writes is genuinely there for the next one to resume from.

import {
  __clearTestTemplates,
  __registerTemplateForTests,
  config,
  getBalance,
  getJob,
  grantCredits,
  listTransactions,
  runJob,
} from '@agent-researcher/core';
import { __setProviderForTests } from '@agent-researcher/core';
import { app } from '../src/index.js';
import { auth, seedAdmin, seedApp, token } from './helpers.js';
import { compactModel } from '../../../packages/core/test/fixtures/compact-model.js';
import { MockLlmProvider } from '../../../packages/core/test/mocks/llm.js';
import { isLive } from './llm-mode.js';

/**
 * A real 3B model on CPU runs the two agents in tens of seconds, and how many tens
 * depends on the machine. Generous on purpose — the same treatment the other live
 * tests give themselves — because a flaky timeout here reads as a broken flow.
 */
const RUN_TIMEOUT = isLive ? 900_000 : 30_000;

const APP = 'fbizlab';
const BUYER = 'buyer@x.com';
const ADMIN = 'boss@x.com';

/** The one hop this test stands in for: the queue calling the worker. */
const workerRuns = (jobId: string) =>
  getJob(jobId).then((j) =>
    runJob({ jobId, appId: j!.appId, userId: j!.userId, template: j!.template, params: j!.params }),
  );

describe('a job held for budget, decided over the API', () => {
  const ceiling = config.workflow.maxJobCostUsd;
  let buyerToken = '';
  let adminToken = '';

  const classifier = config.moderation.llm;
  beforeEach(async () => {
    // The suite-wide stub answers `{"quality":"ok"}` to everything, which is right
    // for the classifier and useless for the engine — it cannot satisfy a
    // responseSchema. Swap in the schema-aware mock and turn the LLM classifier
    // off; the deterministic pre-screen still guards every request here, and the
    // classifier has its own suite. In live mode neither line applies: the real
    // local model answers both.
    if (!isLive) {
      __setProviderForTests('gemini-vertex', new MockLlmProvider());
      writableConfig.moderation.llm = false;
    }
    __registerTemplateForTests(compactModel);
    await seedApp(APP);
    await seedAdmin([ADMIN]);
    buyerToken = await token(APP, BUYER);
    adminToken = await token('admin', ADMIN, 'admin');
    await grantCredits({ appId: APP, userId: BUYER, credits: 20 });
    // Low enough that the very first agent takes the job past it, whichever model
    // is answering — the point here is the decision flow, not where it stops.
    writableConfig.workflow.maxJobCostUsd = 0.000001;
  });
  afterEach(() => {
    writableConfig.workflow.maxJobCostUsd = ceiling;
    writableConfig.moderation.llm = classifier;
    __clearTestTemplates();
  });

  /** Buyer creates a job over the API; the worker runs it into a hold. */
  async function heldJob(extra: Record<string, unknown> = {}): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(buyerToken),
      payload: {
        template: compactModel.id,
        params: { subject: 'laundromats for sale', location: 'Miami-Dade County, FL', ...extra },
      },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };

    expect((await workerRuns(jobId)).status).toBe('held');
    return jobId;
  }

  it('approve: the buyer sees a paused job, the admin sees why, and it finishes', { timeout: RUN_TIMEOUT }, async () => {
    const spent = 20 - (await getBalance(APP, BUYER));
    const jobId = await heldJob();
    const charged = 20 - (await getBalance(APP, BUYER)) - spent;
    expect(charged).toBeGreaterThan(0); // the credits went out when the job was created

    // What the BUYER sees: paused, with no idea what it cost us and no mention of
    // our internal limits. Both are admin-only for the same reason.
    const mine = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().status).toBe('held');
    expect(mine.json().cost).toBeUndefined();
    expect(mine.json().hold).toBeUndefined();

    // What the ADMIN sees: the reason, the spend, and the deadline to decide.
    const seen = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(adminToken) });
    expect(seen.json().hold.reason).toBe('budget_exceeded');
    expect(seen.json().hold.spentUsd).toBeGreaterThan(0);
    expect(seen.json().hold.detail).toBeTruthy();

    // And it is findable without opening every job.
    const list = await app.inject({ method: 'GET', url: '/admin/jobs?status=held', headers: auth(adminToken) });
    expect(list.json().jobs.map((j: { jobId: string }) => j.jobId)).toContain(jobId);

    const ok = await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/approve`, headers: auth(adminToken) });
    expect(ok.statusCode).toBe(202);
    expect((await getJob(jobId))!.status).toBe('queued');

    // The second dispatch runs UNCAPPED — the ceiling that held it is still
    // configured, so only the per-job override can get this past the same wall.
    expect(config.workflow.maxJobCostUsd).toBe(0.000001);
    expect((await workerRuns(jobId)).status).toBe('completed');

    const done = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    expect(done.json().status).toBe('completed');
    expect(done.json().files.length).toBeGreaterThan(0);

    // Charged once, for the report they got. Never refunded, never re-charged.
    expect(20 - (await getBalance(APP, BUYER)) - spent).toBe(charged);
    expect((await listTransactions(APP, BUYER, 20)).filter((t) => t.type === 'refund')).toHaveLength(0);
  });

  it('resolve → refund: fails the job and gives the credits back', { timeout: RUN_TIMEOUT }, async () => {
    const before = await getBalance(APP, BUYER);
    const jobId = await heldJob();
    expect(await getBalance(APP, BUYER)).toBeLessThan(before);

    const res = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund', reason: 'not worth continuing' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(true);

    const job = (await getJob(jobId))!;
    expect(job.status).toBe('failed');
    expect(job.failureKind).toBe('budget_exceeded');
    expect(await getBalance(APP, BUYER)).toBe(before);
  });

  it('never tells the buyer their credits came back before they have', { timeout: RUN_TIMEOUT }, async () => {
    // `job.error` is the buyer's field, and the resolve route has to flip the job
    // BEFORE it refunds — the flip is what stops two admins both moving money. So
    // the note written at flip time cannot mention a refund that has not happened.
    // It used to, unconditionally, from the admin's stated intent.
    const jobId = await heldJob();
    const store = await import('@agent-researcher/core');
    const spy = vi.spyOn(store, 'refundForJob').mockRejectedValueOnce(new Error('firestore unavailable'));

    const res = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    spy.mockRestore();

    // The admin is told plainly, instead of a 200 that reads like success.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refunded: false, refundFailed: true });
    // And the buyer is not promised anything.
    expect((await getJob(jobId))!.error ?? '').not.toMatch(/returned|devuelto/i);
  });

  it('finishes a refund a previous resolve could not', { timeout: RUN_TIMEOUT }, async () => {
    // The stranding, and the whole reason the window matters. Before this the job
    // was `failed` with the credits still consumed, `resolve` 409'd on anything not
    // `held`, and `retry` refuses a refunded job — there was no route left that
    // could pay the buyer back.
    const before = await getBalance(APP, BUYER);
    const jobId = await heldJob();

    const store = await import('@agent-researcher/core');
    const spy = vi.spyOn(store, 'refundForJob').mockRejectedValueOnce(new Error('firestore unavailable'));
    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    spy.mockRestore();
    // Non-vacuous by construction: the job really is closed and really is unpaid.
    expect((await getJob(jobId))!.status).toBe('failed');
    expect(await getBalance(APP, BUYER)).toBeLessThan(before);

    const again = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().refunded).toBe(true);
    expect(await getBalance(APP, BUYER)).toBe(before);
    // …and now the buyer is told, in the language they bought in.
    expect((await getJob(jobId))!.error ?? '').toMatch(/credits were returned/i);

    // Still exactly once: a third call has nothing left to do.
    const third = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    expect(third.statusCode).toBe(409);
    expect(await getBalance(APP, BUYER)).toBe(before);
  });

  it('stops telling the buyer it is paused once it is running again', { timeout: RUN_TIMEOUT }, async () => {
    // `approveHold` cleared `error` and `finishedAt` and not `progress`, so an
    // approved job ran with "Paused while we review it. Nothing more is being
    // spent." under a live spinner — for the whole queue wait, on the buyer's page.
    const jobId = await heldJob();
    const paused = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    // Non-vacuous by construction: the held job really was showing that line —
    // to the buyer as the KIND (the client localizes it), to the admin as the
    // sentence too.
    expect(paused.json().progress?.kind).toBe('held');
    expect(paused.json().progress?.message).toBeUndefined();
    const adminView = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(adminToken) });
    // English, and internal, like every other `message`: the buyer's line comes from
    // the KIND now, so the localized sentence that used to live here was a second
    // copy of the SPA's — and had already drifted from it (round 7, R7-22).
    expect(adminView.json().progress?.message ?? '').toMatch(/held for review/i);
    expect(adminView.json().progress?.kind).toBe('held');

    await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/approve`, headers: auth(adminToken) });

    const running = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    expect(running.json().status).toBe('queued');
    expect(running.json().progress?.kind ?? null).not.toBe('held');
    const runningAdmin = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(adminToken) });
    expect(runningAdmin.json().progress?.message ?? '').not.toMatch(/pausa|paused/i);
  });

  it('tells the buyer their credits came back, in their language', { timeout: RUN_TIMEOUT }, async () => {
    // The ORDINARY refund, which nothing pinned: the only assertion on this
    // sentence lived in the recovery test, so the message the overwhelming
    // majority of refunded buyers read was unguarded.
    const jobId = await heldJob();
    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    // Read through the BUYER's own endpoint, not the job document — the field has
    // to survive redaction to be worth writing.
    const seen = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    expect(seen.json().error ?? '').toMatch(/credits were returned/i);
  });

  it('says it in the language the buyer bought in', { timeout: RUN_TIMEOUT }, async () => {
    // The sentence above is English because the fixture's job is. Forcing
    // `closedNotice` to always answer `.en` left core AND api green, so the
    // comment claiming "in the language they bought in" was unbacked.
    const jobId = await heldJob({ language: 'es' });
    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    const seen = await app.inject({ method: 'GET', url: `/research/${jobId}`, headers: auth(buyerToken) });
    expect(seen.json().error ?? '').toMatch(/créditos fueron devueltos/i);
  });

  it('a job closed WITHOUT a refund cannot be refunded by pressing again', { timeout: RUN_TIMEOUT }, async () => {
    // The recovery path exists to finish an interrupted refund. Intent is not
    // recoverable from state — a dismissed job and one whose refund threw both read
    // `failed` and unrefunded — so before the decision was persisted, a second
    // click reversed a deliberate "close without refund" and the audit log stamped
    // it as the completion of the first decision.
    const before = await getBalance(APP, BUYER);
    const jobId = await heldJob();
    const charged = await getBalance(APP, BUYER);
    expect(charged).toBeLessThan(before);

    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'dismiss', reason: 'abusive request — deliberately no refund' },
    });

    const again = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    expect(again.statusCode).toBe(409);
    expect(await getBalance(APP, BUYER)).toBe(charged);
  });

  it('does not report a failure when there was nothing to refund', { timeout: RUN_TIMEOUT }, async () => {
    // `refundForJob` returns false for "already refunded", "nothing consumed" and
    // "the job may still run". Reporting all three as `refundFailed` told the admin
    // to retry forever on a buyer who was never charged.
    const jobId = await heldJob();
    const store = await import('@agent-researcher/core');
    // The job consumed credits; drop the consume entry to stand in for a job that
    // never did (an admin-created run, or `APP_ENV=local`).
    const spy = vi.spyOn(store, 'wasJobConsumed').mockResolvedValue(false);
    const refundSpy = vi.spyOn(store, 'refundForJob').mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    spy.mockRestore();
    refundSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(false);
    expect(res.json().refundFailed, 'told the admin to retry a refund that was never owed').toBeUndefined();
  });

  it('books the failed report once, not twice', { timeout: RUN_TIMEOUT }, async () => {
    // The recovery path finishes a decision; it does not make a new one. Booking
    // stats there counts the same failure twice in the loss accounting, and the
    // guard that prevents it was unpinned.
    const stats = await import('@agent-researcher/core');
    const booked = vi.spyOn(stats, 'recordReportStats');
    const jobId = await heldJob();

    const store = await import('@agent-researcher/core');
    const failOnce = vi.spyOn(store, 'refundForJob').mockRejectedValueOnce(new Error('firestore unavailable'));
    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    failOnce.mockRestore();
    const afterFirst = booked.mock.calls.length;
    expect(afterFirst, 'the real resolution never booked anything').toBeGreaterThan(0);

    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'refund' },
    });
    expect(booked.mock.calls.length).toBe(afterFirst);
    booked.mockRestore();
  });

  it('resolve → dismiss: closes the job and keeps the credits', { timeout: RUN_TIMEOUT }, async () => {
    const jobId = await heldJob();
    const afterCharge = await getBalance(APP, BUYER);

    const res = await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'dismiss' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(false);

    // The other half of "every refund is a decision": so is every non-refund. This
    // is the path for a buyer who was topped up instead, or a job that was abusive.
    expect((await getJob(jobId))!.status).toBe('failed');
    expect(await getBalance(APP, BUYER)).toBe(afterCharge);
  });

  it('top-up: grants credits without touching the job, then the job is closed', { timeout: RUN_TIMEOUT }, async () => {
    const jobId = await heldJob();
    const afterCharge = await getBalance(APP, BUYER);

    const grant = await app.inject({
      method: 'POST', url: '/admin/credits/grant', headers: auth(adminToken),
      payload: { appId: APP, userId: BUYER, credits: 3, reason: `top-up for held job ${jobId}` },
    });
    expect(grant.statusCode).toBe(200);
    expect(await getBalance(APP, BUYER)).toBe(afterCharge + 3);
    // Granting is not resolving: the job is still waiting on a decision.
    expect((await getJob(jobId))!.status).toBe('held');

    await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken),
      payload: { outcome: 'dismiss', reason: 'topped up instead' },
    });
    expect((await getJob(jobId))!.status).toBe('failed');
    expect(await getBalance(APP, BUYER)).toBe(afterCharge + 3);
  });

  it('a hold resolves once: the second decision is a 409, not a second refund', { timeout: RUN_TIMEOUT }, async () => {
    const before = await getBalance(APP, BUYER);
    const jobId = await heldJob();

    const reject = { outcome: 'refund' as const };
    expect((await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken), payload: reject })).statusCode).toBe(200);
    // Whatever arrives second — another admin, another tab — must not refund again.
    expect((await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(adminToken), payload: reject })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/approve`, headers: auth(adminToken) })).statusCode).toBe(409);

    expect(await getBalance(APP, BUYER)).toBe(before);
    // Exactly one refund on the ledger, not one per attempt.
    expect((await listTransactions(APP, BUYER, 20)).filter((t) => t.type === 'refund' && t.jobId === jobId)).toHaveLength(1);

    // What this does NOT cover: these 409s come from the handler's status check,
    // which is a read-then-act and therefore useless against a genuine race. The
    // transactional gate inside `rejectHold`/`approveHold` is what covers that, and
    // no test here can exercise it — the in-memory Firestore does not model
    // transaction contention. Its unit tests pin the return value (`false` for the
    // loser); the refund itself is idempotent on `refund_<jobId>` regardless.
  });

  it('a held job does not lock the buyer out of starting another', { timeout: RUN_TIMEOUT }, async () => {
    await heldJob();
    // The one-in-flight cap bounds concurrent SPEND, and a parked job spends
    // nothing. Counting it would strand the buyer until an admin got around to it.
    const res = await app.inject({
      method: 'POST',
      url: '/research',
      headers: auth(buyerToken),
      payload: { template: compactModel.id, params: { subject: 'car washes for sale', location: 'Broward County, FL' } },
    });
    expect(res.statusCode).toBe(202);
  });

  it('only an admin can decide', { timeout: RUN_TIMEOUT }, async () => {
    const jobId = await heldJob();
    expect((await app.inject({ method: 'POST', url: `/admin/jobs/${jobId}/approve`, headers: auth(buyerToken) })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST', url: `/admin/jobs/${jobId}/resolve`, headers: auth(buyerToken), payload: { outcome: 'refund' },
    })).statusCode).toBe(403);
    expect((await getJob(jobId))!.status).toBe('held');
  });
});
