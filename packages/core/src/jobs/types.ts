import type { Cost } from '../cost.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobFile {
  /** File name, e.g. "report.md". */
  name: string;
  /** Full object path within the bucket, e.g. "researchs/{jobId}/report.md". */
  path: string;
  contentType: string;
  size?: number;
}

export interface JobProgress {
  phase: string;
  message: string;
  turnsUsed: number;
  sourcesFound: number;
  updatedAt: string;
}

/** Compact, denormalized job summary for dashboards (heavy detail stays in trace.json). */
export interface JobSummary {
  schemaVersion: string;
  language: string;
  /** Public mode ('essential' | 'comprehensive'). */
  mode: string;
  /** Internal prose depth the mode mapped to. */
  depth: string;
  turnsUsed: number;
  sourcesFound: number;
  reportBytes: number;
  durationMs: number;
  /** Sections filled with a degraded placeholder (an agent failed). */
  degradedSections?: string[];
  /** Per-agent failures (message only; full stack is in trace.json). */
  agentErrors?: Array<{ agentId: string; error: string }>;
}

export interface ResearchJob {
  jobId: string;
  /** Owning application (rate-limit key). */
  appId: string;
  /** Owning user — UUID or email (rate-limit key). */
  userId: string;
  /** Template id ("model"). */
  template: string;
  /** Validated params the client passed. */
  params: Record<string, unknown>;
  /** Auto-generated short title (for dashboards / report lists). */
  title?: string;
  /** Auto-generated one-line description of the report. */
  shortDescription?: string;
  status: JobStatus;
  progress?: JobProgress;
  /** Running total cost (LLM exact + search estimate); updated per wave. */
  cost?: Cost;
  /** Denormalized summary (metrics + errors), set on completion/failure. */
  summary?: JobSummary;
  /** Output objects, populated on completion. */
  files: JobFile[];
  /** Bucket prefix for this job: researchs/{jobId}. */
  bucketPath: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
