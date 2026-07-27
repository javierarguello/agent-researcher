/**
 * The economics rule for the assisted (LLM) review: it may only be spent where it
 * can plausibly turn into a generated report. A user who previews and previews
 * without ever generating loses the assisted layer for a while — escalating each
 * time — and gets it back by generating.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reserveAssistedReview, resetAssistAllowance, ASSIST_FREE_ATTEMPTS, getUserFlags } from '../src/stats/store.js';
import { queryUsers } from '../src/stats/store.js';

const A = 'fbizlab';
const U = 'u@x.com';

const record = async () => (await queryUsers({ appId: A }))[0];

afterEach(() => vi.useRealTimers());

describe('assisted-review allowance', () => {
  it('allows the free attempts, then pauses instead of erroring', async () => {
    for (let i = 1; i <= ASSIST_FREE_ATTEMPTS; i++) {
      expect((await reserveAssistedReview(A, U)).allowed).toBe(true);
    }
    const paused = await reserveAssistedReview(A, U);
    expect(paused.allowed).toBe(false);
    expect(paused.retryAfterSeconds).toBeGreaterThan(0);
    // Pausing the feature is NOT blocking the account.
    expect((await getUserFlags(A, U)).blocked).toBe(false);
  });

  it('does not extend the pause when the user keeps trying', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U);
    const first = await reserveAssistedReview(A, U);
    const second = await reserveAssistedReview(A, U);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
    expect((await record()).assistCooldowns).toBe(1); // one cooldown earned, not three
  });

  it('escalates the pause the second time around', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U);
    const firstPause = (await record()).assistCooldownUntil!;

    // Let the first pause lapse, then burn the allowance again.
    vi.setSystemTime(new Date(Date.parse(firstPause) + 60_000));
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U);
    const secondPause = (await record()).assistCooldownUntil!;

    const secondLen = Date.parse(secondPause) - Date.now();
    expect(secondLen).toBeGreaterThan(60 * 60 * 1000); // longer than the first (1h) step
    expect((await record()).assistCooldowns).toBe(2);
  });

  it('generating clears the pause and pays back one escalation step', async () => {
    for (let i = 0; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U);
    expect((await record()).assistCooldownUntil).toBeTruthy();

    await resetAssistAllowance(A, U);
    const after = await record();
    expect(after.assistCooldownUntil).toBeUndefined();
    expect(after.preflightCount).toBe(0);
    expect(after.assistCooldowns).toBe(0);
    expect((await reserveAssistedReview(A, U)).allowed).toBe(true);
  });

  it('lets the counting window lapse for an idle user', async () => {
    for (let i = 1; i <= ASSIST_FREE_ATTEMPTS; i++) await reserveAssistedReview(A, U);
    // Past the window, the count restarts rather than tipping into a pause.
    vi.setSystemTime(new Date(Date.now() + 9 * 60 * 60 * 1000));
    const next = await reserveAssistedReview(A, U);
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });
});
