/**
 * `isValidAppId` guards the one place an app id is interpolated into Stripe's
 * search DSL, where a stray quote breaks out of the literal.
 *
 * It gets its own file because `payments.test.ts` mocks `../src/stripe.js`
 * wholesale — including a *copy* of this regex. A test that re-implements the
 * thing under test proves nothing: loosen the real one and the copy stays green.
 * This imports the real export.
 */
import { describe, it, expect } from 'vitest';
import { isValidAppId } from '../src/stripe.js';

describe('isValidAppId', () => {
  it('accepts the ids we actually issue', () => {
    for (const id of ['fbizlab', 'admin', 'a', 'app-2', 'my_app', '0123', randomUuid()]) {
      expect(isValidAppId(id), id).toBe(true);
    }
  });

  it('rejects anything that could escape the Stripe query literal', () => {
    for (const id of [
      "x' OR active:'true", // the injection itself
      'x"y',
      'x\\y',
      'a b',
      'x:y',
      "x'",
      'x`y',
      'x\ny',
    ]) {
      expect(isValidAppId(id), id).toBe(false);
    }
  });

  it('rejects shapes the admin API must therefore not create', () => {
    // These are the gap that used to exist between the admin `pattern` and this
    // regex: an app created with one of them was silently unbillable.
    for (const id of ['Acme', 'floridabizlabs.com', '-leading', '_leading', '.dotted', 'x'.repeat(65), '']) {
      expect(isValidAppId(id), id).toBe(false);
    }
  });
});

/** A stand-in for the auto-generated app id, which must keep working. */
function randomUuid(): string {
  return '0f8fad5b-d9cb-469f-a165-70867728950e';
}
