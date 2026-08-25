/**
 * No job may be allowed to cost more than the report it produced earned.
 *
 * Both modes shared a flat $20 — 5× a real comprehensive run ($3.885843,
 * `out/local-aa4b3edf/trace.json`) and, the part that mattered, ABOVE what either
 * report earns. Reaching the ceiling WAS the loss (D1).
 *
 * The ceiling is no longer a number anybody types. It is
 * `credits × creditFloorUsd × (1 − expectedProfitPct/100)`, and all three inputs are
 * per-model and live in Firestore, so the property below cannot be broken by a price
 * change — it is the price that computes the ceiling. What these tests pin is that
 * the derivation is actually wired, that it FOLLOWS a re-price, and that the two
 * ways it could still go wrong (a stored zero, a deployment clamp ignored) do not.
 */
import { describe, it, expect } from 'vitest';
import { ceilingFromCredits, creditsForMode, maxCostForMode, modesOf, resolveMode } from '../src/mode.js';
import { resolveModeCredits, resolveModeCeiling, creditFloorFrom, type ModelPricing } from '../src/credits/pricing.js';
import { config } from '../src/config.js';
import { writableConfig } from './writable-config.js';
import { floridaBusinessForSale as tpl } from '../src/templates/florida-business-for-sale.js';

/** The modes the FLAGSHIP declares, not a global constant — see `modesOf`. */
const MODES = modesOf(tpl.modes).map(([k]) => k);
const modeOf = (key: string) => resolveMode(tpl.modes, key);
const ceilingOf = (key: string, pricing: ModelPricing | null = null) =>
  resolveModeCeiling(pricing, modeOf(key).config, key, config.workflow.maxJobCostUsd);
const earns = (key: string, pricing: ModelPricing | null = null) =>
  resolveModeCredits(pricing, modeOf(key).config, key) * (pricing?.creditFloorUsd ?? config.pricing.creditFloorUsd);

describe('the ceiling is derived from what the report sells for', () => {
  it.each(MODES)('%s can never be allowed to cost more than it earns', (key) => {
    const ceiling = ceilingOf(key);
    expect(
      ceiling,
      `${key}: a job may burn $${ceiling.toFixed(2)} for a report that earns $${earns(key).toFixed(2)}.`,
    ).toBeLessThan(earns(key));
    // …and it leaves exactly the expected profit, which is the whole policy.
    expect(ceiling).toBeCloseTo(earns(key) * (1 - config.pricing.expectedProfitPct / 100), 6);
  });

  it('FOLLOWS a re-price, with no deploy', () => {
    // The point of resolving it against the Firestore override. An admin who doubles
    // a mode's credits has doubled what that report earns; a ceiling that stayed put
    // would be guarding the old price. Deriving from the CODE default instead is the
    // mutation this catches.
    const repriced: ModelPricing = { modes: { essential: 16 } };
    expect(ceilingOf('essential', repriced)).toBeCloseTo(ceilingOf('essential') * 2, 6);
    // …but only up to the deployment lever. Above a certain price the per-model
    // number stops being the one in force and `MAX_JOB_COST_USD` is, which is the
    // lever working rather than a bug — and worth knowing before raising a price
    // that far. DERIVED, not the `36` this first said: that was the threshold at a
    // 30% expected profit and stopped being one at 40%.
    const perCredit = config.pricing.creditFloorUsd * (1 - config.pricing.expectedProfitPct / 100);
    const clampsAt = Math.ceil(config.workflow.maxJobCostUsd / perCredit);
    expect(ceilingOf('comprehensive', { modes: { comprehensive: clampsAt } })).toBe(config.workflow.maxJobCostUsd);
    expect(ceilingOf('comprehensive', { modes: { comprehensive: clampsAt - 1 } })).toBeLessThan(config.workflow.maxJobCostUsd);
    // …and the same for the floor and the margin, the other two inputs.
    const cheaper: ModelPricing = { creditFloorUsd: config.pricing.creditFloorUsd / 2 };
    expect(ceilingOf('essential', cheaper)).toBeCloseTo(ceilingOf('essential') / 2, 6);
    const greedier: ModelPricing = { expectedProfitPct: 50 };
    expect(ceilingOf('essential', greedier)).toBeLessThan(ceilingOf('essential'));
  });

  it('leaves room above what a job actually costs, measured', () => {
    // The other side of the trade: a ceiling below the honest cost holds every job.
    // $3.885843 is a REAL completed comprehensive; essential has no real run and is
    // inferred at ~$1.92 by scaling the honest fixture's $1.31 by the 1.47× the
    // fixture under-estimates comprehensive by.
    const HONEST: Record<string, number> = { comprehensive: 3.885843, essential: 1.92 };
    for (const key of MODES) {
      const honest = HONEST[key];
      // Not skipped silently: a mode this fixture has no measurement for is a mode
      // whose ceiling nobody has checked against reality, and that should be loud.
      expect(honest, `no measured cost for mode "${key}" — add one before shipping it`).toBeDefined();
      expect(ceilingOf(key), `${key}: the ceiling is below what an HONEST job costs`).toBeGreaterThan(honest!);
      expect(ceilingOf(key) / honest!, `${key}: less than 1.5× the honest cost`).toBeGreaterThan(1.5);
    }
  });

  it('is clamped by the deployment lever, which is the incident knob', () => {
    // A per-model number must not be able to ignore `MAX_JOB_COST_USD`. An operator
    // who lowers it expects it to bite everywhere.
    expect(resolveModeCeiling(null, modeOf('comprehensive').config, 'comprehensive', 1)).toBe(1);
  });

  it('refuses a DEPLOYMENT profit of 100 the same way it refuses a stored one', () => {
    // Round 11, `ceiling-profit-invert-3`. The row below guards the FIRESTORE
    // override — `inRange` (>= 0 && < 100) filters it, and it is tested right
    // there. The env/config fallback had no such guard: `EXPECTED_PROFIT_PCT` is
    // `float(..., 40)` and range-checked nowhere.
    //
    // And the failure inverts. `ceilingFromCredits` does `Math.max(keep, 0)`, so
    // 100 becomes a derived ceiling of 0 — and 0 is the documented sentinel for
    // "no ceiling" at every level below (`maxCostForMode`'s opt-out, then
    // `createCostSink`'s `maxUsd > 0 ? … : null`). An operator setting 100 to mean
    // "spend nothing" UNCAPPED every job of every model without a per-model
    // override, and `MAX_JOB_COST_USD` was bypassed too because the opt-out
    // returns before the Math.min with the deployment figure.
    //
    // A derived zero is not an opt-out. Only a template SAYING `maxCostUsd: 0` is.
    const real = writableConfig.pricing.expectedProfitPct;
    try {
      for (const pct of [100, 120, 1000]) {
        writableConfig.pricing.expectedProfitPct = pct;
        const ceiling = ceilingOf('comprehensive');
        expect(ceiling, `pct=${pct} uncapped the job`).toBeGreaterThan(0);
        // Falls back to the deployment ceiling — the bad value is IGNORED, which is
        // what `inRange` does with the stored one. It is not honoured as "spend
        // nothing" either: that would hold every job on a typo.
        expect(ceiling, `pct=${pct}`).toBe(config.workflow.maxJobCostUsd);
      }
    } finally {
      writableConfig.pricing.expectedProfitPct = real;
    }
  });

  it('does not let a derived zero pose as a template opting out', () => {
    // The same thing one layer down, at the function the whole chain runs through.
    // `mode.maxCostUsd = 0` IS an opt-out and must stay one; a derivation that
    // arrives at 0 must not be read as the same statement.
    const mode = modeOf('comprehensive').config;
    expect(
      maxCostForMode(mode, 25, { credits: 18, creditFloorUsd: 0.806, expectedProfitPct: 100 }),
      'a derived zero was read as "no ceiling"',
    ).toBe(25);
    // …and the deliberate opt-out is untouched.
    expect(maxCostForMode({ ...mode, maxCostUsd: 0 }, 25)).toBe(0);
  });

  it('refuses a stored zero rather than holding every job', () => {
    // A missing price is not a policy. A floor of 0 — an empty Stripe catalog, a
    // half-written doc — would derive a ceiling of 0 and park every job of the model.
    for (const bad of [{ creditFloorUsd: 0 }, { creditFloorUsd: -1 }, { expectedProfitPct: 100 }] as ModelPricing[]) {
      expect(ceilingOf('essential', bad), JSON.stringify(bad)).toBe(ceilingOf('essential'));
    }
  });
});

describe('the credit floor read off the catalog', () => {
  it('is the cheapest pack, not the cheapest pack PRICE', () => {
    // The two are different and only one of them is the floor: Scout is the cheapest
    // thing to buy ($29) and the most expensive credit ($1.45).
    const packs = [
      { name: 'Scout', priceUsd: 29, credits: 20 },
      { name: 'Investor', priceUsd: 69, credits: 80 },
      { name: 'Syndicate', priceUsd: 129, credits: 160 },
    ];
    expect(creditFloorFrom(packs)).toBeCloseTo(129 / 160, 6);
  });

  it('says nothing rather than zero when the catalog is unusable', () => {
    // Stripe down, an app with no products, a pack with no credits in its metadata.
    // Reading any of those as "credits are free" drives every ceiling to 0.
    expect(creditFloorFrom([])).toBeUndefined();
    expect(creditFloorFrom([{ priceUsd: 29, credits: 0 }])).toBeUndefined();
    expect(creditFloorFrom([{ priceUsd: 0, credits: 20 }])).toBeUndefined();
    // …and one broken pack does not poison a catalog that has a good one.
    expect(creditFloorFrom([{ priceUsd: 0, credits: 20 }, { priceUsd: 69, credits: 80 }])).toBeCloseTo(0.8625, 6);
  });
});

describe('the raw derivation', () => {
  it('is credits × floor × (1 − profit)', () => {
    expect(ceilingFromCredits(10, { creditFloorUsd: 1, expectedProfitPct: 30 })).toBeCloseTo(7, 6);
    expect(ceilingFromCredits(10, { creditFloorUsd: 0.5, expectedProfitPct: 0 })).toBeCloseTo(5, 6);
  });

  it('falls back to the deployment number when the caller does not know the price', () => {
    // A direct engine caller — a test, the CLI — has no pricing doc in hand. It gets
    // the deployment-wide ceiling, which is the safe answer, not a derived zero.
    expect(maxCostForMode(modeOf('essential').config, 17)).toBe(17);
    expect(creditsForMode(modeOf('essential').config, 'essential')).toBe(8);
  });
});
