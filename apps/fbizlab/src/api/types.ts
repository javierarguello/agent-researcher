export interface SessionUser { email: string; name: string | null; role: string; appId: string; }
export interface SessionResponse { token: string; user: SessionUser; expiresInSeconds: number; }

export interface ModeInfo { key: string; label: string; credits: number; }
export interface AddonInfo { key: string; label: string; description?: string; credits: number; }
export interface StepInfo { id: string; label: string; description?: string; }
export interface ParamFieldUi { label?: string; help?: string; suggestions?: string[]; optionLabels?: Record<string, string>; placeholder?: string; widget?: string; /** A shared list this field offers as autocomplete — see `GET /catalogs/:id`. Offered, never enforced. */ catalog?: string; }
export interface ParamRangeUi { label: string; minKey: string; maxKey: string; min: number; max: number; step?: number; prefix?: string; }
export interface ParamsUi { rows?: string[][]; fields?: Record<string, ParamFieldUi>; hidden?: string[]; ranges?: ParamRangeUi[]; advanced?: string[]; }

/**
 * A structured directive the model accepts: a closed set of options, already
 * localized by the API. Everything shown here — label, help, option labels — comes
 * from the manifest, so a new field or a new language needs no change in here.
 * Values are submitted under `params[manifest.directivesKey]`.
 */
export interface DirectiveOption { value: string; label: string; }
export interface DirectiveFieldInfo {
  key: string;
  kind: 'single' | 'multi' | 'boolean';
  label: string;
  description?: string;
  /** For `multi`: the most options that may be picked. */
  maxSelected?: number;
  options?: DirectiveOption[];
}

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  lang: string;
  sections: Array<{ key: string; title: string }>;
  paramsSchema: unknown;
  paramsUi?: ParamsUi;
  directives?: DirectiveFieldInfo[];
  /** The param key directive values go under (present iff `directives` is). */
  directivesKey?: string;
  /** Which param carries the buyer's free-text instructions, if any. */
  /** ISO 4217 the figures in this model's reports are in. */
  currency?: string;
  /** What this model summarises on the report's snapshot. */
  cover?: { from: string[]; nameKey: string; figures?: Array<{ labelKey: string; agg: 'count' | 'range' | 'sum'; field?: string }>; tiles?: Array<{ labelKey: string; field: string }> };
  /** The cover's labels, already localized to `lang`. */
  coverLabels?: Record<string, string>;
  modes: ModeInfo[];
  addons: AddonInfo[];
  steps: StepInfo[];
  reportSchema: unknown;
}

/**
 * `held` = paused while we review it before spending more on it. Not a failure and
 * not finished; it resolves either way, and if it is not approved the credits come
 * back. Treat it as a live state in the UI, but not one the user can hurry.
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'incomplete' | 'held';
export interface Cost { usd: number; }

export interface JobListItem {
  jobId: string;
  template: string;
  title: string | null;
  shortDescription: string | null;
  status: JobStatus;
  mode?: string | null;
  creditsSpent?: number | null;
  progress?: { phase: string; kind?: ProgressKind; detail?: string } | null;
  cost: Cost | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/**
 * What kind of step the engine is on — the closed vocabulary the live line is
 * localized from (mirrors `ProgressKind` in the core). The engine's own English
 * `message` never reaches this client: it names internal section keys and can
 * carry a web page's words through the model's next search query.
 */
export type ProgressKind =
  | 'starting' | 'wave' | 'researching' | 'reusing' | 'plan' | 'searched' | 'search_failed' | 'fetched' | 'cached'
  | 'stopped' | 'cut_off' | 'ceiling' | 'writing' | 'composing' | 'retry' | 'failed' | 'assembling' | 'done' | 'held' | 'incomplete';
export interface JobProgress {
  phase: string;
  /** Absent on jobs written before the field existed — the phase alone is shown then. */
  kind?: ProgressKind;
  /** Only for `searched`: the query, clipped by the API. Shown quoted, as a query. */
  detail?: string;
  updatedAt: string;
}
export interface JobSummary {
  durationMs?: number;
  sourcesFound?: number;
  /** The one line to show when a report came back incomplete — already in the
   *  report's language. The raw diagnostics never reach this client. */
  notice?: string;
  /** Sections that did not come out whole. `lost` → the body is suppressed. */
  sections?: Array<{ key: string; status: 'lost' | 'unenriched' | 'reconstructed' }>;
}
/** `url` is a relative API path fetched WITH the session token (no shareable link). */
export interface JobFileSigned { name: string; contentType: string; size: number | null; url: string; }
export interface JobDetail {
  jobId: string; appId: string; userId: string; template: string;
  params?: Record<string, unknown>;
  mode?: string | null; creditsSpent?: number | null;
  title: string | null; shortDescription: string | null;
  status: JobStatus; progress: JobProgress | null; cost: Cost | null; summary: JobSummary | null;
  /** The completion email is coming for this job, so the screen may say so. */
  notify?: boolean;
  createdAt: string; updatedAt: string; error: string | null;
  finishedAt?: string | null; files?: JobFileSigned[];
}
export interface JobReport { meta: Record<string, unknown>; report: Record<string, unknown>; }

export interface CreditPlan {
  planId: string;
  name: string;
  priceUsd: number;
  credits: number;
  priceId: string;
  interval?: string;
  sub?: string;
  popular?: boolean;
  features?: string[];
}
