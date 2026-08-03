export interface SessionUser { email: string; name: string | null; role: string; appId: string; }
export interface SessionResponse { token: string; user: SessionUser; expiresInSeconds: number; }

export interface ModeInfo { key: string; label: string; credits: number; }
export interface AddonInfo { key: string; label: string; description?: string; credits: number; }
export interface StepInfo { id: string; label: string; description?: string; }
export interface ParamFieldUi { label?: string; help?: string; suggestions?: string[]; optionLabels?: Record<string, string>; placeholder?: string; widget?: string; }
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
  instructionsField?: string;
  /** ISO 4217 the figures in this model's reports are in. */
  currency?: string;
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
  progress?: { phase: string; message: string } | null;
  cost: Cost | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobProgress { phase: string; message: string; turnsUsed: number; sourcesFound: number; updatedAt: string; }
export interface JobSummary {
  durationMs?: number;
  sourcesFound?: number;
  /** The one line to show when a report came back incomplete — already in the
   *  report's language. The raw diagnostics never reach this client. */
  notice?: string;
  degradedSections?: string[];
}
/** `url` is a relative API path fetched WITH the session token (no shareable link). */
export interface JobFileSigned { name: string; contentType: string; size: number | null; url: string; }
export interface JobDetail {
  jobId: string; appId: string; userId: string; template: string;
  params?: Record<string, unknown>;
  mode?: string | null; creditsSpent?: number | null;
  title: string | null; shortDescription: string | null;
  status: JobStatus; progress: JobProgress | null; cost: Cost | null; summary: JobSummary | null;
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
