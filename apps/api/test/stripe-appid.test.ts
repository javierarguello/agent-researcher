/**
 * The guards on the two ids interpolated into Stripe's search DSL, where a stray
 * quote breaks out of the literal.
 *
 * It gets its own file because `payments.test.ts` mocks `../src/stripe.js`
 * wholesale — including a *copy* of this regex. A test that re-implements the
 * thing under test proves nothing: loosen the real one and the copy stays green.
 * This imports the real export.
 */
import { describe, it, expect } from 'vitest';
import { isValidAppId, isValidPlanId } from '../src/stripe.js';

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

describe('isValidPlanId', () => {
  // Round 11, `money-2`. `findProduct` builds ONE query string out of BOTH ids:
  //
  //   `active:'true' AND metadata['appId']:'${appId}' AND metadata['planId']:'${planId}'`
  //
  // The comment above `APP_ID_RE` explains exactly why the first is validated, and
  // the second — on the same line, from a route schema that only caps it at
  // maxLength 128 — had no guard at all. Admin-gated, so it grants no capability an
  // admin lacks (an admin may already write any app's catalog); what it does is
  // break a LIVE billing catalog by accident.
  it('accepts the ids the storefront actually sells', () => {
    for (const id of ['scout', 'investor', 'syndicate', 'legacy', 'p1', 'pack-2', 'my_pack', '0123']) {
      expect(isValidPlanId(id), id).toBe(true);
    }
  });

  it('rejects anything that could escape the Stripe query literal', () => {
    for (const id of [
      "x' OR metadata['planId']:'scout", // the injection: findProduct returns another row
      "bob's-pack",                       // and the accident, which is the likelier one
      'x"y', 'x\\y', 'a b', 'x:y', "x'", 'x`y', 'x\ny',
    ]) {
      expect(isValidPlanId(id), id).toBe(false);
    }
  });

  it('rejects the shapes that would create an unfindable live product', () => {
    // The consequence worth naming: a BALANCED-quote planId does not 500. The
    // search silently matches nothing, so the existence check passes, a second live
    // buyer-visible product is created, and its stored planId can never be re-found
    // by the same query -- uneditable and unarchivable through the API, recoverable
    // only in the Stripe dashboard.
    for (const id of ['Scout', 'x'.repeat(65), '', '-leading', '.dotted']) {
      expect(isValidPlanId(id), id).toBe(false);
    }
  });
});

/** A stand-in for the auto-generated app id, which must keep working. */
function randomUuid(): string {
  return '0f8fad5b-d9cb-469f-a165-70867728950e';
}
