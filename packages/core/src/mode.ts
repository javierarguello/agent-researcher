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

/** Resolve a requested mode against a template's modes (or the defaults). */
export function resolveMode(
  modes: Partial<Record<ReportMode, ModeConfig>> | undefined,
  raw: unknown,
): { key: ReportMode; config: ModeConfig } {
  const key: ReportMode = isReportMode(raw) ? raw : 'essential';
  return { key, config: modes?.[key] ?? DEFAULT_MODES[key] };
}
