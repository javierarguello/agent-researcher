/**
 * Analysis depth — an optional, framework-level knob any template can accept.
 *
 * `depth` scales how exhaustive the report is: it swaps the depth directive
 * injected into every writing prompt AND multiplies each agent's research
 * budget. It does NOT change the sections or the schema, so it is safe across
 * all templates and never a breaking change.
 */
import { z } from 'zod';

export type Depth = 'light' | 'standard' | 'deep';

export interface DepthProfile {
  key: Depth;
  label: string;
  /** Directive injected into the writing prompts (length/thoroughness target). */
  directive: string;
  /** Multiplier applied to each agent's researchBudget. */
  budgetScale: number;
}

export const DEPTH_PROFILES: Record<Depth, DepthProfile> = {
  light: {
    key: 'light',
    label: 'Light',
    budgetScale: 0.6,
    directive:
      'DEPTH — LIGHT: keep it focused and concise. Cover each required point in a short paragraph or a few ' +
      'bullets, prioritizing the most decision-relevant facts over exhaustive detail. Aim for a compact ' +
      'report (~6-10 pages). Still specific and cited — just tighter. Never pad.',
  },
  standard: {
    key: 'standard',
    label: 'Standard',
    budgetScale: 1,
    directive:
      'DEPTH — STANDARD (premium long-form report, ~15-20 pages): sections must read as thorough professional ' +
      'ANALYSIS, not summaries. Expand every prose field to multiple substantial paragraphs with specific ' +
      'figures, named entities, comparisons, cause→effect reasoning, and implications for the buyer. Honor ' +
      'the length/count targets in each section\'s guidance. Add genuine analytical value — never pad or ' +
      'repeat. Where evidence is thin, reason about what it implies and what diligence would resolve it.',
  },
  deep: {
    key: 'deep',
    label: 'Deep',
    budgetScale: 1.4,
    directive:
      'DEPTH — DEEP (exhaustive report, 25+ pages): maximum rigor. Give each major section multi-page ' +
      'treatment with extensive figures, multiple scenarios, sensitivity/what-if reasoning, comparisons, ' +
      'and second-order implications. Leave no relevant angle unexplored and quantify wherever possible. ' +
      'Still strictly evidence-based — model and label assumptions, never fabricate.',
  },
};

/** Zod field a template adds to its params to expose the knob. */
export const depthParamSchema = z.enum(['light', 'standard', 'deep']).default('standard');

/** Resolve a params value to a profile, defaulting to 'standard'. */
export function resolveDepthProfile(v: unknown): DepthProfile {
  return typeof v === 'string' && v in DEPTH_PROFILES ? DEPTH_PROFILES[v as Depth] : DEPTH_PROFILES.standard;
}
