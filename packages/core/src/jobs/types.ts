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
  /**
   * What the admin DECIDED when they closed it, and who.
   *
   * Persisted because intent is not recoverable from state. A dismissed job and a
   * job whose refund blew up both read `failed` + unrefunded, so the recovery path
   * — which exists to finish an interrupted refund — was reversing deliberate
   * "close without refund" decisions on a second click, and stamping it in the
   * audit log as the completion of the first one.
   */
  resolvedOutcome?: 'refund' | 'dismiss';
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface JobFile {
  /** File name, e.g. "report.md". */
  name: string;
  /** Full object path within the bucket, e.g. "researchs/{jobId}/report.md". */
  path: string;
  contentType: string;
  size?: number;
}

/**
 * What KIND of thing the engine just did — the closed vocabulary a client
 * localizes the live progress line from.
 *
 * `message` is the engine's own English sentence and is for the admin's trace.
 * It used to be the only thing a buyer's screen had, so a Spanish buyer read
 * `Writing (market_overview, competitive_landscape).` — English, internal section
 * keys — and a page could put its own sentence there through the model's next
 * search query, unbounded. A client renders `kind` in the buyer's language and
 * shows `detail` only where it is the buyer's own research happening (the query
 * of a `searched`), clipped and quoted.
 */
export const PROGRESS_KINDS = [
  'starting',
  'wave',
  'researching',
  'reusing',
  'plan',
  'searched',
  'search_failed',
  'fetched',
  'cached',
  'stopped',
  /**
   * The loop was CUT OFF: it stopped because we stopped paying, not because it was
   * finished. `stopped` says "research for this step is complete", and it was being
   * emitted for `stalled` and `ceiling` too — so a loop force-stopped after four
   * plan-only turns with ZERO searches told the buyer its research was complete,
   * twice (round 7, R7-22 / R7-31).
   */
  'cut_off',
  'ceiling',
  'writing',
  'composing',
  'retry',
  'failed',
  'assembling',
  'done',
  'held',
  'incomplete',
] as const;

/**
 * A VALUE as well as a type, so a client can be pinned against it. Every client
 * hand-copied this union — the SPA's `api/types.ts`, its progress-copy table, and
 * two test files — and adding a kind here typechecked everywhere while the buyer's
 * line went BLANK for it: the SPA is a separately deployed static bundle, so a new
 * engine kind reaches an old bundle before any rebuild (round 7, R7-6). The pin
 * lives in `apps/fbizlab/test/progress-kind-pin.test.tsx`, which reads this list.
 */
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

/**
 * Lifecycle phases whose NAME is also a kind — the closed set a legacy document
 * may be coerced through. Deliberately not every phase: an agent phase like
 * `deal-scout` has no safe kind (a `searched` without its query is nothing), which
 * is what C3 removed.
 */
const LIFECYCLE_KINDS = new Set<string>(['held', 'incomplete', 'failed', 'done', 'assembling']);

/** How much of a `searched` detail a client is handed. Real honest queries: p90 90 chars, max 118. */
export const PROGRESS_DETAIL_MAX = 120;

export interface JobProgress {
  phase: string;
  /** The engine's English sentence — admin's, not the buyer's. */
  message: string;
  /** Absent on documents written before the field existed: a client shows the phase alone. */
  kind?: ProgressKind;
  /** The one variable a client may show — the query of a `searched`, clipped. */
  detail?: string;
  turnsUsed: number;
  sourcesFound: number;
  updatedAt: string;
}

/**
 * The buyer-facing shape of a progress line — what the API hands a non-admin.
 * No `message`: the engine's sentence names internal keys and carries the
 * model's own words. `detail` only for `searched`, clipped.
 */
export function clientProgress(p: JobProgress): { phase: string; kind?: ProgressKind; detail?: string; updatedAt: string } {
  // By CODE POINT, like `sourceLabel` and the handoff cut: slicing UTF-16 units
  // through a surrogate pair left a lone surrogate in the one string a hostile page
  // chooses, and the buyer's screen painted it as a replacement glyph (R7-22).
  const detail =
    p.kind === 'searched' && p.detail ? Array.from(p.detail).slice(0, PROGRESS_DETAIL_MAX).join('') : undefined;
  // A document written before `kind` existed still has to say something. `held` is
  // the case that matters: a parked job is the one kind of job that deliberately
  // outlives a deploy, and without a kind the buyer's page showed a pulsing dot and
  // "Generating your dossier…" under an "Under review" badge, forever (R7-5).
  const kind = p.kind ?? (LIFECYCLE_KINDS.has(p.phase) ? (p.phase as ProgressKind) : undefined);
  return { phase: p.phase, ...(kind ? { kind } : {}), ...(detail ? { detail } : {}), updatedAt: p.updatedAt };
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
  /**
   * Per-agent timing + retries (heavy detail lives in trace.json).
   *
   * `turnsUsed`/`gatherStop` are here because without them the admin table renders
   * an agent that made 22 plan updates and ZERO searches identically to one that
   * did 21 real turns: `ok · 1 try · $0.38` (round 7, R7-30). They are the only
   * surviving signal on a multi-dispatch job, where `slimAgents()` has already
   * blanked the loop's closing note. Absent on summaries written before they
   * existed — an old job renders a dash, not a zero.
   */
  agents?: Array<{
    id: string;
    wave: number;
    status: string;
    durationMs: number | null;
    attempts: number;
    costUsd: number;
    turnsUsed?: number;
    gatherStop?: string;
    /** `researcher` | `refiner` | `writer` — absent on traces written before it. */
    kind?: string;
    /**
     * Whether this agent HAD a research loop — `role === 'producer'`. `kind` alone
     * cannot say: the flagship ships three producer-refiners with loops and one
     * synthesizer-refiner without, and both render `refiner`, so a producer whose
     * loop threw before its first turn was indistinguishable from an agent that
     * never had one (round 9, R9-20). Different conversations, and one of them is a
     * refund.
     */
    hadLoop?: boolean;
  }>;
  /** Warnings to review later (e.g. sections degraded after exhausting retries).
   *  INTERNAL: names agents and section keys, in English. Admin surfaces only. */
  warnings?: string[];
  /** The buyer-facing line for an incomplete report, in the report's language. */
  notice?: string;
  /** Sections filled with a degraded placeholder (an agent failed). */
  /** Sections that did not come out whole — see `ReportMeta.sections`. */
  sections?: Array<{ key: string; status: 'lost' | 'unenriched' | 'reconstructed' }>;
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
  /**
   * This job is holding one of its user's in-flight slots. The flag is the record
   * that makes releasing exactly-once — see `jobs/slots.ts`. Cleared on every
   * terminal path: completed, held, failed, or an enqueue that never happened.
   */
  /**
   * The dispatch that currently owns this job.
   *
   * Cloud Tasks is at-least-once and `running` is deliberately not in the worker's
   * skip list, so two engines can be alive on one job. This is what tells a write
   * from the run that owns the job apart from a write from one nobody stopped.
   */
  dispatchId?: string;

  slotHeld?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
