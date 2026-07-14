import { z } from 'zod';
import type { ModeConfig, ReportMode } from '../mode.js';

/**
 * One section of the final structured report.
 *
 * Each section owns a typed Zod sub-schema; the full report schema is the
 * composition of every section's schema (an "incremental" schema built by the
 * agents that produce those sections). String fields hold Markdown, so prose
 * can carry links, emphasis, and lists.
 */
export interface ReportSection {
  /** Stable machine key; also the property name in the report JSON. */
  key: string;
  /** Human title (for docs / manifest / UI). */
  title: string;
  /** What an agent must cover here — injected into that agent's prompt. */
  guidance: string;
  /** Typed shape this section contributes to the report. */
  schema: z.ZodType;
  /**
   * When true, the engine fills this section deterministically (e.g. `sources`
   * from the evidence store) — no agent produces it. Excluded from the
   * "every section has a producer" validation. Provide `derive` to compute it.
   */
  derived?: boolean;
  /** Builds a derived section's value from the accumulated evidence + report. */
  derive?: (input: {
    sources: Array<{ title: string; url: string; snippet: string }>;
    report: Record<string, unknown>;
  }) => unknown;
}

export type AgentRole = 'producer' | 'synthesizer';

/**
 * One node in a template's agent workflow.
 *
 * - `producer` runs a budgeted web-research loop, then synthesizes its sections.
 * - `synthesizer` composes its sections purely from upstream outputs (no search).
 *
 * Dependencies (`dependsOn`, plus the producer of any `enriches` section) define
 * the DAG the executor runs wave-by-wave, parallel within a wave.
 */
export interface AgentSpec {
  /** Stable id, unique within the template. */
  id: string;
  role: AgentRole;
  /** One-line objective (surfaced in docs and progress). */
  objective: string;
  /** Section keys this agent authors from scratch. */
  produces?: string[];
  /** Section keys (produced upstream) this agent refines in place. */
  enriches?: string[];
  /** Agent ids whose section outputs are injected as read-only context. */
  dependsOn?: string[];
  /** Web-search/fetch budget for producers (ignored for synthesizers). */
  researchBudget?: number;
  /** Model alias for structured synthesis. Default: `config.llm.defaultSynthModel`. */
  model?: string;
  /** Model alias for the tool-calling research loop. Default: `config.llm.defaultGatherModel`. */
  gatherModel?: string;
  /** Extra focus for this agent's research + writing (e.g. which sources to prefer). */
  focus?: string;
  /**
   * Domains this producer's `web_search` is scoped to (e.g. `bizbuysell.com`).
   * Merged (union) with the template-level `sites`. Bare hostnames — no scheme
   * or `www.`. Ignored for synthesizers (they don't search).
   */
  sites?: string[];
}

/**
 * A research template ("model") = one research vertical: its base prompt, the
 * validated params clients may pass, the report's typed sections, and the agent
 * workflow that fills them.
 */
export interface ResearchTemplate<TParams = unknown> {
  id: string;
  name: string;
  description: string;
  /** Report-envelope schema version. Bump only on a breaking section change. */
  version: number;
  /**
   * Internal base system prompt (highest authority). Client instructions refine
   * but never override it. Never exposed verbatim to clients.
   */
  basePrompt: string;
  /** Zod schema validating the client-supplied params. */
  paramsSchema: z.ZodType<TParams>;
  /** Ordered, typed report sections. */
  sections: ReportSection[];
  /** The agent workflow that produces the sections. */
  agents: AgentSpec[];
  /**
   * Default domains every producer's `web_search` is scoped to (e.g. the
   * marketplaces/registries this vertical trusts). Individual agents may add
   * their own via `AgentSpec.sites` (the two are unioned). Bare hostnames.
   */
  sites?: string[];
  /**
   * Per-mode cost/scope config. The public API exposes only `mode`
   * ('essential' | 'comprehensive'); each mode maps to internal budget scale,
   * excluded sections, prose depth, and param overrides. Omit to use defaults.
   */
  modes?: Partial<Record<ReportMode, ModeConfig>>;
  /** Turn validated params into a concise research brief (the goal). */
  buildBrief: (params: TParams) => string;
  /** Optional params field carrying lower-authority client instructions. */
  instructionsField?: string;
}

/** The full report schema = every section's sub-schema composed into one object. */
export function reportSchemaOf(template: ResearchTemplate<any>): z.ZodObject<Record<string, z.ZodType>> {
  return z.object(Object.fromEntries(template.sections.map((s) => [s.key, s.schema])));
}

/** The schema for a subset of sections (what a single agent must return). */
export function sectionSubsetSchema(
  template: ResearchTemplate<any>,
  keys: string[],
): z.ZodObject<Record<string, z.ZodType>> {
  const set = new Set(keys);
  return z.object(
    Object.fromEntries(template.sections.filter((s) => set.has(s.key)).map((s) => [s.key, s.schema])),
  );
}

/** Look up a section by key. */
export function sectionByKey(template: ResearchTemplate<any>, key: string): ReportSection | undefined {
  return template.sections.find((s) => s.key === key);
}

/** JSON-Schema view of a template's params, for the public /templates endpoint. */
export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  sections: Array<Pick<ReportSection, 'key' | 'title'>>;
  paramsSchema: unknown;
  /** JSON Schema of the report envelope's `report` object (consumer contract). */
  reportSchema: unknown;
}
