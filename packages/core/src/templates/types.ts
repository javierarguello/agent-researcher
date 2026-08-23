import { z } from 'zod';
import type { ModeConfig, ReportMode } from '../mode.js';
import type { IssueSeverity, Lang } from '../moderation/copy.js';

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
  /**
   * The fields that identify one ITEM of this section, for a section whose SET
   * belongs to its producer: an enricher may deepen those items, rewrite them and
   * drop them, but it may not GROW the set. When a rewrite comes back longer, the
   * surplus is dropped — as many unmatched items as the set grew by, last ones
   * first — so a refiner that merely retitled a profile can never lose it.
   *
   * Declared per section because it is not a universal rule — `charts` has a
   * refiner whose job includes adding one — and it needs the model's own notion of
   * identity, which only the model knows.
   *
   * An item is "the same" as one it shares ANY of these fields with (compared
   * trimmed, casefolded, without a trailing slash). More than one because either can
   * move on its own — and a real run had BOTH move at once for one profile
   * (`out/local-52835003`), which is what the surplus cap above is for: identity
   * decides WHICH items are candidates, the arithmetic decides how many. An item
   * carrying none of these fields is KEPT — an identity we cannot read is not
   * evidence of an invention.
   *
   * Measured, not theoretical (2026-08-22, `out/local-4ed81938`): the
   * `deep-dive-refiner` returned a SEVENTH listing profile that `deal-scout` never
   * shortlisted, and the business appeared nowhere else in the report — not in the
   * shortlist, the projections, the five charts, the recommendations or the
   * executive summary, because every one of those agents had already run against
   * the producer's six. A full page about a business the rest of the dossier does
   * not know exists.
   */
  itemKeys?: string[];
  /** Builds a derived section's value from the accumulated evidence + report. */
  derive?: (input: {
    sources: Array<{ title: string; url: string; snippet: string }>;
    report: Record<string, unknown>;
  }) => unknown;
}

/**
 * Whether this agent RESEARCHES. It is the one question the engine asks of `role`:
 * a `producer` runs a budgeted web-research loop before it writes, a `synthesizer`
 * writes from what the earlier steps produced and never touches the web.
 */
export type AgentRole = 'producer' | 'synthesizer';

/**
 * What an agent DOES, for docs, traces and validation messages — derived from
 * `role` + `enriches`, never stored, so it cannot drift from them:
 *
 * - `researcher` — researches, then writes the sections it owns.
 * - `refiner`    — rewrites a section another agent produced. It researches too if
 *                  its `role` is `producer` (its `focus` then reaches its loop);
 *                  a `synthesizer` refiner works from the report alone.
 * - `writer`     — composes from upstream output only.
 *
 * The distinction exists because it decides who can be told a `focus`: that field
 * is rendered by the research kickoff and by nothing else, so an agent with no loop
 * cannot receive one. Two of them sat in the flagship for months, one saying the
 * opposite of what the shipped prompt said (round 7, R7-18).
 */
export type AgentKind = 'researcher' | 'refiner' | 'writer';

/** Whether this agent gets a research loop — and therefore whether `focus` reaches it. */
export function hasResearchLoop(a: Pick<AgentSpec, 'role'>): boolean {
  return a.role === 'producer';
}

/** See `AgentKind`. Derived, so a template declares one thing and not two. */
export function agentKind(a: Pick<AgentSpec, 'role' | 'enriches'>): AgentKind {
  if (a.enriches?.length) return 'refiner';
  return hasResearchLoop(a) ? 'researcher' : 'writer';
}

/**
 * One node in a template's agent workflow.
 *
 * - `producer` runs a budgeted web-research loop, then synthesizes its sections.
 * - `synthesizer` composes its sections purely from upstream outputs (no search).
 *
 * `agentKind()` above names the three shapes these two values plus `enriches`
 * actually produce — that is the vocabulary the docs and the validator speak.
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
  /**
   * Web-search/fetch budget for producers. Declaring it on an agent with no
   * research loop is a validation ERROR, not a field that is ignored —
   * `assertTemplatesValid` runs at module load, so it fails the boot rather than
   * the request (round 9, R9-15; the guard is round 8, R8-20).
   */
  researchBudget?: number;
  /** Model alias for structured synthesis. Default: `config.llm.defaultSynthModel`. */
  model?: string;
  /** Model alias for the tool-calling research loop. Default: `config.llm.defaultGatherModel`. */
  gatherModel?: string;
  /** Short human label for this step (e.g. 'Deal scout'), shown in a client's
   *  progress view instead of the raw id. Falls back to a title-cased id. */
  label?: string;
  /**
   * Extra focus for this agent's RESEARCH — which sources to prefer, what to look
   * for. Rendered in the research kickoff and nowhere else, so it is a producer's
   * field: a synthesizer has no loop, and `validateTemplate` refuses one there.
   * Anything about how a section should be WRITTEN goes in that section's
   * `guidance`, which every write prompt renders.
   */
  focus?: string;
  /**
   * Domains this producer's `web_search` is scoped to (e.g. `bizbuysell.com`).
   * Merged (union) with the template-level `sites`. Bare hostnames — no scheme
   * or `www.`. Declaring it on an agent with no research loop is a validation
   * ERROR: it renders as "SUGGESTED SOURCES" in the kickoff, which a synthesizer
   * never reads, so it would be a directive that looks obeyed and is not.
   */
  sites?: string[];
}

/**
 * Presentation hints for a template's params — how a client UI (the admin form,
 * or a model-specific web app) should render `paramsSchema`. Purely cosmetic:
 * the API still validates against `paramsSchema` regardless of these hints.
 */
export interface ParamFieldUi {
  /**
   * What the field is called on the form.
   *
   * This did not exist, and its absence is the clearest violation of the catalog
   * rule in the repo: with no label in the manifest, every client had to invent
   * one — so `apps/fbizlab` carries a four-language map keyed by the FLORIDA
   * model's field names, and a second model's form would draw `maxHeadcount` as
   * its own label, identically in all four languages.
   */
  label?: string;
  /** One-line explanation shown under the field to help the user choose. */
  help?: string;
  /**
   * A shared catalog (`catalogs/registry.ts`) whose values a client may offer as
   * autocomplete for this field — bigger than `suggestions`, and reusable across
   * models rather than inlined per template.
   *
   * OFFERED, never enforced: the field stays whatever its schema says, which for
   * `location` is free text, because a buyer who wants "the I-4 corridor" is
   * describing something real that no list contains. `validateTemplate` refuses an
   * id no catalog answers to — a hint pointing at nothing renders as a field with
   * no autocomplete and no error, which is the kind of thing nobody notices.
   */
  catalog?: string;
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
  /** Localized through `TemplateI18n.ranges`, keyed by `minKey`. */
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

// --- Structured client directives -------------------------------------------

/**
 * The client-facing text of one directive field, in ONE language.
 *
 * Declared in the template — never in a front-end. A client renders whatever the
 * manifest hands it, so adding a field or a language is a template change and
 * every consumer picks it up for free.
 */
export interface DirectiveFieldText {
  label: string;
  /** One short line of help under the field. */
  description?: string;
  /** Human label per raw enum value, e.g. { owner_retiring: 'Owner retiring' }. */
  valueLabels?: Record<string, string>;
}

/**
 * One structured directive a model accepts: a CLOSED vocabulary the client picks
 * from, in place of free prose.
 *
 * This is the point of the whole mechanism. Free text can express "keep every
 * list to at most two items", which reads as a legitimate scoping request and
 * quietly makes the report's schemas unsatisfiable — every agent throws, every
 * attempt retries, and the job burns its budget before degrading. A closed
 * vocabulary cannot express that: the client says WHAT to weigh, never HOW MUCH
 * to emit.
 */
export interface DirectiveField {
  /** Key inside the directives object (and in the manifest). */
  key: string;
  /** `single` = one enum value; `multi` = a subset; `boolean` = a switch. */
  kind: 'single' | 'multi' | 'boolean';
  /** Allowed raw values for `single`/`multi` (machine keys — never translated). */
  values?: string[];
  /** Cap on selections for `multi`. Defaults to all values. */
  maxSelected?: number;
  /** Client-facing text by language code. `en` is required and is the fallback. */
  text: Record<string, DirectiveFieldText>;
  /**
   * INTERNAL English phrasing used when rendering into the prompt. Never leaves
   * the server. Falls back to the `en` text, so it is only worth setting when the
   * analyst-facing phrasing should differ from the buyer-facing label.
   */
  promptLabel?: string;
  /** INTERNAL English phrasing per raw value (falls back to the `en` valueLabels). */
  promptValues?: Record<string, string>;
}

/**
 * A model's structured directive set: the param that holds them, and the fields.
 *
 * `render()` is deliberately absent from this interface — rendering lives in
 * `directives.ts` and runs server-side only. The API accepts values from the
 * closed vocabulary and never accepts (or returns) the rendered prose, so a
 * client cannot hand the engine a sentence it wrote.
 */
export interface DirectiveSpec {
  /** Param key holding the directives object (e.g. 'directives'). */
  key: string;
  fields: DirectiveField[];
}

/** One directive field as a client sees it: localized, ready to render. */
export interface DirectiveManifestField {
  key: string;
  kind: DirectiveField['kind'];
  label: string;
  description?: string;
  maxSelected?: number;
  /** Present for `single`/`multi`: the raw value plus its localized label. */
  options?: Array<{ value: string; label: string }>;
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
  /**
   * Internal (admin-only; never in the public manifest): how this model's requests
   * are reviewed before a job is created. See `moderation/preflight.ts`.
   */
  preflight?: PreflightSpec<TParams>;
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
   * (any slug this template declares — `essential`/`comprehensive` are only the
   * DEFAULTS); each mode maps to internal budget scale,
   * excluded sections, prose depth, and param overrides. Omit to use defaults.
   */
  modes?: Record<ReportMode, ModeConfig>;
  /** Turn validated params into a concise research brief (the goal). */
  buildBrief: (params: TParams) => string;
  /**
   * Structured directives this model accepts, as a closed per-field vocabulary.
   * The values live inside `paramsSchema` under `directives.key` — build that part
   * of the schema with `directivesSchema(fields)` so the two cannot drift.
   */
  directives?: DirectiveSpec;
  /** Presentation hints for rendering `paramsSchema` in a client UI. */
  paramsUi?: ParamsUi;
  /**
   * Params the ENGINE understands and no CLIENT may send.
   *
   * Not a retirement: the key stays in `paramsSchema`, `buildBrief` still renders
   * it, and a server-side caller — the local CLI, a future internal job — keeps
   * working. What it loses is the three client-facing surfaces, and it has to lose
   * all three together or the field is broken rather than hidden:
   *   - `toManifest` strips it from the published `paramsSchema` and from every
   *     `paramsUi` hint that names it, so no client renders an input for it;
   *   - `validateRequest` refuses a request that sends it, with a message, rather
   *     than stripping it in silence (round 7, R7-8: a param we drop without
   *     saying so is a job the buyer paid for that did not read what they wrote);
   *   - the pre-flight assist stops proposing it.
   *
   * `keywords` is the first: it is the last channel by which a buyer's own prose
   * reaches an agent's prompt, and taking it off the client surface is what makes
   * the pre-screen's remaining job "normalize and catch evasion" rather than
   * "read intent" (Javier, 2026-08-19; see `deep-review.md` § K).
   */
  internalParams?: string[];
  /** Paid post-report deliverables this model offers (the add-on catalog). */
  addons?: AddonSpec[];
  /**
   * Translations of the client-facing manifest strings, keyed by language code
   * (e.g. 'es'). The template's own fields are the English ('en') base; any
   * string missing a translation falls back to English. See `toManifest(t, lang)`.
   */
  i18n?: Record<string, TemplateI18n>;
  /**
   * What the PDF cover summarises, and which sections hold the things being
   * compared.
   *
   * The renderers read `report.shortlist` / `report.deep_dives` and keyed on a
   * field called `business` — this model's names. Another model's dossier
   * therefore had no cover statistics at all and no entity cards, because nothing
   * matched. Declaring it here is what makes the cover a feature of the catalog
   * rather than of one template. Omit it and the cover simply has no snapshot.
   */
  cover?: CoverSpec;
  /**
   * ISO 4217 code the figures in this model's reports are in. Default `USD`.
   *
   * The renderers hardcoded a `$`, so every model in the catalog billed in dollars
   * whatever it was researching — and the number FORMAT was `en-US` too, printing
   * `1,234,567.5` to a buyer who reads `1.234.567,5`.
   */
  currency?: string;
}

/**
 * How a model's requests are reviewed in the confirm step, BEFORE credits are
 * spent. Everything here is internal: none of it appears in the public manifest.
 *
 * The design constraint: a user-facing preview must be produced without trusting
 * a model. `describePlan` + `rules` do that on their own; the assisted pass may
 * only propose values for `correctable` fields and pick codes that already have
 * copy here or in the core set.
 */
export interface PreflightSpec<TParams = unknown> {
  /**
   * Fields the assisted pass may propose a corrected value for (a misspelled
   * city, an incomplete place name). A proposal is accepted only if it survives
   * sanitization, stays close to what the user typed, and re-validates against
   * `paramsSchema`. Anything not listed here can never be rewritten.
   */
  correctable?: Array<{ field: string; maxLength: number }>;
  /**
   * Params the buyer's OWN WORDS may fill when they are empty — the "in your own
   * words" box naming a place the form left blank. Text fields only, and each is
   * shown to the buyer as its own confirmation, unticked, next to the words that
   * justify it: unlike a directive (a preference inside the search) a basic
   * defines what is searched at all, so it is never applied on inference and never
   * by a client that does not render it. A field with a value already is the
   * buyer's; `correctable` is the only thing that may touch that, and only as a
   * spelling fix.
   */
  fillable?: Array<{ field: string; maxLength: number }>;
  /**
   * Deterministic findings: a predicate over validated params → an issue code.
   * Runs with no model and no I/O, so it always executes.
   */
  rules?: Array<{
    code: string;
    when: (params: TParams & Record<string, unknown>) => boolean;
    severity?: IssueSeverity;
    /** Param this finding is about, so a UI can highlight the right input. */
    field?: string;
  }>;
  /**
   * Copy for template-specific issue codes, by language (English required — it is
   * the fallback). Core codes already have copy in `moderation/copy.ts`.
   */
  issueCopy?: Record<string, Partial<Record<Lang, string>>> & Record<string, { en: string } & Partial<Record<Lang, string>>>;
  /**
   * Renders the user-facing "here's what we'll research" sentence from the
   * validated params. MUST be a pure function: it is the deterministic summary,
   * and the reason no model writes the text the user reads.
   */
  describePlan?: (params: TParams & Record<string, unknown>, ctx: { lang: Lang; modeLabel: string }) => string;
  /** One line telling the assisted pass what this model delivers (internal). */
  assistPrompt?: string;
}

/**
 * An optional post-report deliverable a model offers as a paid add-on (a pitch
 * deck, an editable Word doc, …). Defined BY THE MODEL — clients/admins pick from
 * this catalog, they don't invent keys. `credits` is the code default cost,
 * overridable per model in Firestore (`model-pricing/{id}.addons[key]`).
 */
export interface AddonSpec {
  key: string;
  label: string;
  description?: string;
  credits: number;
}

/** Per-language overrides of a template's client-facing strings. */
/** How one model's findings are summarised on the PDF cover. */
export interface CoverSpec {
  /** Sections whose arrays hold the entities (listings, sites, papers…). */
  from: string[];
  /** The field that NAMES one — used to merge duplicates and to title its card. */
  nameKey: string;
  /**
   * Up to a few headline figures. `count` ignores `field`; `range` prints
   * low–high; `sum` totals. `labelKey` is looked up in `TemplateI18n.cover`,
   * falling back to the key itself.
   */
  figures?: Array<{ labelKey: string; agg: 'count' | 'range' | 'sum'; field?: string }>;
  /** Numeric fields shown as tiles on an entity card, in order. */
  tiles?: Array<{ labelKey: string; field: string }>;
}

export interface TemplateI18n {
  name?: string;
  description?: string;
  /** Section title by section key. */
  sectionTitles?: Record<string, string>;
  /** Report-tier label by mode key. */
  modeLabels?: Partial<Record<ReportMode, string>>;
  /** paramsUi field overrides by param key. */
  /**
   * Per-field overrides. `label` and `suggestions` are here because both are
   * RENDERED to a buyer: the suggestion chips under the first field of a Spanish
   * form were thirteen English words, and clicking one submitted the English
   * string as the research subject.
   */
  fields?: Record<string, { label?: string; help?: string; placeholder?: string; suggestions?: string[]; optionLabels?: Record<string, string> }>;
  /** Range-slider labels, keyed by the range's `minKey`. */
  ranges?: Record<string, string>;
  /** Cover statistic + tile labels, keyed by `CoverSpec`'s `labelKey`. */
  cover?: Record<string, string>;
  /** Workflow step overrides by agent id (label + description). */
  agentLabels?: Record<string, { label?: string; description?: string }>;
  /** Add-on label/description overrides by add-on key. */
  addonLabels?: Record<string, { label?: string; description?: string }>;
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
  /**
   * Structured directive fields, localized — label, help text, and the option
   * labels for each closed vocabulary. Values are submitted under
   * `params[directivesKey]`.
   */
  directives?: DirectiveManifestField[];
  /** The param key directive values go under (present iff `directives` is). */
  directivesKey?: string;
  /** ISO 4217 the figures in this model's reports are in. */
  currency?: string;
  /** What this model summarises on the report's snapshot. */
  cover?: { from: string[]; nameKey: string; figures?: Array<{ labelKey: string; agg: 'count' | 'range' | 'sum'; field?: string }>; tiles?: Array<{ labelKey: string; field: string }> };
  /** Localized labels for the cover's `labelKey`s, in `lang`. */
  coverLabels?: Record<string, string>;
  /** Report tiers the client picks from, with their credit cost. */
  modes: Array<{ key: ReportMode; label: string; credits: number }>;
  /** Paid add-on deliverables this model offers, with their credit cost. */
  addons: Array<{ key: string; label: string; description?: string; credits: number }>;
  /**
   * Ordered workflow steps (localized), so a client can explain a job's current
   * `progress.phase` with a label + description instead of a raw id. Covers the
   * lifecycle phases and every agent, in run order.
   */
  steps: StepInfo[];
  /** JSON Schema of the report envelope's `report` object (consumer contract). */
  reportSchema: unknown;
}
