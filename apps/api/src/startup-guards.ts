/**
 * Refusals the process makes about itself, before it serves anything.
 *
 * Everything else in this API guards a REQUEST. These guard the deployment, and
 * they exist because the two most consequential settings here were protected by a
 * safe default and nothing else — which is a current fact, not a property. The same
 * sentence this repo already wrote about the storage buckets.
 *
 * They are refusals rather than warnings on purpose. `APP_ENV=local` already logged
 * a warning at startup and that is exactly what a warning is worth here: the service
 * comes up, serves traffic, and the one line saying auth is off scrolls away.
 */

export interface DeploymentFacts {
  /** `APP_ENV`. Anything other than `local` enforces auth. */
  appEnv: string;
  /**
   * Whether this process is running as a deployed service.
   *
   * `K_SERVICE` is set by Cloud Run on every instance and by nothing on a laptop,
   * so it answers "am I in front of the public" without a second variable anybody
   * has to remember to set — which is the class of mistake being guarded here.
   */
  deployed: boolean;
  /** `TURNSTILE_SECRET`. Empty means `captchaEnabled()` is false and every flow below is unguarded. */
  captchaSecret: string;
  /** The flows `TURNSTILE_FLOWS` claims are captcha-protected. */
  captchaFlows: ReadonlySet<string>;
  /** `STRIPE_SECRET_KEY`, read only for its `sk_live_` prefix. */
  stripeKey: string;
}

/**
 * The reason this process must not serve traffic, or `null`.
 *
 * Pure, and takes its inputs rather than reading `config`, so the refusals can be
 * asserted without standing up a server or mutating global configuration.
 */
export function deploymentSafetyError(facts: DeploymentFacts): string | null {
  const local = facts.appEnv === 'local';

  // 1. Auth disabled in front of the public. `jwtAuth` returns early on `local` and
  //    takes identity from `x-app-id` / `x-user-id` / `x-role`, and `requireAdmin`
  //    returns unconditionally — so every admin route is open to a header.
  if (local && facts.deployed) {
    return (
      'Refusing to start: APP_ENV=local on a deployed service (K_SERVICE is set). ' +
      'That disables authentication entirely — identity would come from the x-app-id / x-user-id / x-role ' +
      'headers, so any caller sending x-role: admin gets every admin route — and it also disables the ' +
      'captcha, the credit checks and the rate limits. Set APP_ENV=production.'
    );
  }

  // 2. A live catalog behind a process with no auth. Not a deployed service, so (1)
  //    does not fire — a laptop pointed at real money, which is how a test session
  //    ends up writing the storefront people buy from.
  if (local && facts.stripeKey.startsWith('sk_live_')) {
    return (
      'Refusing to start: APP_ENV=local with a LIVE Stripe key (sk_live_…). ' +
      'Auth and requireAdmin are disabled in this mode, so this process could write the real catalog. ' +
      'Use a test key locally, or set APP_ENV=production.'
    );
  }

  // 3. A captcha that is declared and absent. `verifyCaptcha` returns ok for every
  //    caller when the secret is empty, so register / login / reset / contact /
  //    research go unprotected while the flows list still says otherwise. An EMPTY
  //    flows list is a deliberate statement and is left alone.
  if (!local && facts.captchaFlows.size > 0 && !facts.captchaSecret.trim()) {
    const flows = [...facts.captchaFlows].join(', ');
    return (
      `Refusing to start: TURNSTILE_FLOWS declares captcha on [${flows}] and TURNSTILE_SECRET is not set, ` +
      'so every one of those flows would be unprotected with nothing in the logs to say so. ' +
      'Set TURNSTILE_SECRET, or clear TURNSTILE_FLOWS to state that this deployment runs without a captcha.'
    );
  }

  return null;
}
