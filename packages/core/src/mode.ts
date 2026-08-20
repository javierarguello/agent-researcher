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
  essential: { label: 'Essential', budgetScale: 0.5, depth: 'light', credits: 5 },
  comprehensive: { label: 'Comprehensive', budgetScale: 1, depth: 'standard', credits: 18 },
};

/** Credits a mode consumes (defaults: essential 5, comprehensive 18 — track real cost). */
export function creditsForMode(config: ModeConfig, key: ReportMode): number {
  return config.credits ?? (key === 'comprehensive' ? 18 : 5);
}

/**
 * The lowest USD a single credit is ever sold for.
 *
 * A COPY of an external fact, and the only one in the repo: the credit packs live
 * entirely in Stripe (Product metadata `credits` + the default Price), so nothing
 * here can derive it. Measured 2026-08-20 off `GET /plans?appId=fbizlab`:
 * Scout $29/20 = $1.45, Investor $69/80 = $0.8625, Syndicate $129/150 = $0.86.
 * The floor is what matters — a buyer on the cheapest pack is the one a ceiling
 * has to stay profitable against.
 *
 * It exists so the rule below can be a TEST rather than a habit: no job may be
 * allowed to cost more than the report it produced earned. Update it whenever the
 * Stripe catalog moves; `mode-ceiling.test.ts` fails loudly if a ceiling ever
 * crosses it, which is the direction that loses money.
 */
export const CREDIT_FLOOR_USD = 0.86;

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
export function maxCostForMode(config: ModeConfig, fallbackUsd: number): number {
  const own = config.maxCostUsd;
  if (own == null) return fallbackUsd;      // no opinion → the deployment's
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
