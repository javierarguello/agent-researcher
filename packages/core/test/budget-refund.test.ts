/**
 * What happens to the money when a job hits the cost ceiling.
 *
 * The decision (Javier, 2026-07-30, extended 2026-07-31): the job is PARKED for an
 * admin, not failed and not shipped, and NOTHING resolves it but a person. The
 * credits stay consumed while it waits — an approval must not depend on the buyer
 * still holding a balance we already gave back — and there is no expiry, because
 * every refund in this system is a decision someone made.
 *
 * Two outcomes, both requiring an admin:
 *   approve → resumes from the checkpoint, uncapped, credits untouched,
 *   resolve → failed, with or without a refund.
 *
 * End-to-end through `runJob`, because none of the refund/mark/stats machinery
 * lives inside the engine.
 */
import { writableConfig } from './writable-config.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));
// Stateful on purpose: the checkpoint has to survive between dispatches, or an
// "approve and continue" test proves only that the job ran again from zero.
const { OBJECTS, GCS } = vi.hoisted(() => ({ OBJECTS: new Map<string, string>(), GCS: { failOn: '', failTimes: Infinity } }));
vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ jobId, name, data }: { jobId: string; name: string; data: string }) => {
    if (GCS.failOn && name === GCS.failOn && GCS.failTimes > 0) {
      GCS.failTimes -= 1;
      throw new Error('storage unavailable');
    }
    OBJECTS.set(`${jobId}/${name}`, data);
    return { name, path: `researchs/${jobId}/${name}`, contentType: 'application/json', size: data.length };
  },
  downloadObject: async (jobId: string, name: string) => OBJECTS.get(`${jobId}/${name}`),
  deleteObject: async (jobId: string, name: string) => void OBJECTS.delete(`${jobId}/${name}`),
  signJobFiles: async (f: unknown) => f,
  listJobFiles: async () => [],
  signRead: async () => '',
}));

import { config } from '../src/config.js';
import { runJob } from '../src/engine/run-job.js';
import { approveHold, createJob, getJob, getUserJobStats, rejectHold } from '../src/jobs/firestore.js';
import { grantCredits, consumeCredits, getBalance, listTransactions, refundForJob } from '../src/credits/store.js';
import { getAppStats } from '../src/stats/store.js';
import { getTemplate } from '../src/templates/registry.js';
import { MockLlmProvider, installMockProvider } from './mocks/llm.js';

const APP = 'fbizlab';
const USER = 'u@x.com';
const template = getTemplate('florida-business-for-sale')!;
const params = () => template.paramsSchema.parse({ mode: 'essential', industry: 'Laundromats' }) as Record<string, unknown>;

/** Run a job with a ceiling low enough to trip a few calls in, so there is real spend. */
async function runCapped(jobId: string, maxUsd = 0.01) {
  writableConfig.workflow.maxJobCostUsd = maxUsd;
  // The API creates the job document before dispatching; the counters and the
  // expiry sweep both query by appId/userId, so a test that skipped this would be
  // exercising a job that no query can find.
  await createJob({ jobId, appId: APP, userId: USER, template: template.id, params: params(), mode: 'essential' });
  return runJob({ jobId, appId: APP, userId: USER, template: template.id, params: params() });
}

describe('a job stopped by the cost ceiling', () => {
  const original = config.workflow.maxJobCostUsd;
  beforeEach(() => installMockProvider());
  afterEach(() => {
    writableConfig.workflow.maxJobCostUsd = original;
  });

  it('is held for a decision — not failed, not refunded, and still shows what it cost us', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'jb1');
    expect(await getBalance(APP, USER)).toBe(4);

    const lines: string[] = [];
    const l = vi.spyOn(console, 'log').mockImplementation((x) => void lines.push(String(x)));
    const e = vi.spyOn(console, 'error').mockImplementation((x) => void lines.push(String(x)));
    const result = await runCapped('jb1');
    l.mockRestore();
    e.mockRestore();
    const logs = lines.map((s) => { try { return JSON.parse(s); } catch { return {} as Record<string, unknown>; } });

    expect(result.status).toBe('held');

    const job = (await getJob('jb1'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.reason).toBe('budget_exceeded');
    // …and the reason is the CEILING's, not "whatever parked it". `budget_exceeded`
    // is a literal on that branch, so widening the branch to catch every incomplete
    // job — which is what a careless edit to `budgetStopped && pending.length` does
    // — left this green while every ordinary retry was reported to the admin as a
    // spend problem. The contrast case is below.
    // The money is on the job and on the hold, because it was spent whatever we decide.
    expect(job.cost?.usd).toBeGreaterThan(0);
    expect(job.hold?.spentUsd).toBeGreaterThan(0);

    // NOT refunded while it waits. Refunding now would let the buyer spend the
    // balance elsewhere and leave an approval with nothing to charge.
    expect(await getBalance(APP, USER)).toBe(4);
    expect((await listTransactions(APP, USER, 10)).some((t) => t.type === 'refund')).toBe(false);

    // Its own ERROR event, with the figures — this is an incident, not a degradation.
    const ev = logs.find((x) => x.event === 'job.held');
    expect(ev).toBeTruthy();
    expect(ev!.severity).toBe('ERROR');
    expect(Number(ev!.costUsd)).toBeGreaterThan(0);
  });

  it('does not count against the buyer’s one-job-at-a-time limit', async () => {
    await runCapped('jb2');
    const stats = await getUserJobStats(APP, USER);
    // A held job waits on US and spends nothing. Counting it as in-flight would lock
    // the buyer out of the product until an admin got around to it — the shape of E2.
    expect(stats.held).toBe(1);
    expect(stats.inProgress).toBe(0);
  });

  it('books nothing in the report stats until it actually resolves', async () => {
    await runCapped('jb3');
    // Booking it now would count the same job twice: once held, once finished.
    expect(await getAppStats(APP)).toBeFalsy();
  });
});

describe('a report that ran but could not be stored', () => {
  const original = config.workflow.maxJobCostUsd;
  beforeEach(() => installMockProvider());
  afterEach(() => {
    writableConfig.workflow.maxJobCostUsd = original;
    GCS.failOn = '';
    GCS.failTimes = Infinity;
  });

  it('rides out a transient storage blip instead of parking the job', async () => {
    // The common case, and the reason the upload is retried at all: storage wobbles
    // for a second. Without the retry this becomes a held job and a person's
    // attention, for something that fixed itself.
    await createJob({ jobId: 'ju0', appId: APP, userId: USER, template: template.id, params: params(), mode: 'essential' });
    GCS.failOn = 'report.json';
    GCS.failTimes = 1;

    const result = await runJob({ jobId: 'ju0', appId: APP, userId: USER, template: template.id, params: params() });

    expect(result.status).toBe('completed');
    expect(OBJECTS.has('ju0/report.json')).toBe(true);
  });

  it('is held rather than refunded — the work is done and worth recovering', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'ju1');
    await createJob({ jobId: 'ju1', appId: APP, userId: USER, template: template.id, params: params(), mode: 'essential' });

    GCS.failOn = 'report.json'; // survives the retries too
    const result = await runJob({ jobId: 'ju1', appId: APP, userId: USER, template: template.id, params: params() });

    expect(result.status).toBe('held');
    const job = (await getJob('ju1'))!;
    expect(job.status).toBe('held');
    expect(job.hold?.reason).toBe('upload_failed');

    // The old behaviour refunded here and dropped the report: a storage blip after
    // a successful, fully-paid run returned every credit and we ate the cost. The
    // work exists in the checkpoint — hold it, retry the upload, deliver it.
    expect(await getBalance(APP, USER)).toBe(4);
    expect((await listTransactions(APP, USER, 10)).some((t) => t.type === 'refund')).toBe(false);
    expect(OBJECTS.has('ju1/checkpoint.json')).toBe(true);
  });

  it('delivers once storage comes back, without re-running the research', async () => {
    await createJob({ jobId: 'ju2', appId: APP, userId: USER, template: template.id, params: params(), mode: 'essential' });
    GCS.failOn = 'report.json';
    await runJob({ jobId: 'ju2', appId: APP, userId: USER, template: template.id, params: params() });
    expect((await getJob('ju2'))!.status).toBe('held');

    GCS.failOn = '';
    await approveHold('ju2', 'admin@x.com');
    const again = await runJob({ jobId: 'ju2', appId: APP, userId: USER, template: template.id, params: params() });

    expect(again.status).toBe('completed');
    expect(OBJECTS.has('ju2/report.json')).toBe(true);
  });
});

describe('resolving a hold', () => {
  const original = config.workflow.maxJobCostUsd;
  beforeEach(() => installMockProvider());
  afterEach(() => {
    writableConfig.workflow.maxJobCostUsd = original;
  });

  it('approve: resumes from the checkpoint with no ceiling, and charges nothing more', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'ja1');
    await runCapped('ja1');
    expect((await getJob('ja1'))!.status).toBe('held');

    expect(await approveHold('ja1', 'admin@x.com')).toBe(true);
    const job = (await getJob('ja1'))!;
    expect(job.status).toBe('queued');
    // Without this the resumed job wakes up already over the ceiling and holds
    // again — an approval that approves nothing.
    expect(job.budgetOverride).toBe(true);
    expect(job.hold?.approvedBy).toBe('admin@x.com');
    // Attempts reset: a job resuming from a checkpoint needs room for what is left.
    expect(job.attempts).toBe(0);
    // The buyer is charged once, for the report they will get.
    expect(await getBalance(APP, USER)).toBe(4);
  });

  it('approve: the re-dispatched job actually finishes, instead of holding again', async () => {
    // The end-to-end claim of the whole feature. The approval only means something
    // if the resumed dispatch runs UNCAPPED: the checkpoint carries the spend that
    // caused the hold, so a job that came back with its ceiling still in force
    // would wake up already over it and hold again, forever.
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'ja3');
    await runCapped('ja3');
    expect((await getJob('ja3'))!.status).toBe('held');
    // Held mid-way, so there is a checkpoint with real work in it.
    expect(OBJECTS.has('ja3/checkpoint.json')).toBe(true);

    await approveHold('ja3', 'admin@x.com');
    // Same low ceiling as before: only the per-job override can save this run.
    const again = await runJob({ jobId: 'ja3', appId: APP, userId: USER, template: template.id, params: params() });

    expect(again.status).toBe('completed');
    expect((await getJob('ja3'))!.status).toBe('completed');
    // Still charged once, and never refunded — they are getting the report.
    expect(await getBalance(APP, USER)).toBe(4);
  });

  it('a job parked for any OTHER reason is not reported as a spend problem', async () => {
    // The contrast. The admin's queue is triaged on `hold.reason`: "this job cost
    // us $18 and stopped" and "an upload failed, retry it" are different decisions,
    // and only one of them is about money.
    const jobs = await import('../src/jobs/firestore.js');
    await createJob({ jobId: 'jb9', appId: APP, userId: USER, template: 't', params: {}, status: 'queued' } as never);
    await jobs.markHeld('jb9', { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });

    expect((await getJob('jb9'))!.hold?.reason).toBe('run_failed');
    // …and `approve` does NOT uncap it, which is the decision that follows from
    // the reason being right.
    expect(await approveHold('jb9', 'admin@x.com')).toBe(true);
    expect((await getJob('jb9'))!.budgetOverride).not.toBe(true);
  });

  it('approve: refuses a job whose credits were already given back', async () => {
    // The free-report guard, and it had no test anywhere: disabling it left all 371
    // core and 179 api tests green. A refunded job is an UNPAID job, and approving
    // it runs it and delivers it. `requeueJob` has refused this since the
    // free-report fix; `approveHold` is the other door into the same room, and
    // several paths put a refunded job back into `held`.
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'ja4');
    await runCapped('ja4');
    expect((await getJob('ja4'))!.status).toBe('held');

    // The credits go back while the job is still parked — a support refund, or the
    // resolve route's own window between the flip and the money. `refundForJob`
    // permits it (a held job is neither queued nor running), so the only thing
    // between this job and a free run is the guard inside `approveHold`.
    expect(await refundForJob('ja4', 'support refund')).toBe(true);

    expect(await approveHold('ja4', 'admin@x.com')).toBe(false);
    expect((await getJob('ja4'))!.status).toBe('held');
    // …and the buyer keeps the money.
    expect(await getBalance(APP, USER)).toBe(5);
  });

  it('approve: a second approval loses, so one hold cannot be dispatched twice', async () => {
    await runCapped('ja2');
    expect(await approveHold('ja2', 'first@x.com')).toBe(true);
    expect(await approveHold('ja2', 'second@x.com')).toBe(false);
  });

  it('resolve with a refund: fails the job and gives the credits back, exactly once', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 5 });
    await consumeCredits(APP, USER, 1, 'jr1');
    await runCapped('jr1');

    expect(await rejectHold('jr1', 'Not approved.')).toBe(true);
    expect(await refundForJob('jr1', 'hold rejected')).toBe(true);
    expect(await getBalance(APP, USER)).toBe(5);

    // "Exactly once" is the title, and until now nothing here tested it: the refund
    // ran once and the balance was checked once, which a double refund would also
    // have satisfied at that point. Every refund is manual, so the realistic way to
    // get two is two people resolving the same hold — and the idempotency key is
    // what has to stop the second, not the resolver's own status gate.
    expect(await refundForJob('jr1', 'hold rejected')).toBe(false);
    expect(await getBalance(APP, USER)).toBe(5);

    const job = (await getJob('jr1'))!;
    expect(job.status).toBe('failed');
    // The hold's reason survives as the failure's reason, so the job reads the same
    // before and after it resolved.
    expect(job.failureKind).toBe('budget_exceeded');

    // The status flip is the gate. A second resolver must not produce a second refund.
    expect(await rejectHold('jr1', 'Not approved.')).toBe(false);
  });
});
