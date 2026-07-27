/**
 * Two limits with deliberately different consequences.
 *
 * Per DRAFT: a user reads the findings, edits, re-checks. After a couple of
 * assisted passes on the same report there is nothing more a model will add, so
 * it stops — with no wait and no penalty, because iterating is normal behaviour.
 *
 * Per USER across drafts: the backstop against cycling draft ids to farm
 * assisted reviews. Only this one starts a cooldown.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reserveAssistedReview, resetAssistAllowance, ASSIST_FREE_ATTEMPTS, ASSIST_USER_ATTEMPTS, getUserFlags } from '../src/stats/store.js';
import { queryUsers } from '../src/stats/store.js';

const A = 'fbizlab';
const U = 'u@x.com';

const record = async () => (await queryUsers({ appId: A }))[0];

afterEach(() => vi.useRealTimers());

describe('assisted-review allowance', () => {
  it('gives a draft its attempts, then simply stops — nothing to wait for', async () => {
    for (let i = 1; i <= ASSIST_FREE_ATTEMPTS; i++) {
      expect((await reserveAssistedReview(A, U, 'draft-1')).allowed).toBe(true);
    }
    const done = await reserveAssistedReview(A, U, 'draft-1');
    expect(done.allowed).toBe(false);
    expect(done.reason).toBe('attempts');
    // The point of the distinction: editing a request is normal, so there is no
    // penalty and no wait — the caller just proceeds deterministic-only.
    expect(done.retryAfterSeconds).toBe(0);
    expect((await record()).assistCooldownUntil).toBeUndefined();
    expect((await getUserFlags(A, U)).blocked).toBe(false);
  });

  it('a different report starts fresh', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U, 'draft-1');
    expect((await reserveAssistedReview(A, U, 'draft-2')).allowed).toBe(true);
  });

  it('retrying an exhausted draft stays refused and costs nothing', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U, 'draft-1');
    const before = (await record()).preflightCount;
    for (let i = 0; i < 5; i++) {
      expect((await reserveAssistedReview(A, U, 'draft-1')).reason).toBe('attempts');
    }
    // A refused attempt must not consume the per-user backstop either.
    expect((await record()).preflightCount).toBe(before);
  });

  it('cycling draft ids trips the per-user backstop, and only that starts a cooldown', async () => {
    let denied: Awaited<ReturnType<typeof reserveAssistedReview>> | undefined;
    for (let i = 0; i < ASSIST_USER_ATTEMPTS + 1; i++) {
      denied = await reserveAssistedReview(A, U, `draft-${i}`); // a fresh draft every time
    }
    expect(denied?.allowed).toBe(false);
    expect(denied?.reason).toBe('cooldown');
    expect(denied?.retryAfterSeconds).toBeGreaterThan(0);
    expect((await record()).assistCooldownUntil).toBeTruthy();
  });

  it('a cooldown refuses even a brand-new draft', async () => {
    for (let i = 0; i < ASSIST_USER_ATTEMPTS + 1; i++) await reserveAssistedReview(A, U, `draft-${i}`);
    expect((await reserveAssistedReview(A, U, 'totally-new')).reason).toBe('cooldown');
  });

  it('does not extend the cooldown when the user keeps trying', async () => {
    for (let i = 0; i < ASSIST_USER_ATTEMPTS + 1; i++) await reserveAssistedReview(A, U, `draft-${i}`);
    const first = await reserveAssistedReview(A, U, 'x');
    const second = await reserveAssistedReview(A, U, 'y');
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
    expect((await record()).assistCooldowns).toBe(1); // one cooldown earned, not three
  });

  it('escalates the pause the second time around', async () => {
    for (let i = 0; i < ASSIST_USER_ATTEMPTS + 1; i++) await reserveAssistedReview(A, U, `a-${i}`);
    const firstPause = (await record()).assistCooldownUntil!;

    vi.setSystemTime(new Date(Date.parse(firstPause) + 60_000));
    for (let i = 0; i < ASSIST_USER_ATTEMPTS + 1; i++) await reserveAssistedReview(A, U, `b-${i}`);
    const secondPause = (await record()).assistCooldownUntil!;

    expect(Date.parse(secondPause) - Date.now()).toBeGreaterThan(60 * 60 * 1000);
    expect((await record()).assistCooldowns).toBe(2);
  });

  it('generating ends the draft: the next report gets its attempts back', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U, 'draft-1');
    expect((await reserveAssistedReview(A, U, 'draft-1')).reason).toBe('attempts');

    await resetAssistAllowance(A, U);
    const after = await record();
    expect(after.assistCooldownUntil).toBeUndefined();
    expect(after.preflightCount).toBe(0);
    expect(after.assistCooldowns).toBe(0);
    // Even the same id is fresh — the draft it referred to has been generated.
    expect((await reserveAssistedReview(A, U, 'draft-1')).allowed).toBe(true);
  });

  it('lets the per-user window lapse for an idle user', async () => {
    for (let i = 0; i < ASSIST_USER_ATTEMPTS; i++) await reserveAssistedReview(A, U, `draft-${i}`);
    vi.setSystemTime(new Date(Date.now() + 9 * 60 * 60 * 1000));
    expect((await reserveAssistedReview(A, U, 'later')).allowed).toBe(true);
  });

  it('falls back to the per-user limit when no draft id is supplied', async () => {
    for (let i = 0; i < ASSIST_USER_ATTEMPTS; i++) {
      expect((await reserveAssistedReview(A, U)).allowed).toBe(true);
    }
    expect((await reserveAssistedReview(A, U)).reason).toBe('cooldown');
  });
});
