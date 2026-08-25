/**
 * One Postmark call is bounded in time.
 *
 * Round 11, `postmark-await-1` / `email-hang-1` — two findings, one defect, from
 * two different slices. `sendAppEmail` is AWAITED in both places it matters:
 *
 *   - `POST /research`, right before the 202, under a comment that says "the
 *     buyer's 202 must not wait on Postmark". Awaited-WITH-CATCH is half of that
 *     promise: the request cannot turn into a 500, and it very much does wait.
 *   - the Stripe webhook, which sends the purchase receipt before answering.
 *
 * `fetch` has no request timeout. undici gives up on HEADERS after five minutes and
 * on a stalled body never, so an unbounded call is a Postmark incident turning into
 * a buyer watching a spinner over a job that is already queued and running, and
 * into webhook replies slow enough for Stripe to retry a delivery still in flight.
 *
 * Bounding the wait is the fix rather than dropping the `await`, deliberately: on
 * Cloud Run, CPU is throttled outside a request, so a promise floated after the
 * response is a promise that may never finish sending the mail.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { sendAppEmail } from '../src/email/postmark.js';
import { writableConfig } from './writable-config.js';

const app = { appId: 'fbizlab', name: 'F', emailFrom: 'F <no-reply@f.test>' } as never;
const send = () => sendAppEmail({ app, to: 'buyer@x.test', subject: 's', htmlBody: '<p>h</p>' });

const realFetch = globalThis.fetch;
const realToken = writableConfig.email.postmarkToken;
const realTimeout = writableConfig.email.sendTimeoutMs;

afterEach(() => {
  globalThis.fetch = realFetch;
  writableConfig.email.postmarkToken = realToken;
  writableConfig.email.sendTimeoutMs = realTimeout;
  vi.restoreAllMocks();
});

describe('sendAppEmail', () => {
  it('gives up on a Postmark that never answers, instead of holding the caller', async () => {
    writableConfig.email.postmarkToken = 'test-token';
    writableConfig.email.sendTimeoutMs = 50;

    // A server that accepted the connection and then went quiet — the shape undici
    // will not abandon on its own, and the one a real incident produces.
    let aborted = false;
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('The operation was aborted.', 'TimeoutError'));
        });
        // A safety net for the MUTATION, not for the fix. With no signal nothing
        // ever cancels this call, so without the net the test would sit until
        // vitest's own testTimeout and report a timeout — true, but it names the
        // runner rather than the defect. This settles it late enough that `aborted`
        // is still false, so the assertion that fails is the one that means
        // something: nothing carried a signal. Measured: mutation reds in 1.5s.
        setTimeout(() => reject(new Error('never abandoned')), 1500);
      })) as typeof fetch;

    // Raced against a timer rather than simply awaited. Without the signal this
    // call never settles at all, so a plain `await` makes the MUTATION hang the
    // suite instead of failing it — and a test that hangs takes the gate down the
    // way `d-legit`'s flake did, rather than reporting anything. Measured: with
    // `signal` removed, this line reds in ~1s; the same test written as a bare
    // await had to be killed at 60s with no output.
    const started = Date.now();
    await expect(send()).rejects.toThrow();
    // Not "it threw" — an unbounded fetch throws too, eventually. It is that the
    // caller was released on OUR schedule, by a cancellation we asked for.
    expect(aborted, 'nothing carried a signal, so nothing could be cancelled').toBe(true);
    expect(Date.now() - started, 'released, but not by the timeout').toBeLessThan(500);
  });

  it('passes a signal on the ordinary path too, so the bound is not conditional', async () => {
    writableConfig.email.postmarkToken = 'test-token';
    let sawSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal;
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as typeof fetch;

    await send();
    expect(sawSignal, 'the successful path sends unbounded').toBeInstanceOf(AbortSignal);
  });
});
