/**
 * The two switches that turn the whole product off, and the one that points it at
 * live money by accident.
 *
 * `APP_ENV=local` is the highest-consequence string in this system. It disables the
 * auth hook entirely (identity comes from `x-app-id`/`x-user-id`/`x-role`, so
 * anyone is an admin for the price of a header), `requireAdmin`, the captcha, the
 * credit checks and the rate limits — all of it, in one variable. It was protected
 * by a safe default and one line of `deploy.sh`, and by a `log.warn` at startup,
 * which is an observation rather than a refusal.
 *
 * `TURNSTILE_SECRET` has the same shape: absent, `captchaEnabled()` is false and
 * every flow that asked for a captcha silently has none. No error, nothing in the
 * logs, and the flows list still says it is protected.
 *
 * This repo's own note about the storage buckets says it best: nothing is public
 * today, and that is a current FACT rather than a PROPERTY. These are the same
 * sentence about configuration, so they are asserted rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import { deploymentSafetyError } from '../src/startup-guards.js';

const OK = {
  appEnv: 'production',
  deployed: true,
  captchaSecret: '0x-secret',
  captchaFlows: new Set(['register', 'login']),
  stripeKey: 'sk_test_x',
};

describe('deploymentSafetyError', () => {
  it('lets a correctly configured deployment start', () => {
    expect(deploymentSafetyError(OK)).toBeNull();
  });

  it('refuses to run with auth disabled on a deployed service', () => {
    const err = deploymentSafetyError({ ...OK, appEnv: 'local' });
    expect(err, 'a deployed service came up with auth disabled').toBeTruthy();
    expect(err).toMatch(/APP_ENV/);
    // Names what it actually costs, because whoever reads this is mid-incident.
    expect(err).toMatch(/x-role/);
  });

  it('refuses when the captcha is asked for and not configured', () => {
    const err = deploymentSafetyError({ ...OK, captchaSecret: '' });
    expect(err, 'every guarded flow was silently unguarded').toBeTruthy();
    expect(err).toMatch(/TURNSTILE_SECRET/);
    expect(err, 'the message does not say which flows believed they were protected').toMatch(/register/);
  });

  it('refuses a local run pointed at live money', () => {
    // The other direction, and the one a laptop reaches: not a deployed service at
    // all, but `APP_ENV=local` with a LIVE Stripe key — auth off, admin off, and a
    // real catalog to write to.
    const err = deploymentSafetyError({ ...OK, appEnv: 'local', deployed: false, stripeKey: 'sk_live_abc' });
    expect(err).toBeTruthy();
    expect(err).toMatch(/sk_live/);
  });

  it('leaves ordinary local development alone', () => {
    // The whole point of the switch, and it must keep working: a laptop, no Cloud
    // Run, a test key, and no captcha secret to speak of.
    expect(
      deploymentSafetyError({ appEnv: 'local', deployed: false, captchaSecret: '', captchaFlows: new Set(['register']), stripeKey: 'sk_test_x' }),
    ).toBeNull();
  });

  it('does not invent a captcha requirement nobody asked for', () => {
    // An empty TURNSTILE_FLOWS is a deliberate statement, not an oversight, and a
    // guard that refuses to start over it would be a guard that gets deleted.
    expect(deploymentSafetyError({ ...OK, captchaSecret: '', captchaFlows: new Set() })).toBeNull();
  });
});
