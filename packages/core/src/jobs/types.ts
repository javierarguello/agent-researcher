import type { Cost } from '../cost.js';

/**
 * `held` = paused, waiting for a person.
 *
 * Not a failure and not in flight: the work is parked, the credits are still
 * consumed, and an ADMIN decides what happens — continue it, refund it, top the
 * buyer up, or close it. Nothing else resolves it, so it is a resting place until
 * someone looks. Deliberately NOT counted as in-flight: a job waiting on us must
 * not lock the buyer out of starting another (that was E2).
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'held';

/**
 * Why a job stopped in a way that needs a person, rather than a retry.
 *
 * - `budget_exceeded` — it passed its cost ceiling. Continuing costs more money,
 *   so the call is whether this particular job is worth it.
 * - `upload_failed`  — the report was produced and paid for, but could not be
 *   stored. Nothing is wrong with the work; it needs re-uploading, not re-running.
 * - `run_failed`     — it could not be completed at all (the assembled report
 *   failed validation, or the run threw).
 *
 * The same values name a hold and, if the hold is resolved against the buyer, the
 * failure it becomes — so a job's history reads the same before and after.
 */
export type JobFailureKind = 'budget_exceeded' | 'upload_failed' | 'run_failed';

/**
 * A job parked for an admin decision — the alert state.
 *
 * NOTHING resolves a hold except a person. There is no expiry and no sweep: a job
 * that cannot finish waits, with the buyer's credits still consumed, until an admin
 * continues it, refunds it, tops the buyer up, or closes it. That is the deliberate
 * cost of "every refund is a decision someone made" (Javier, 2026-07-31) — so the
 * admin's held-jobs view is not a convenience, it is the only thing that moves them.
 */
export interface JobHold {
  reason: JobFailureKind;
  heldAt: string;
  /** What the job had already spent (USD) when it was held — the number the call rests on. */
  spentUsd: number;
  /** One line about what went wrong, for the admin (never shown to the buyer). */
  detail?: string;
  /** Audit: who let it continue, and when. Set on approval; the job goes back to `queued`. */
  approvedBy?: string;
  approvedAt?: string;
}

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
  /** Total wall-clock generation time (ms), across all re-dispatches. */
  durationMs: number;
  /** How many worker dispatches the job took to finish. */
  attempts?: number;
  /** Per-agent timing + retries (heavy detail lives in trace.json). */
  agents?: Array<{ id: string; wave: number; status: string; durationMs: number | null; attempts: number; costUsd: number }>;
  /** Warnings to review later (e.g. sections degraded after exhausting retries).
   *  INTERNAL: names agents and section keys, in English. Admin surfaces only. */
  warnings?: string[];
  /** The buyer-facing line for an incomplete report, in the report's language. */
  notice?: string;
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
  /** Report mode key (essential/comprehensive) — denormalized for list rendering. */
  mode?: string;
  /** Credits charged for this report (the mode cost at generation time). */
  creditsSpent?: number;
  /** Auto-generated short title (for dashboards / report lists). */
  title?: string;
  /** Auto-generated one-line description of the report. */
  shortDescription?: string;
  status: JobStatus;
  progress?: JobProgress;
  /** How many times the worker has been dispatched for this job (resumable retries). */
  attempts?: number;
  /** Running total cost (LLM exact + search estimate); updated per wave. */
  cost?: Cost;
  /** Denormalized summary (metrics + errors), set on completion/failure. */
  summary?: JobSummary;
  /** Output objects, populated on completion. */
  files: JobFile[];
  /** Bucket prefix for this job: researchs/{jobId}. */
  bucketPath: string;
  error?: string;
  /** Set on failures worth distinguishing in the admin (see JobFailureKind). */
  failureKind?: JobFailureKind;
  /** Present while `status === 'held'`, and kept afterwards as the audit trail. */
  hold?: JobHold;
  /**
   * An admin approved this job to run past its cost ceiling. Set by the approval,
   * read by the engine, and never cleared — a job that needed it once will need it
   * again the moment it resumes.
   */
  budgetOverride?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
