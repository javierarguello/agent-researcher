/**
 * No job may be allowed to cost more than the report it produced earned.
 *
 * Both modes shared one deployment-wide ceiling of $20 (D1). Against a real
 * comprehensive run at **$3.885843** (`out/local-aa4b3edf/trace.json`) that caught
 * nothing short of a catastrophe — and, worse, it sat ABOVE the revenue of both
 * modes, so a job that reached the ceiling was a loss the moment it did: $20 spent
 * against $15.48 earned by a comprehensive, or $4.30 by an essential.
 *
 * The ceiling is HELD, not failed — a job that reaches it parks for an admin with
 * the credits already consumed. So a ceiling that is too low costs attention and a
 * ceiling that is too high costs money, and this file pins the side that costs
 * money, plus the ordering that a fat finger would break.
 *
 * `CREDIT_FLOOR_USD` is the one external fact copied into the repo (the packs are
 * in Stripe). If the catalog moves and nobody updates it, these assertions are
 * measured against a stale floor — which is why the constant carries the date and
 * the three pack prices it was read from.
 */
import { describe, it, expect } from 'vitest';
import { CREDIT_FLOOR_USD, REPORT_MODES, creditsForMode, maxCostForMode, resolveMode } from '../src/mode.js';
import { config } from '../src/config.js';
import { floridaBusinessForSale as tpl } from '../src/templates/florida-business-for-sale.js';

const modeOf = (key: 'essential' | 'comprehensive') => resolveMode(tpl.modes, key);

describe('the per-job ceiling, per mode', () => {
  it.each(REPORT_MODES)('%s can never be allowed to cost more than it earns', (key) => {
    const { config: mode } = modeOf(key);
    const ceiling = maxCostForMode(mode, config.workflow.maxJobCostUsd);
    const earns = creditsForMode(mode, key) * CREDIT_FLOOR_USD;
    expect(
      ceiling,
      `${key}: a job may burn $${ceiling.toFixed(2)} for a report that earns $${earns.toFixed(2)} ` +
        `at the cheapest pack — every job that reaches the ceiling is a loss.`,
    ).toBeLessThan(earns);
  });

  it('binds tighter than the deployment default, in both modes', () => {
    // The whole point: the flagship knows its own cost profile, so the $20 fallback
    // — which exists for a model that does not — must not be what applies.
    for (const key of REPORT_MODES) {
      const { config: mode } = modeOf(key);
      expect(mode.maxCostUsd, `${key} declares no ceiling of its own`).toBeDefined();
      expect(maxCostForMode(mode, config.workflow.maxJobCostUsd)).toBeLessThan(config.workflow.maxJobCostUsd);
    }
  });

  it('lets the cheap mode burn less than the expensive one, per report AND per credit', () => {
    // Per report is the obvious one. Per credit is the one that caught the shape of
    // D1 in the first place: essential is allowed MORE headroom per credit than
    // comprehensive ($0.70 vs $0.56), which is the arithmetic saying five credits
    // does not buy enough room — not a bug, a bound worth seeing move.
    const e = modeOf('essential');
    const c = modeOf('comprehensive');
    const ce = maxCostForMode(e.config, config.workflow.maxJobCostUsd);
    const cc = maxCostForMode(c.config, config.workflow.maxJobCostUsd);
    expect(ce).toBeLessThan(cc);
    expect(ce / creditsForMode(e.config, 'essential')).toBeLessThan(CREDIT_FLOOR_USD);
    expect(cc / creditsForMode(c.config, 'comprehensive')).toBeLessThan(CREDIT_FLOOR_USD);
  });

  it('leaves room above what a job actually costs, measured', () => {
    // The other side of the trade. A ceiling below the honest cost holds every job.
    // $3.885843 is a REAL completed comprehensive (`out/local-aa4b3edf/trace.json`);
    // essential has no real run and is inferred at ~$1.92 by scaling the honest
    // fixture's $1.31 by the 1.47x the fixture under-estimates comprehensive by.
    const HONEST = { comprehensive: 3.885843, essential: 1.92 } as const;
    for (const key of REPORT_MODES) {
      const { config: mode } = modeOf(key);
      const ceiling = maxCostForMode(mode, config.workflow.maxJobCostUsd);
      expect(ceiling, `${key}: the ceiling is below what an HONEST job costs`).toBeGreaterThan(HONEST[key]);
      // …and at least 1.5x it, or an ordinary run with a slow agent parks for a human.
      expect(ceiling / HONEST[key], `${key}: less than 1.5x the honest cost`).toBeGreaterThan(1.5);
    }
  });
});
