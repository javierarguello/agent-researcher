/**
 * The queue must keep re-dispatching a job for longer than the engine takes to
 * finish giving up on it.
 *
 * Three numbers have to agree and they live in three files: `maxJobAttempts` (the
 * dispatch at which `runJob` stops returning `incomplete` and delivers a degraded
 * report), `dispatchBudgetSeconds` (the wall clock one dispatch may spend), and the
 * Cloud Tasks queue's `--max-retry-duration` in `infra/setup-gcp.sh`.
 *
 * When the window is the SHORTER of the two, the ending has no owner:
 * `packages/core/src/jobs/firestore.ts` (`parkJob`) describes it — "the worker
 * returned a retryable status, the queue dropped the task, and nothing ever touched
 * the job again: `running` forever, the buyer's slot held, the credits spent, and
 * `retry` refusing because the job looks alive." At 10800s it did not fit: seven
 * dispatches of 1500s plus their backoff is 11730s before the eighth even starts.
 *
 * Read out of the shell script rather than duplicated here, because a constant
 * copied next to the thing it is supposed to check is not a check.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { config } from '@agent-researcher/core';

const script = readFileSync(new URL('../../../infra/setup-gcp.sh', import.meta.url), 'utf8');

const flag = (name: string): number => {
  const m = script.match(new RegExp(`--${name}=(\\d+)s?\\b`));
  expect(m, `--${name} is not in setup-gcp.sh`).toBeTruthy();
  return Number(m![1]);
};

describe('the Cloud Tasks retry window outlives the engine’s own give-up policy', () => {
  it('fits every dispatch maxJobAttempts allows, work and backoff', () => {
    const window = flag('max-retry-duration');
    const minBackoff = flag('min-backoff');
    const maxBackoff = flag('max-backoff');
    const attempts = config.workflow.maxJobAttempts;
    const budget = config.workflow.dispatchBudgetSeconds;

    // Cloud Tasks doubles the backoff from `min` up to the `max` cap.
    let backoff = 0;
    for (let i = 0, b = minBackoff; i < attempts - 1; i++, b = Math.min(b * 2, maxBackoff)) backoff += b;

    const needed = (attempts - 1) * budget + backoff;
    expect(
      window,
      `the queue gives up after ${window}s; reaching dispatch ${attempts} needs ${needed}s ` +
        `(${attempts - 1} x ${budget}s of work + ${backoff}s of backoff). A job that runs out of window ` +
        'stays `running` forever with the credits spent — see `parkJob`.',
    ).toBeGreaterThan(needed);
  });

  it('allows at least as many attempts as the engine will use', () => {
    // A window long enough is not enough on its own: `--max-attempts` is a second,
    // independent way for the queue to stop before `maxJobAttempts` is reached.
    expect(flag('max-attempts')).toBeGreaterThanOrEqual(config.workflow.maxJobAttempts);
  });

  it('gives a dispatch less wall clock than the platform will allow it', () => {
    // `dispatchBudgetSeconds` only helps if it fires BEFORE the process is killed.
    // Cloud Tasks caps an HTTP dispatch deadline at 1800s and that is also the
    // worker's Cloud Run `--timeout`, so neither can be raised to buy a longer job.
    expect(config.workflow.dispatchBudgetSeconds).toBeLessThan(config.tasks.dispatchDeadlineSeconds);
    expect(config.tasks.dispatchDeadlineSeconds).toBeLessThanOrEqual(1800);
  });
});
