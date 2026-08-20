/** Shared API response shapes (mirrors the API's admin endpoints). */

/**
 * Why a job is parked, and why it failed if it ends that way. Admin-only — the
 * buyer's view never carries it.
 */
export type JobFailureKind = 'budget_exceeded' | 'upload_failed' | 'run_failed';

/**
 * A job parked for an admin decision. Present while `status === 'held'`.
 *
 * There is no expiry: nothing resolves it but a person. That is the point — every
 * refund in this system is a decision someone made.
 */
export interface JobHold {
  reason: JobFailureKind;
  heldAt: string;
  /** What it had already spent when it was parked — the number the call rests on. */
  spentUsd: number;
  /** One line on what went wrong. Admin-only; the buyer never sees it. */
  detail?: string;
  approvedBy?: string;
  approvedAt?: string;
  /** What the admin decided when they closed it, and who. See the API's JobHold. */
  resolvedOutcome?: 'refund' | 'dismiss';
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface SessionUser {
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  appId: string;
}
export interface SessionResponse {
  token: string;
  user: SessionUser;
  expiresInSeconds: number;
}

export interface AppStatsRollup {
  appId: string;
  reports: number;
  reportsCompleted: number;
  reportsFailed: number;
  /** Failures we stopped at the per-job cost ceiling — refunded, but already paid for. */
  budgetStoppedReports: number;
  degradedReports: number;
  users: number;
  payingUsers: number;
  costUsd: number;
  /** Of `costUsd`, the part spent on jobs that failed and were refunded — pure loss. */
  failedCostUsd: number;
  /** Request-path model spend (moderation + assisted review), outside any job. */
  requestLlmUsd: number;
  requestLlmCalls: number;
  /** Requests allowed through because the moderation classifier could not answer. */
  moderationFailOpen: number;
  revenueUsd: number;
  purchases: number;
  creditsPurchased: number;
  avgGenMs: number | null;
  genTimeMsMin: number | null;
  genTimeMsMax: number | null;
}
export interface DailyPoint {
  date: string;
  reports: number;
  reportsCompleted: number;
  reportsFailed: number;
  costUsd: number;
  failedCostUsd: number;
  revenueUsd: number;
}
/**
 * The state of the layers that decide whether a request runs at all. Optional
 * because a deployed API older than this field returns stats without it — the
 * dashboard must not claim "healthy" when what it actually has is silence.
 */
export interface AdminHealth {
  classifierEnabled: boolean;
  moderationFailOpenRecent: number;
  moderationFailOpen: number;
  moderationFailOpenLastAt?: string;
  adminBypassesModeration: boolean;
}
export interface AdminStats {
  totals: Omit<AppStatsRollup, 'appId'>;
  apps: AppStatsRollup[];
  daily: DailyPoint[];
  health?: AdminHealth;
}

export interface AdminUser {
  appId: string;
  userId: string;
  reports: number;
  costUsd: number;
  spentUsd: number;
  creditsPurchased: number;
  hasPurchased: boolean;
  blocked?: boolean;
  blockedReason?: string | null;
  blockedAt?: string | null;
  moderationStrikes?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastLoginAt?: string;
  logins?: number;
}

/** `held` = parked for an admin decision; not failed, not in flight. */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'incomplete' | 'held';

export interface Cost {
  usd: number;
  llmUsd: number;
  searchUsd: number;
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
}

export interface AdminJob {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  title: string | null;
  status: JobStatus;
  failureKind: JobFailureKind | null;
  hold: JobHold | null;
  cost: Cost | null;
  attempts: number | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface JobProgress {
  phase: string;
  message: string;
  turnsUsed: number;
  sourcesFound: number;
  updatedAt: string;
}
export interface JobAgentSummary {
  id: string;
  wave: number;
  status: string;
  durationMs: number | null;
  attempts: number;
  costUsd: number;
  /** Research turns the agent's loop paid for. Absent for a synthesizer (no loop)
   *  and for jobs summarised before the field existed. */
  turnsUsed?: number;
  /** How the loop ended: done · budget · stalled · ceiling. */
  gatherStop?: string;
  /** `researcher` | `refiner` | `writer`; absent on traces written before it. */
  kind?: string;
  /** Whether it had a research loop; `kind` alone cannot say for a refiner. */
  hadLoop?: boolean;
}
export interface JobSummary {
  mode?: string;
  depth?: string;
  turnsUsed?: number;
  sourcesFound?: number;
  durationMs?: number;
  attempts?: number;
  agents?: JobAgentSummary[];
  warnings?: string[];
  /** Sections that did not come out whole. `lost` → the body is suppressed. */
  sections?: Array<{ key: string; status: 'lost' | 'unenriched' | 'reconstructed' }>;
  agentErrors?: Array<{ agentId: string; error: string }>;
}
export interface JobFileSigned {
  name: string;
  contentType: string;
  size: number | null;
  url: string;
  expiresAt: string;
}
export interface JobDetail {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  params?: Record<string, unknown>;
  title: string | null;
  shortDescription: string | null;
  status: JobStatus;
  /** Admin-only, like `cost` — present only when the caller is an admin. */
  failureKind?: JobFailureKind | null;
  hold?: JobHold | null;
  progress: JobProgress | null;
  cost: Cost | null;
  summary: JobSummary | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  finishedAt?: string | null;
  files?: JobFileSigned[];
  /** From the credits LEDGER, not the job document. Admin view only. */
  refunded?: boolean;
}

export interface AppPublic {
  appId: string;
  name: string;
  active: boolean;
  role: 'admin' | 'app';
  rateLimitPerHour?: number;
  allowedTemplates?: string[];
  googleClientId?: string;
  adminEmails?: string[];
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: string;
  appId: string;
  userId: string;
  type: 'purchase' | 'consumption' | 'refund' | 'grant';
  credits: number;
  plan?: string;
  paymentId?: string;
  provider?: string;
  amountUsd?: number;
  currency?: string;
  jobId?: string;
  grantedBy?: string;
  reason?: string;
  note?: string;
  createdAt: string;
}

export interface ParamFieldUi {
  help?: string;
  suggestions?: string[];
  optionLabels?: Record<string, string>;
  placeholder?: string;
  widget?: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'tags' | 'autocomplete';
}
export interface ParamRangeUi {
  label: string;
  minKey: string;
  maxKey: string;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
}
export interface ParamsUi {
  rows?: string[][];
  fields?: Record<string, ParamFieldUi>;
  hidden?: string[];
  ranges?: ParamRangeUi[];
  advanced?: string[];
}

export interface ModeInfo {
  key: string;
  label: string;
  credits: number;
}
export interface AddonInfo {
  key: string;
  label: string;
  description?: string;
  credits: number;
}
export interface StepInfo {
  id: string;
  label: string;
  description?: string;
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
  modes: ModeInfo[];
  addons: AddonInfo[];
  steps: StepInfo[];
  reportSchema: unknown;
}

/** Parsed report.json from GET /research/:jobId/report. */
export interface JobReport {
  meta: Record<string, unknown>;
  report: Record<string, unknown>;
}

export interface PricingMode {
  key: string;
  defaultCredits: number;
  credits: number;
}
export interface PricingAddon {
  key: string;
  label: string;
  description?: string;
  defaultCredits: number;
  credits: number;
}
/**
 * The two numbers a job's cost ceiling is derived from, and the ceilings they
 * produce. The ceilings are returned rather than recomputed here on purpose: they
 * are what the engine actually enforces, `maxJobCostUsd` clamp included, and an
 * admin changing a price needs to see what it did — not this app's guess at it.
 */
export interface PricingEconomics {
  creditFloorUsd: number;
  /** 'stored' = set for this model (by hand or from Stripe); 'default' = code seed. */
  creditFloorSource: 'stored' | 'default';
  expectedProfitPct: number;
  /** The deployment-wide clamp. A per-model ceiling can never exceed it. */
  maxJobCostUsd: number;
  /**
   * Per tier: the price, what it earns, what a job of it may spend, and what that
   * money BUYS — turns, agents, sections. The last three come from the engine's own
   * mode filter (`modeShapes`), not from a second implementation here.
   */
  ceilings: Array<{
    key: string;
    label?: string;
    credits: number;
    earnsUsd: number;
    ceilingUsd: number;
    budgetScale: number;
    depth: string;
    sections: number;
    agents: number;
    researchers: number;
    maxTurns: number;
  }>;
}
export interface PricingView {
  templateId: string;
  modes: PricingMode[];
  addons: PricingAddon[];
  updatedAt: string | null;
  economics: PricingEconomics;
}
/** What the "read from Stripe" tool answers. */
export interface CreditFloorResult {
  creditFloorUsd: number;
  applied: boolean;
  before: number | null;
  packs: Array<{ planId: string; priceUsd: number; credits: number; perCredit: number }>;
  pricing: PricingView;
}

/** A credit pack as Stripe holds it (the catalog) — see `StripePlan` in the API. */
export interface CreditPack {
  planId: string;
  templateId?: string;
  name: string;
  priceUsd: number;
  credits: number;
  priceId: string;
  interval?: string;
  sub?: string;
  popular?: boolean;
  features?: string[];
  /**
   * Every locale's copy, with NO fallback applied — `sub`/`features` above are one
   * language resolved through English, which is right for a page and wrong for a
   * form: an editor shown the fallback cannot tell "no French copy" from "French
   * copy that happens to match English", and saving would write the fallback in as
   * a translation.
   */
  copy?: { sub: Record<string, string>; features: Record<string, string[]> };
}

/** What the admin sends to create or update one. */
export interface CreditPackWrite {
  appId: string;
  templateId: string;
  name: string;
  credits: number;
  priceUsd: number;
  popular?: boolean;
  sub?: Record<string, string>;
  features?: Record<string, string[]>;
  /**
   * What the editor was SHOWN. Required to change an amount, ignored otherwise.
   * The server refuses (428) without it and (409) when it no longer matches, which
   * is what stops two admins on two screens from overwriting each other.
   */
  expectedPriceUsd?: number;
}
