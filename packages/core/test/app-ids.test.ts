/**
 * An app id is a key, and `createApp` is where it stops being anything else (N10).
 *
 * There are two creation surfaces — `POST /admin/apps` and the CLI (`npm run apps
 * create --appId=…`) — and until now only the first validated anything. The route's
 * JSON schema carries the rule; the CLI calls straight into `createApp`, which took
 * whatever it was handed and used it as the Firestore document id.
 *
 * The cost of a bad one is invisible and permanent. Balances, credentials and stats
 * are keyed `<appId>__<userId>`, so an id containing `_` makes two identities share
 * one key; and `isValidAppId` (apps/api/src/stripe.ts) guards the Stripe search DSL,
 * so an id outside its shape is silently unbillable — no catalog, no checkout, and
 * nothing in the logs saying why. Neither shows up until someone is already using
 * the app.
 *
 * The literals below are the same vocabulary `apps/api/test/stripe-appid.test.ts`
 * uses, on purpose: the two ends of the rule should agree on concrete ids rather
 * than on a shared regex that could be loosened once and pass both.
 */
import { describe, it, expect } from 'vitest';
import { createApp, getApp } from '../src/apps/store.js';

describe('createApp refuses an id the product cannot key on', () => {
  it('rejects the shapes that break billing or collapse two identities', async () => {
    const bad = [
      'my_app', // the expensive one: `<appId>__<userId>` now has three segments
      'Acme',
      'floridabizlabs.com',
      '-leading',
      '_leading',
      '.dotted',
      'a b',
      "x' OR active:'true",
      'x'.repeat(65),
      '',
    ];
    for (const appId of bad) {
      await expect(createApp({ appId, name: 'x' }), appId).rejects.toThrow(/invalid appid/i);
      expect(await getApp(appId), `${appId} was written anyway`).toBeUndefined();
    }
  });

  it('still creates the ids we actually issue', async () => {
    // The control. "Always throws" would pass everything above and take the CLI
    // with it.
    for (const appId of ['fbizlab', 'admin', 'a', 'app-2', '0123']) {
      expect((await createApp({ appId, name: appId })).appId, appId).toBe(appId);
    }
  });

  it('and still generates one when the caller does not pick', async () => {
    // The default path goes through the same check, so a generated id that failed
    // it would break every `apps create` with no `--appId`.
    const created = await createApp({ name: 'Generated' });
    expect(created.appId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getApp(created.appId))!.name).toBe('Generated');
  });
});
