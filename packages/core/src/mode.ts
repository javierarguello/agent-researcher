/**
 * Report modes — the single, public cost/scope knob every research model exposes.
 *
 * The API surface stays simple: the client picks a `mode`, and everything that
 * actually controls cost (research budget, which sections run, prose length,
 * internal params like how many items to profile) is INTERNAL, configured per mode
 * by each template.
 *
 * **A mode is any key a template declares.** It used to be the closed pair
 * `'essential' | 'comprehensive'`, written into a union, a `z.enum`, a type guard,
 * a credits fallback, the manifest builder and the admin's pricing schema — twelve
 * places. The header above this one claimed "a new research model just declares its
 * `modes`", and that was false in a way nothing caught: `toManifest` built the mode
 * list by walking the CONSTANT, so a template declaring `{ deep: … }` had it
 * silently dropped from the manifest, and `paramsSchema`'s enum refused it at the
 * API even if a client somehow asked. A catalog product cannot ship two flavours
 * for every model it will ever have.
 *
 * `essential` / `comprehensive` remain the DEFAULTS — what a template that declares
 * nothing gets, and the vocabulary the flagship uses — but they are no longer the
 * only names a model may use.
 */
import { z } from 'zod';

/** A mode key: whatever a template declares. Slug-shaped (see `validateModes`). */
export type ReportMode = string;

/** The default flavours, for a template that declares none of its own. */
export const REPORT_MODES = ['essential', 'comprehensive'];

/** Mode keys are slugs, so they are safe in a URL, a Firestore field and a label. */
const MODE_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;
export function isModeKey(v: unknown): v is ReportMode {
  return typeof v === 'string' && MODE_KEY_RE.test(v);
}

/**
 * The `mode` param field.
 *
 * Deliberately NOT an enum any more, and the reason is worth stating: a template's
 * `paramsSchema` is written in the same object literal that declares its `modes`,
 * so it cannot reference them without a self-reference. The schema therefore admits
 * any slug and `validateRequest` refuses one the template does not declare, BY NAME
 * — which is a better error than "invalid enum value" anyway.
 *
 * That refusal is load-bearing, not cosmetic: `resolveMode` falls back to a default
 * for an unknown key, so without it an undeclared `mode` would silently run — and
 * be CHARGED — as the cheapest one.
 */
export const modeParamSchema = z
  .string()
  .refine(isModeKey, 'must be a lowercase slug')
  .default('essential');

/** Per-mode internal configuration (never exposed to clients). */
export interface ModeConfig {
  label?: string;
  /** Multiplier on every agent's research budget. */
  budgetScale: number;
  /** Section keys NOT generated in this mode (their agents are skipped). */
  exclude?: string[];
  /** Prose length/thoroughness directive (see depth.ts). */
  depth: 'light' | 'standard' | 'deep';
  /** Credits this mode consumes per report (default 1). Aligns with relative cost. */
  credits?: number;
  /**
   * Hard USD ceiling for ONE job in this mode. Omit to use the deployment-wide
   * default (`config.workflow.maxJobCostUsd`).
   *
   * It lives here, next to `budgetScale` and `credits`, because a ceiling is only
   * meaningful relative to what a job of this kind normally costs — and this is a
   * catalog: a cheap scan and a deep multi-agent report cannot share one number.
   * A model that declares nothing still gets a ceiling; a model that knows its own
   * cost profile can say so without a deploy-wide change.
   */
  maxCostUsd?: number;
  /** Internal param overrides merged before the brief is built (e.g. targetCount). */
  params?: Record<string, unknown>;
}

/** Fallback when a template does not declare its own modes. */
export const DEFAULT_MODES: Record<string, ModeConfig> = {
  essential: { label: 'Essential', budgetScale: 0.5, depth: 'light', credits: 8 },
  comprehensive: { label: 'Comprehensive', budgetScale: 1, depth: 'standard', credits: 18 },
};

/**
 * Credits a mode consumes. Defaults: **essential 8, comprehensive 18** — and the 8
 * is the measured ratio rather than a guess. A real comprehensive run costs
 * $3.885843 and an essential one ~$1.92 (inferred), i.e. 49% of the cost, so cost
 * parity per credit sits at 8.9 credits. Essential was 5 — 28% of the price for 49%
 * of the cost — which underpriced the cheaper mode against the dearer one and made
 * its ceiling impossible to set from cost (D1).
 */
export function creditsForMode(config: ModeConfig, key: ReportMode): number {
  // The fallback is the DEFAULT modes' own prices, and only reachable for a mode
  // that declares no credits — which `validateModes` refuses at boot for any
  // template that declares modes at all. A model named `deep` with no price is a
  // template bug, not a free report: charge the dearer default rather than the
  // cheaper one.
  return config.credits ?? DEFAULT_MODES[key]?.credits ?? 18;
}

/**
 * What a job of this mode is allowed to spend, DERIVED from what its report sells
 * for: `credits × creditFloorUsd × jobCeilingFraction`.
 *
 * A ceiling nobody derives is a ceiling nobody re-checks. Both modes shared a flat
 * $20 — 5× a real comprehensive run, and ABOVE what either report earns, so a job
 * that reached the ceiling was a loss the moment it did (D1). Hand-setting one
 * number per mode fixed that batch and would have gone stale the next time a price
 * moved; this cannot, because the price IS the input. Change `credits` (Firestore,
 * no deploy), the floor, or the fraction, and every ceiling follows.
 *
 * Both inputs come from `settings/general` (Firestore, admin-editable): the floor
 * is computed from the live Stripe packs by an admin-triggered refresh, and the
 * expected profit is the policy. Neither is a code constant, because both are
 * adjusted constantly.
 *
 * `credits` must be the EFFECTIVE price — the Firestore override when there is one,
 * not the code default — which is why the resolution lives with the caller that
 * knows it (`resolveModeCeiling`, `credits/pricing.ts`).
 */
export function ceilingFromCredits(
  credits: number,
  pricing: { creditFloorUsd: number; expectedProfitPct: number },
): number {
  const keep = 1 - pricing.expectedProfitPct / 100;
  return credits * pricing.creditFloorUsd * Math.max(keep, 0);
}

/**
 * The USD ceiling for one job in this mode: **the TIGHTER of the model's own figure
 * and the deployment default**, not simply the model's.
 *
 * It used to be `config.maxCostUsd ?? fallbackUsd`, which was fine while no shipped
 * model declared one — and the moment the flagship did, `MAX_JOB_COST_USD` became
 * decorative for the only model in the catalog. That env var is the incident lever:
 * an operator who lowers it expects it to bite everywhere, and silently ignoring it
 * because a template knows better is the wrong way round. Caught by
 * `budget-ceiling.test.ts` and `budget-refund.test.ts`, which drive a hold by
 * lowering exactly that knob — eleven of them went red on the change that
 * introduced the per-mode figures.
 *
 * `0`/negative still means uncapped at either level, and the MODEL's opt-out still
 * wins: a template that says "no ceiling" is making a deliberate statement about
 * its own cost profile, which is the case the field exists for. A deployment that
 * sets no ceiling leaves the model's as the only one.
 *
 * That sentinel is only safe for a DECLARED figure, and it used not to be checked
 * (round 11, `ceiling-profit-invert-3`). `ceilingFromCredits` clamps with
 * `Math.max(keep, 0)`, so `expectedProfitPct >= 100` derives 0 — and 0 read as the
 * opt-out uncapped the job, returning before the `Math.min` so `MAX_JOB_COST_USD`
 * was bypassed as well. `inRange` guards the Firestore override against exactly
 * that value; `EXPECTED_PROFIT_PCT` from env had no guard at all, so an operator
 * setting 100 to mean "spend nothing" removed the cost ceiling from every model
 * without a per-model override — the precise inversion the derived ceiling (D1)
 * exists to prevent.
 *
 * A derivation that arrives at 0 is arithmetic falling through, never a statement.
 * It falls back to the deployment ceiling: the bad input is IGNORED, which is what
 * `inRange` does with the stored one. Not honoured as "spend nothing" either —
 * that would hold every job on a typo.
 */
export function maxCostForMode(
  mode: ModeConfig,
  fallbackUsd: number,
  derived?: { credits: number; creditFloorUsd: number; expectedProfitPct: number },
): number {
  // A template's explicit figure still wins over the derivation — that is what the
  // field is for, and `0`/negative is a deliberate opt-out.
  const declared = mode.maxCostUsd;
  if (declared != null) {
    if (declared <= 0) return declared;             // the model opts out, deliberately
    if (fallbackUsd <= 0) return declared;          // the deployment does not cap → ours
    return Math.min(declared, fallbackUsd);         // both real → whichever binds first
  }
  // Everything else is derived from what the report sells for, and only falls back
  // to the deployment-wide number when the caller does not know the price.
  if (!derived) return fallbackUsd;                 // no price in hand → the deployment's
  const own = ceilingFromCredits(derived.credits, derived);
  // `> 0` rather than `!(<= 0)`, so NaN lands here too. A derived non-figure is not
  // the opt-out sentinel — see the note above.
  if (!(own > 0)) return fallbackUsd;
  if (fallbackUsd <= 0) return own;
  return Math.min(own, fallbackUsd);
}

/** The modes a template offers, in declaration order — its own, or the defaults. */
export function modesOf(modes: Record<ReportMode, ModeConfig> | undefined): Array<[ReportMode, ModeConfig]> {
  const own = Object.entries(modes ?? {}).filter(([, c]) => !!c);
  return own.length ? (own as Array<[ReportMode, ModeConfig]>) : Object.entries(DEFAULT_MODES);
}

/**
 * A template's default mode: the CHEAPEST it declares, ties broken by declaration
 * order.
 *
 * It was the literal `'essential'`, which a model with modes named anything else
 * does not have — `resolveMode` would then hand back `DEFAULT_MODES.essential`, a
 * config belonging to no template, with that template's sections and budgets
 * nowhere in sight. Cheapest is also the safe direction for a default nobody chose.
 */
export function defaultModeOf(modes: Record<ReportMode, ModeConfig> | undefined): ReportMode {
  const all = modesOf(modes);
  return all.reduce((best, cur) =>
    creditsForMode(cur[1], cur[0]) < creditsForMode(best[1], best[0]) ? cur : best,
  )[0];
}

/**
 * Resolve a requested mode against a template's modes (or the defaults).
 *
 * An unknown key falls back rather than throwing, because this runs deep in the
 * engine where there is no useful error to raise. The REFUSAL lives at the API edge
 * (`validateRequest`), which is where a client can be told what it did.
 */
export function resolveMode(
  modes: Record<ReportMode, ModeConfig> | undefined,
  raw: unknown,
): { key: ReportMode; config: ModeConfig } {
  const all = modesOf(modes);
  const hit = typeof raw === 'string' ? all.find(([k]) => k === raw) : undefined;
  if (hit) return { key: hit[0], config: hit[1] };
  const key = defaultModeOf(modes);
  return { key, config: all.find(([k]) => k === key)![1] };
}

/** Well-formedness of a template's mode declaration (used by `validateTemplate`). */
export function validateModes(modes: Record<ReportMode, ModeConfig> | undefined): string[] {
  if (modes === undefined) return []; // declares none → gets the defaults
  const errors: string[] = [];
  const entries = Object.entries(modes);
  if (!entries.length) errors.push('modes declared but empty — omit it to take the defaults');
  for (const [key, cfg] of entries) {
    if (!isModeKey(key)) errors.push(`mode "${key}" is not a lowercase slug (a-z, 0-9, -)`);
    if (!cfg) { errors.push(`mode "${key}" has no config`); continue; }
    // Credits are what the buyer is charged AND what the cost ceiling is derived
    // from. A mode may omit them ONLY if its key is one of the defaults, where
    // "omitted" has a meaning — `essential` falls back to 8, `comprehensive` to 18.
    // A flavour of its own invention has nothing to fall back to, so an omitted
    // price there would silently become 18 credits: a number nobody chose, charged
    // to a buyer.
    const priced = typeof cfg.credits === 'number';
    if (priced && (!Number.isInteger(cfg.credits) || (cfg.credits as number) < 1)) {
      errors.push(`mode "${key}" has credits ${cfg.credits}; it must be an integer >= 1`);
    }
    if (!priced && !(key in DEFAULT_MODES)) {
      errors.push(`mode "${key}" declares no credits, and only ${Object.keys(DEFAULT_MODES).join('/')} have a default price`);
    }
    if (!(cfg.budgetScale > 0)) errors.push(`mode "${key}" must declare a positive budgetScale`);
  }
  return errors;
}
