/**
 * Report modes — the single, public cost/scope knob every research model exposes.
 *
 * The API surface stays simple: the client picks `mode` = 'essential' | 'comprehensive'.
 * Everything that actually controls cost (research budget, which sections run,
 * prose length, internal params like how many items to profile) is INTERNAL,
 * configured per mode by each template. This is generic: a new research model
 * just declares its `modes`; if it doesn't, sane defaults apply.
 *
 *   - comprehensive → the full report (all sections, full budgets).
 *   - essential     → ~half the cost: fewer sections, reduced budgets, lighter prose.
 */
import { z } from 'zod';

export type ReportMode = 'essential' | 'comprehensive';

export const REPORT_MODES: ReportMode[] = ['essential', 'comprehensive'];

export function isReportMode(v: unknown): v is ReportMode {
  return v === 'essential' || v === 'comprehensive';
}

/** Public param field. Defaults to the cheaper mode (cost-safe). */
export const modeParamSchema = z.enum(['essential', 'comprehensive']).default('essential');

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
export const DEFAULT_MODES: Record<ReportMode, ModeConfig> = {
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
  return config.credits ?? (key === 'comprehensive' ? 18 : 8);
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
 */
export function maxCostForMode(
  mode: ModeConfig,
  fallbackUsd: number,
  derived?: { credits: number; creditFloorUsd: number; expectedProfitPct: number },
): number {
  // A template's explicit figure still wins over the derivation — that is what the
  // field is for, and `0`/negative is a deliberate opt-out. Everything else is
  // derived from what the report sells for, and only falls back to the
  // deployment-wide number when the caller does not know the price.
  const own = mode.maxCostUsd ?? (derived ? ceilingFromCredits(derived.credits, derived) : undefined);
  if (own == null) return fallbackUsd;      // no price in hand → the deployment's
  if (own <= 0) return own;                 // the model opts out, deliberately
  if (fallbackUsd <= 0) return own;         // the deployment does not cap → ours
  return Math.min(own, fallbackUsd);        // both real → whichever binds first
}

/** Resolve a requested mode against a template's modes (or the defaults). */
export function resolveMode(
  modes: Partial<Record<ReportMode, ModeConfig>> | undefined,
  raw: unknown,
): { key: ReportMode; config: ModeConfig } {
  const key: ReportMode = isReportMode(raw) ? raw : 'essential';
  return { key, config: modes?.[key] ?? DEFAULT_MODES[key] };
}
