export interface SessionUser { email: string; name: string | null; role: string; appId: string; }
export interface SessionResponse { token: string; user: SessionUser; expiresInSeconds: number; }

export interface ModeInfo { key: string; label: string; credits: number; }
export interface AddonInfo { key: string; label: string; description?: string; credits: number; }
export interface StepInfo { id: string; label: string; description?: string; }
export interface ParamFieldUi { help?: string; suggestions?: string[]; optionLabels?: Record<string, string>; placeholder?: string; widget?: string; }
export interface ParamRangeUi { label: string; minKey: string; maxKey: string; min: number; max: number; step?: number; prefix?: string; }
export interface ParamsUi { rows?: string[][]; fields?: Record<string, ParamFieldUi>; hidden?: string[]; ranges?: ParamRangeUi[]; advanced?: string[]; }

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  lang: string;
  sections: Array<{ key: string; title: string }>;
  paramsSchema: unknown;
  paramsUi?: ParamsUi;
  modes: ModeInfo[];
  addons: AddonInfo[];
  steps: StepInfo[];
  reportSchema: unknown;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'incomplete';
export interface Cost { usd: number; }

export interface JobListItem {
  jobId: string;
  template: string;
  title: string | null;
  shortDescription: string | null;
  status: JobStatus;
  progress?: { phase: string; message: string } | null;
  cost: Cost | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobProgress { phase: string; message: string; turnsUsed: number; sourcesFound: number; updatedAt: string; }
export interface JobSummary { durationMs?: number; sourcesFound?: number; warnings?: string[]; degradedSections?: string[]; }
/** `url` is a relative API path fetched WITH the session token (no shareable link). */
export interface JobFileSigned { name: string; contentType: string; size: number | null; url: string; }
export interface JobDetail {
  jobId: string; appId: string; userId: string; template: string;
  params?: Record<string, unknown>;
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
