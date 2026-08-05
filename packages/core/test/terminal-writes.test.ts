/**
 * A job that somebody already resolved stays resolved.
 *
 * Three independent reviews landed on the same shape: this system's safety comes
 * from status-checked transactions — `approveHold`, `rejectHold`, `requeueJob`,
 * `parkJob`, `markCompleted` all refuse when the precondition no longer holds —
 * and three writes were plain `set()` calls living next to them. Each one is a
 * money or availability bug on its own, and they are one missing rule together:
 *
 *   - `markHeld` let a straggler run flip a resolved job back to `held`, erasing
 *     the record of the resolution, after which `approve` re-ran it and delivered
 *     a report whose credits had been refunded.
 *   - `setJobSlotHeld` flagged a slot on a job that had already finished, leaving
 *     the buyer's only in-flight slot held with no job left to release it.
 *   - `refundForJob` never read the job at all, so a refund could land on one that
 *     had just been re-queued — refunded and about to run.
 *
 * These assert the RULE, not the three incidents: a terminal job refuses each of
 * them, and a live job still accepts them.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { consumeCredits, getBalance, grantCredits, refundForJob } from '../src/credits/store.js';
import {
  createJob,
  getJob,
  markCompleted,
  markFailed,
  markHeld,
  markRunning,
  noteJobResolution,
} from '../src/jobs/firestore.js';
import { claimJobSlot, inFlightSlots, setJobSlotHeld } from '../src/jobs/slots.js';

const APP = 'app1';
const USER = 'buyer@x.com';

const hold = (reason: 'run_failed' | 'budget_exceeded' = 'run_failed') => ({
  reason,
  heldAt: new Date().toISOString(),
  spentUsd: 1,
});

async function seedJob(jobId: string): Promise<void> {
  await createJob({
    jobId,
    appId: APP,
    userId: USER,
    templateId: 'florida-business-for-sale',
    params: {},
    status: 'queued',
  } as never);
}

describe('a resolved job refuses every terminal-state write', () => {
  beforeEach(async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 100, idempotencyKey: `seed-${Math.random()}` });
  });

  it('markHeld cannot resurrect a failed job', async () => {
    await seedJob('t1');
    await markRunning('t1');
    await markFailed('t1', 'closed by an admin');

    // The straggler: still running, hits a hold path, tries to park itself.
    expect(await markHeld('t1', hold())).toBe(false);

    const job = (await getJob('t1'))!;
    expect(job.status).toBe('failed');
    // And the resolution's own record survives — the blind write overwrote it,
    // which is what made the job look like a fresh hold to `approve`.
    expect(job.hold?.reason).not.toBe('run_failed');
  });

  it('markHeld cannot retract a delivered job', async () => {
    await seedJob('t2');
    await markRunning('t2');
    await markCompleted('t2', []);

    expect(await markHeld('t2', hold())).toBe(false);
    expect((await getJob('t2'))!.status).toBe('completed');
  });

  it('markHeld cannot rewrite the hold an admin is deciding on', async () => {
    await seedJob('t7');
    await markRunning('t7');
    // The admin parks it with their own note and the real figure.
    await markHeld('t7', { reason: 'run_failed', heldAt: 'T1', spentUsd: 12.5, detail: 'admin note' });

    // The run nobody stopped reaches one of its own hold paths. Protecting only
    // completed/failed let it replace the whole record — with spentUsd 0, so the
    // job read as having cost nothing.
    expect(await markHeld('t7', { reason: 'budget_exceeded', heldAt: 'T2', spentUsd: 0, detail: 'ceiling' })).toBe(false);

    const job = (await getJob('t7'))!;
    expect(job.hold?.detail).toBe('admin note');
    expect(job.hold?.spentUsd).toBe(12.5);
    // And the reason is what an approval reads to decide whether to lift the cost
    // ceiling, so a straggler flipping it to `budget_exceeded` bought an uncapped run.
    expect(job.hold?.reason).toBe('run_failed');
  });

  it('markHeld still parks a job that is actually running', async () => {
    await seedJob('t3');
    await markRunning('t3');

    expect(await markHeld('t3', hold('budget_exceeded'))).toBe(true);
    expect((await getJob('t3'))!.status).toBe('held');
  });

  it('the slot flag refuses a job that already finished, so the counter cannot stick', async () => {
    await seedJob('t4');
    await markRunning('t4');
    await claimJobSlot(APP, USER, 1, { force: true });
    await markCompleted('t4', []);

    // Blind, this left `slotHeld: true` on a completed job and `inFlight` at 1
    // forever: release goes through the job, and the job is done.
    expect(await setJobSlotHeld('t4', true)).toBe(false);
    expect((await getJob('t4'))!.slotHeld).toBeFalsy();
  });

  it('refuses to flag a slot the job already holds', async () => {
    // The common case the status check missed: a job reaches `held` while its
    // release fails (all of them are best-effort), so the flag is still set. An
    // approval's forced claim takes the counter to 2, and if this returns true the
    // compensating release never fires — the job's own release leaves it at 1.
    await seedJob('t8');
    await markRunning('t8');
    await setJobSlotHeld('t8', true);
    await claimJobSlot(APP, USER, 1, { force: true });

    expect(await setJobSlotHeld('t8', true)).toBe(false);
  });

  it('the slot flag still works on a live job', async () => {
    await seedJob('t5');
    await markRunning('t5');
    expect(await setJobSlotHeld('t5', true)).toBe(true);
    expect((await getJob('t5'))!.slotHeld).toBe(true);
  });

  it('clearing the flag is always allowed, whatever the job did', async () => {
    await seedJob('t6');
    await markRunning('t6');
    await setJobSlotHeld('t6', true);
    await markCompleted('t6', []);

    // Releasing must never be blocked by the same guard that stops claiming —
    // that would strand the counter in the other direction.
    expect(await setJobSlotHeld('t6', false)).toBe(true);
  });
});

describe('a refund reads the job, and the ledger, not the caller', () => {
  beforeEach(async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 100, idempotencyKey: `seed2-${Math.random()}` });
  });

  it('refuses a job that is queued to run', async () => {
    await seedJob('r1');
    await consumeCredits(APP, USER, 4, 'r1');
    const before = await getBalance(APP, USER);

    // `resolve` failed it, an admin retry re-queued it, and only then does the
    // refund commit. Refunded AND about to run is a free report.
    await markFailed('r1', 'x');
    await createJob({ jobId: 'r1', appId: APP, userId: USER, templateId: 't', params: {}, status: 'queued' } as never);

    expect(await refundForJob('r1')).toBe(false);
    expect(await getBalance(APP, USER)).toBe(before);
  });

  it('refuses a job that is RUNNING, not only one that is queued', async () => {
    // The half the coverage missed. A refund landing on a job that is actively
    // running is the primary free-report race this guard exists for — the queued
    // case is the tidier one.
    await seedJob('r4');
    await consumeCredits(APP, USER, 4, 'r4');
    const before = await getBalance(APP, USER);
    await markRunning('r4');

    expect(await refundForJob('r4')).toBe(false);
    expect(await getBalance(APP, USER)).toBe(before);
  });

  it('still refunds a job that ended', async () => {
    await seedJob('r2');
    await consumeCredits(APP, USER, 4, 'r2');
    const spent = await getBalance(APP, USER);
    await markFailed('r2', 'x');

    expect(await refundForJob('r2')).toBe(true);
    expect(await getBalance(APP, USER)).toBe(spent + 4);
  });

  it('credits whoever paid, not whoever the job says it belongs to', async () => {
    // `refundForJob` no longer TAKES a recipient — a mismatched pair used to credit
    // the stranger and write the refund marker anyway, so the person who actually
    // paid could never be refunded at all, and the signature stopped inviting that
    // when the parameters were removed.
    //
    // What is still a live choice is WHICH record the owner is read from: the
    // consume entry, or the job document that sits right there in the same
    // transaction. So this makes the two disagree. The divergence is contrived —
    // nothing in the API can produce it — and it is here as the mutation control
    // for the invariant the function's comment states, not as a reachable path.
    await createJob({
      jobId: 'r3', appId: 'other-app', userId: 'stranger@x.com',
      templateId: 'florida-business-for-sale', params: {}, status: 'queued',
    } as never);
    await consumeCredits(APP, USER, 4, 'r3');
    await markFailed('r3', 'x');
    const payer = await getBalance(APP, USER);
    const other = await getBalance('other-app', 'stranger@x.com');

    expect(await refundForJob('r3')).toBe(true);

    expect(await getBalance(APP, USER), 'the payer was not made whole').toBe(payer + 4);
    expect(await getBalance('other-app', 'stranger@x.com'), 'the job document’s owner was credited').toBe(other);
  });
});

describe('the ledger refuses what a count cannot be', () => {
  it('rejects a non-positive consumption instead of raising the balance', async () => {
    await grantCredits({ appId: APP, userId: USER, credits: 10, idempotencyKey: `neg-${Math.random()}` });
    const before = await getBalance(APP, USER);

    // The sign lives in the entry TYPE, not the number. A "consumption" of -5 used
    // to pass the sufficiency check trivially and then add five.
    await expect(consumeCredits(APP, USER, -5, 'neg1')).rejects.toThrow(/positive whole numbers/i);
    await expect(consumeCredits(APP, USER, 0, 'neg2')).rejects.toThrow(/positive whole numbers/i);
    await expect(consumeCredits(APP, USER, 1.5, 'neg3')).rejects.toThrow(/positive whole numbers/i);

    expect(await getBalance(APP, USER)).toBe(before);
  });

  it('rejects a non-positive GRANT too, not only a consumption', async () => {
    // The guard is wider than its coverage was: a grant's delta is `+credits`, so a
    // negative one subtracts — and webhook metadata reaches `recordPurchase` by the
    // same door.
    await expect(grantCredits({ appId: APP, userId: USER, credits: -5, idempotencyKey: 'neg-grant' }))
      .rejects.toThrow(/positive whole numbers/i);
    await expect(grantCredits({ appId: APP, userId: USER, credits: 2.5, idempotencyKey: 'frac-grant' }))
      .rejects.toThrow(/positive whole numbers/i);
  });

  it('scopes a grant key to the person it grants to', async () => {
    // One global namespace meant the same key for two users silently no-opped the
    // second: `applied: false` if the admin looked, and nothing at all if not.
    await grantCredits({ appId: APP, userId: 'a@x.com', credits: 7, idempotencyKey: 'welcome-2026' });
    await grantCredits({ appId: APP, userId: 'b@x.com', credits: 7, idempotencyKey: 'welcome-2026' });

    expect(await getBalance(APP, 'a@x.com')).toBe(7);
    expect(await getBalance(APP, 'b@x.com')).toBe(7);
  });

  it('scopes the grant key by APP too, not just by user', async () => {
    // The other axis, and the one a partial revert walked straight through: the
    // same person in two apps with the same key had the second grant silently
    // no-op — which is the bug the scoping fixed, one axis over.
    await grantCredits({ appId: 'app-one', userId: 'same@x.com', credits: 7, idempotencyKey: 'welcome-2026' });
    await grantCredits({ appId: 'app-two', userId: 'same@x.com', credits: 7, idempotencyKey: 'welcome-2026' });

    expect(await getBalance('app-one', 'same@x.com')).toBe(7);
    expect(await getBalance('app-two', 'same@x.com')).toBe(7);
  });

  it('still refuses the same key twice for the SAME person', async () => {
    await grantCredits({ appId: APP, userId: 'c@x.com', credits: 7, idempotencyKey: 'welcome-2026' });
    await grantCredits({ appId: APP, userId: 'c@x.com', credits: 7, idempotencyKey: 'welcome-2026' });
    expect(await getBalance(APP, 'c@x.com')).toBe(7);
  });
});

describe('the resolution note obeys the same rule', () => {
  // `noteJobResolution` upgrades the buyer's closing sentence to "…and the credits
  // were returned", after the refund lands. It is a terminal write like the rest,
  // and its status check had no test: removing it left both suites green.
  const seed = (jobId: string) =>
    createJob({ jobId, appId: APP, userId: USER, template: 't', params: {}, status: 'queued' } as never);

  it('refuses a job that is no longer failed', async () => {
    // The reachable case: `retry` requeues the job between the refund and this
    // write, and the note would then tell a buyer whose report is about to run
    // that it could not be completed and their credits came back.
    await seed('nr1');
    await markRunning('nr1');
    expect(await noteJobResolution('nr1', 'credits returned')).toBe(false);
    expect((await getJob('nr1'))!.error).toBeUndefined();
  });

  it('still writes it on the job it was meant for', async () => {
    // The control, so "refuses everything" cannot pass.
    await seed('nr2');
    await markFailed('nr2', 'closed');
    expect(await noteJobResolution('nr2', 'credits returned')).toBe(true);
    expect((await getJob('nr2'))!.error).toBe('credits returned');
  });
});

describe('the slot counter can never go negative, and never flags a parked job', () => {
  const seed = (jobId: string, status = 'queued') =>
    createJob({ jobId, appId: APP, userId: USER, template: 't', params: {}, status } as never);

  it('floors the counter at zero when a release outnumbers the claims', async () => {
    // The `slotHeld` flag stops a SECOND release through the same job, which is why
    // the floors looked redundant and could both be deleted with 388 tests green.
    // They are not the same guard: `releaseUnclaimedSlot` is a compensating release
    // that goes straight to the counter with no job to consult, so a retry whose
    // flag write failed decrements a counter nobody incremented — and a negative
    // counter uncaps concurrent spend for that buyer.
    const slots = await import('../src/jobs/slots.js');
    await slots.releaseUnclaimedSlot(APP, USER);
    await slots.releaseUnclaimedSlot(APP, USER);
    expect(await slots.inFlightSlots(APP, USER)).toBe(0);

    // …and the cap still bites afterwards, which is what a negative counter breaks.
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    expect(await slots.inFlightSlots(APP, USER)).toBe(1);
  });

  it('floors the OTHER release too — the one that goes through a job', async () => {
    // The comment above says both floors could be deleted with 388 tests green and
    // that they are not the same guard. It then covered one of them.
    //
    // `releaseJobSlot` reads the counter through the job, so it looked protected by
    // `slotHeld`. It is not: the flag says this JOB owes a slot back, and it says
    // nothing about whether the COUNTER has one to give. A compensating release
    // (`releaseUnclaimedSlot`, no job to consult) can empty the counter first, and
    // then a perfectly ordinary terminal release takes it to -1 — which uncaps
    // concurrent spend for that buyer until something claims the deficit back.
    await seed('sl0');
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('sl0', true);
    // The counter is emptied by the path that does not go through this job.
    await slots.releaseUnclaimedSlot(APP, USER);
    expect(await slots.inFlightSlots(APP, USER), 'the premise: nothing left to release').toBe(0);

    await slots.releaseJobSlot('sl0');
    expect(await slots.inFlightSlots(APP, USER)).toBe(0);

    // …and the cap still bites, which is what a negative counter breaks.
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    expect(await slots.inFlightSlots(APP, USER)).toBe(1);
  });

  it('refuses to flag the slot of a parked job', async () => {
    // A parked job is explicitly NOT in flight — it spends nothing and waits on us.
    // Flagging its slot is how an approval's forced claim stuck at 1 when a
    // straggler parked the job in between, and the disjunct that prevents it had no
    // test: removing `|| status === 'held'` left the whole core suite green.
    await seed('sl1');
    await markHeld('sl1', { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });
    const slots = await import('../src/jobs/slots.js');

    expect(await slots.setJobSlotHeld('sl1', true)).toBe(false);
    expect((await getJob('sl1'))!.slotHeld).not.toBe(true);
  });

  it('still flags a live one', async () => {
    // The control: "refuses everything" would pass the assertion above.
    await seed('sl2');
    const slots = await import('../src/jobs/slots.js');
    expect(await slots.setJobSlotHeld('sl2', true)).toBe(true);
  });
});

describe('a park that was REFUSED hands nothing back', () => {
  // `markHeld` refuses a job somebody already resolved, and refuses a dispatch
  // that no longer owns it. Its answer was discarded at all five park sites, and
  // what follows a park is not bookkeeping: `releaseJobSlot` keys on the job's
  // `slotHeld` flag and NOT on the dispatch, so a refused park still freed the
  // live run's slot and the buyer could start a second report while the first was
  // going. Four of the five were fixed together; this covers the fifth, which
  // `parkAndRethrow` owns — the path every unexpected throw takes.
  const seed = (jobId: string, status = 'queued') =>
    createJob({ jobId, appId: APP, userId: USER, template: 't', params: {}, status } as never);

  it('does not release a slot for a job somebody already resolved', async () => {
    await seed('pk1');
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('pk1', true);
    // Resolved by a person while this run was still going. `markHeld` refuses.
    await markFailed('pk1', 'closed by an admin');

    const refused = await markHeld('pk1', { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 });
    expect(refused, 'the premise: the park has to be refused').toBe(false);
    // …and the slot is still the live run's.
    expect(await slots.inFlightSlots(APP, USER)).toBe(1);
  });

  it('still hands it back when the park sticks — the control', async () => {
    // Without this, "never release" passes the case above and locks the buyer out
    // of the product for as long as nobody looks at their job.
    await seed('pk2');
    const slots = await import('../src/jobs/slots.js');
    await slots.claimJobSlot(APP, USER, 1, { force: true });
    await slots.setJobSlotHeld('pk2', true);

    expect(await markHeld('pk2', { reason: 'run_failed', heldAt: new Date().toISOString(), spentUsd: 0 })).toBe(true);
    await slots.releaseJobSlot('pk2');
    expect(await slots.inFlightSlots(APP, USER)).toBe(0);
  });
});
