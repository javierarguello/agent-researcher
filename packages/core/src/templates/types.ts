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
  /** Short human label for this step (e.g. 'Deal scout'), shown in a client's
   *  progress view instead of the raw id. Falls back to a title-cased id. */
  label?: string;
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
 * Presentation hints for a template's params — how a client UI (the admin form,
 * or a model-specific web app) should render `paramsSchema`. Purely cosmetic:
 * the API still validates against `paramsSchema` regardless of these hints.
 */
export interface ParamFieldUi {
  /** One-line explanation shown under the field to help the user choose. */
  help?: string;
  /**
   * Suggested values offered as a dropdown that STILL allows manual entry
   * (autocomplete for a string field, tag suggestions for an array field).
   */
  suggestions?: string[];
  /** Human labels for an enum field's raw values, e.g. { en: 'English' }. */
  optionLabels?: Record<string, string>;
  placeholder?: string;
  /** Force a widget; otherwise it's inferred from the JSON-Schema type. */
  widget?: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'tags' | 'autocomplete';
}

/** Two numeric params (a min + a max) rendered as one range slider. */
export interface ParamRangeUi {
  label: string;
  minKey: string;
  maxKey: string;
  /** Slider floor / ceiling. Dragging a thumb to an extreme clears that bound. */
  min: number;
  max: number;
  step?: number;
  /** Value prefix, e.g. '$'. */
  prefix?: string;
}

export interface ParamsUi {
  /**
   * Rows of param keys rendered side-by-side for a condensed form
   * (e.g. `[['askingPriceMin','askingPriceMax']]`). Keys not listed are
   * appended one-per-row in schema order.
   */
  rows?: string[][];
  /** Per-field UI hints, keyed by param name. */
  fields?: Record<string, ParamFieldUi>;
  /** Param keys to hide from the generated form. */
  hidden?: string[];
  /** Min/max param pairs rendered as a single range slider. */
  ranges?: ParamRangeUi[];
  /** Param keys tucked into a collapsed "Advanced" section (hidden until expanded). */
  advanced?: string[];
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
  /** Presentation hints for rendering `paramsSchema` in a client UI. */
  paramsUi?: ParamsUi;
  /**
   * Translations of the client-facing manifest strings, keyed by language code
   * (e.g. 'es'). The template's own fields are the English ('en') base; any
   * string missing a translation falls back to English. See `toManifest(t, lang)`.
   */
  i18n?: Record<string, TemplateI18n>;
}

/** Per-language overrides of a template's client-facing strings. */
export interface TemplateI18n {
  name?: string;
  description?: string;
  /** Section title by section key. */
  sectionTitles?: Record<string, string>;
  /** Report-tier label by mode key. */
  modeLabels?: Partial<Record<ReportMode, string>>;
  /** paramsUi field overrides by param key. */
  fields?: Record<string, { help?: string; placeholder?: string }>;
  /** Workflow step overrides by agent id (label + description). */
  agentLabels?: Record<string, { label?: string; description?: string }>;
}

/** One workflow step surfaced to a client, so it can explain the current phase. */
export interface StepInfo {
  /** Phase id — an agent id, or a lifecycle phase ('planning'|'assembling'|'done'|…). */
  id: string;
  label: string;
  description?: string;
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
  /** The language this manifest's texts are in (the requested `lang`, or 'en'). */
  lang: string;
  sections: Array<Pick<ReportSection, 'key' | 'title'>>;
  paramsSchema: unknown;
  /** Presentation hints for rendering `paramsSchema` (see ParamsUi). */
  paramsUi?: ParamsUi;
  /** Report tiers the client picks from, with their credit cost. */
  modes: Array<{ key: ReportMode; label: string; credits: number }>;
  /**
   * Ordered workflow steps (localized), so a client can explain a job's current
   * `progress.phase` with a label + description instead of a raw id. Covers the
   * lifecycle phases and every agent, in run order.
   */
  steps: StepInfo[];
  /** JSON Schema of the report envelope's `report` object (consumer contract). */
  reportSchema: unknown;
}
