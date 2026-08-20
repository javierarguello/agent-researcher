/**
 * Per-app analytics, stored for easy consumption straight from Firestore.
 *
 *   app-stats/{appId}                    all-time aggregate for an app
 *   app-stats/{appId}/daily/{yyyy-mm-dd} one bucket per UTC day (TTL: retentionDays)
 *   app-users/{appId__userId}            per-user record (distinct-user count + detail)
 *
 * Everything is maintained with atomic `FieldValue.increment`, so writes are
 * lock-free and a reader just reads the doc(s). Averages are stored as
 * total + count (avgGenMs = genTimeMsTotal / genCount) to avoid read-modify-write.
 *
 * Write-only for now — the consuming API comes later. `getAppStats` /
 * `getDailyStats` are provided for convenience.
 */
import { FieldValue, Firestore, Timestamp, type DocumentReference, type Query } from '@google-cloud/firestore';
import { config } from '../config.js';
import { blockReasonFor, type ModerationCategory } from '../moderation/copy.js';
import type { JobFailureKind } from '../jobs/types.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const appStats = () => firestore().collection(config.stats.appStatsCollection);
const dailyDoc = (appId: string, date: string) =>
  appStats().doc(appId).collection(config.stats.dailySubcollection).doc(date);
const appUsers = () => firestore().collection(config.stats.appUsersCollection);

const userKey = (appId: string, userId: string) => `${appId}__${userId}`;
const nowIso = () => new Date().toISOString();
function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
}
/** TTL timestamp so daily buckets self-delete after retentionDays. */
function expireAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + config.stats.retentionDays * 86_400_000);
}

/** Mark a user as seen; the first time, bump distinct-user counters. Returns true if new. */
async function ensureUserSeen(appId: string, userId: string, date: string): Promise<boolean> {
  const uref = appUsers().doc(userKey(appId, userId));
  const now = nowIso();
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    if (snap.exists) {
      tx.set(uref, { lastSeenAt: now }, { merge: true });
      return false;
    }
    tx.set(uref, { appId, userId, firstSeenAt: now, lastSeenAt: now, hasPurchased: false });
    tx.set(appStats().doc(appId), { appId, users: FieldValue.increment(1), updatedAt: now }, { merge: true });
    tx.set(
      dailyDoc(appId, date),
      { appId, date, newUsers: FieldValue.increment(1), expireAt: expireAt(), updatedAt: now },
      { merge: true },
    );
    return true;
  });
}

/**
 * Record a user login so they show up in the admin the moment they authenticate —
 * even if they never generate a report or buy credits. Creates the `app-users`
 * doc (with `hasPurchased: false`) on first login and tracks login recency/count.
 */
export async function recordLogin(appId: string, userId: string): Promise<void> {
  await ensureUserSeen(appId, userId, utcDate());
  await appUsers()
    .doc(userKey(appId, userId))
    .set({ logins: FieldValue.increment(1), lastLoginAt: nowIso() }, { merge: true });
}

export interface ReportStatsInput {
  appId: string;
  userId: string;
  template: string;
  status: 'completed' | 'failed';
  costUsd: number;
  /** Generation duration in ms (used only when completed). */
  durationMs: number;
  /** Whether the completed report had degraded sections. */
  degraded?: boolean;
  /** For a failure, why — so the admin can tell a cost-ceiling stop from a model error. */
  failureKind?: JobFailureKind;
  /** Whether the buyer got their credits back. Only a refunded failure is a loss. */
  refunded?: boolean;
}

/** Transactionally fold a duration into a doc's min/max gen time. */
async function updateGenMinMax(
  ref: DocumentReference,
  ms: number,
  seed: Record<string, unknown>,
): Promise<void> {
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.exists ? snap.data() : {}) as { genTimeMsMin?: number; genTimeMsMax?: number };
    const genTimeMsMin = d.genTimeMsMin != null ? Math.min(d.genTimeMsMin, ms) : ms;
    const genTimeMsMax = d.genTimeMsMax != null ? Math.max(d.genTimeMsMax, ms) : ms;
    tx.set(ref, { ...seed, genTimeMsMin, genTimeMsMax, updatedAt: nowIso() }, { merge: true });
  });
}

/**
 * Model spend that happens on the REQUEST path, outside any job: the moderation
 * classifier and the assisted pre-flight review. Fractions of a cent per call, but
 * it runs on every preview and every generation — so it is real money that no job
 * cost accounts for.
 *
 * Booked separately from `costUsd` (which is job cost) so the two stay
 * comparable: this is what the product spends *before* deciding to do any work.
 */
export async function recordRequestLlmCost(input: {
  appId: string;
  userId: string;
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  if (!input.usd && !input.inputTokens && !input.outputTokens) return;
  const now = nowIso();
  const date = utcDate();
  // Must come first. `ensureUserSeen` only increments the distinct-user counters
  // when the doc does not exist yet — so creating it here with a bare set() would
  // make this user permanently uncounted, and leave `firstSeenAt` unset.
  await ensureUserSeen(input.appId, input.userId, date);
  const inc = {
    requestLlmUsd: FieldValue.increment(input.usd || 0),
    requestLlmCalls: FieldValue.increment(1),
    requestLlmInputTokens: FieldValue.increment(input.inputTokens || 0),
    requestLlmOutputTokens: FieldValue.increment(input.outputTokens || 0),
    updatedAt: now,
  };
  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...inc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
    appUsers().doc(userKey(input.appId, input.userId)).set({ appId: input.appId, userId: input.userId, ...inc }, { merge: true }),
  ]);
}

/**
 * A moderation call that could not answer — the classifier threw, or returned JSON
 * that would not parse, and the request was allowed through on the fail-open path.
 *
 * Booked as a COUNTER, not as an error: failing open is the designed behaviour and
 * a single occurrence is not an incident. What was missing until round 10 is any
 * way to notice that it stopped being single — §K's decision to leave semantic
 * injection patterns to the classifier assumes the classifier is running, and
 * nothing checked that it was (R10-10). `lastAt` is what turns a count into a
 * question an admin can answer: "is this from March, or from this morning?"
 *
 * `off` is deliberately NOT recorded here. A deployment with `MODERATION_LLM=false`
 * is a configuration, readable directly and true on every request; counting it
 * would drown the incidents it sits next to.
 */
/**
 * A model wrote our own prompt into a section, and the guard removed it.
 *
 * An INCIDENT with no strike, and the asymmetry is the point. An extraction attempt
 * can come from either side, and the responsible party is different:
 *
 *   - The BUYER's own text goes through the pre-screen and the classifier, which
 *     already call it `prompt_injection` ("override or reveal system prompts"),
 *     refuse the request 422, and strike the account — four and it is blocked. That
 *     path is complete and predates this.
 *   - A FETCHED PAGE reaches the model with no pre-screen at all, because it never
 *     passed through our API. When the guard fires on a write, the cause is almost
 *     always a page, and the buyer is the person it happened TO. Striking them would
 *     block a customer for a listing that ranked well.
 *
 * So this counts, names the agent, and stops. What an admin does with a source that
 * tries it is a decision nobody has taken yet, and the counter is what makes taking
 * it possible.
 */
export async function recordPromptEcho(input: {
  appId: string;
  userId: string;
  agentId: string;
  fields: number;
}): Promise<void> {
  const now = nowIso();
  const date = utcDate();
  await ensureUserSeen(input.appId, input.userId, date);
  const inc = {
    promptEchoBlocked: FieldValue.increment(1),
    promptEchoFields: FieldValue.increment(input.fields),
    promptEchoLastAt: now,
    updatedAt: now,
  };
  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...inc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
  ]);
}

export async function recordModerationDegraded(input: {
  appId: string;
  userId: string;
  kind: 'llm_failed' | 'llm_unparsable';
}): Promise<void> {
  const now = nowIso();
  const date = utcDate();
  await ensureUserSeen(input.appId, input.userId, date);
  const inc = {
    moderationFailOpen: FieldValue.increment(1),
    [`moderationFailOpen_${input.kind}`]: FieldValue.increment(1),
    moderationFailOpenLastAt: now,
    updatedAt: now,
  };
  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...inc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
  ]);
}

/** Record a finished report into the app + daily + user aggregates. */
export async function recordReportStats(input: ReportStatsInput): Promise<void> {
  const now = nowIso();
  const date = utcDate();
  await ensureUserSeen(input.appId, input.userId, date);

  const completed = input.status === 'completed';
  const inc: Record<string, unknown> = {
    reports: FieldValue.increment(1),
    // reportsFailed is the total error count; reportsCompleted the successes.
    [completed ? 'reportsCompleted' : 'reportsFailed']: FieldValue.increment(1),
    ...(input.degraded ? { degradedReports: FieldValue.increment(1) } : {}),
    costUsd: FieldValue.increment(input.costUsd || 0),
    // The money we spent and GAVE BACK. Not every failure is refunded any more —
    // an admin can close a job without one — so this counts the refunded ones only.
    // Counting every failure overstated the loss by the cost of each dismissal, in
    // our disfavour, which misleads pricing rather than hiding anything.
    ...(!completed && input.refunded ? { failedCostUsd: FieldValue.increment(input.costUsd || 0) } : {}),
    ...(input.failureKind === 'budget_exceeded' ? { budgetStoppedReports: FieldValue.increment(1) } : {}),
    reportsByTemplate: { [input.template]: FieldValue.increment(1) },
    // avg = genTimeMsTotal / genCount; min/max are maintained transactionally below.
    ...(completed
      ? { genTimeMsTotal: FieldValue.increment(input.durationMs || 0), genCount: FieldValue.increment(1) }
      : {}),
    updatedAt: now,
  };

  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...inc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
    appUsers()
      .doc(userKey(input.appId, input.userId))
      .set(
        { reports: FieldValue.increment(1), costUsd: FieldValue.increment(input.costUsd || 0), lastSeenAt: now },
        { merge: true },
      ),
  ]);

  if (completed && (input.durationMs || 0) > 0) {
    await Promise.all([
      updateGenMinMax(appStats().doc(input.appId), input.durationMs, { appId: input.appId }),
      updateGenMinMax(dailyDoc(input.appId, date), input.durationMs, { appId: input.appId, date, expireAt: expireAt() }),
    ]);
  }
}

export interface PurchaseStatsInput {
  appId: string;
  userId: string;
  amountUsd: number;
  credits: number;
}

/** Record a completed purchase (revenue + credits) into the aggregates. */
export async function recordPurchaseStats(input: PurchaseStatsInput): Promise<void> {
  const now = nowIso();
  const date = utcDate();
  await ensureUserSeen(input.appId, input.userId, date);

  const inc = {
    revenueUsd: FieldValue.increment(input.amountUsd || 0),
    purchases: FieldValue.increment(1),
    creditsPurchased: FieldValue.increment(input.credits || 0),
    updatedAt: now,
  };

  // Flip the user's hasPurchased flag; the FIRST time, they convert from
  // signed-up to paying, so bump the app's payingUsers counter.
  const uref = appUsers().doc(userKey(input.appId, input.userId));
  const firstPurchase = await firestore().runTransaction(async (tx) => {
    const data = (await tx.get(uref)).data() ?? {};
    const wasPaying = data.hasPurchased === true || num(data, 'creditsPurchased') > 0;
    tx.set(
      uref,
      {
        spentUsd: FieldValue.increment(input.amountUsd || 0),
        creditsPurchased: FieldValue.increment(input.credits || 0),
        hasPurchased: true,
        lastSeenAt: now,
      },
      { merge: true },
    );
    return !wasPaying;
  });

  const appInc = firstPurchase ? { ...inc, payingUsers: FieldValue.increment(1) } : inc;
  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...appInc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
  ]);
}

// --- Convenience reads (the real consuming API comes later) -----------------

export async function getAppStats(appId: string): Promise<Record<string, unknown> | null> {
  const snap = await appStats().doc(appId).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

/** The last N daily buckets for an app, newest first. */
export async function getDailyStats(appId: string, days = 60): Promise<Record<string, unknown>[]> {
  const snap = await appStats()
    .doc(appId)
    .collection(config.stats.dailySubcollection)
    .orderBy('date', 'desc')
    .limit(days)
    .get();
  return snap.docs.map((d) => d.data() as Record<string, unknown>);
}

// --- Admin (cross-app) aggregates -------------------------------------------

/** Every app's all-time stats doc. */
export async function listAllAppStats(): Promise<Record<string, unknown>[]> {
  const snap = await appStats().get();
  return snap.docs.map((d) => d.data() as Record<string, unknown>);
}

const num = (d: Record<string, unknown>, k: string): number => (typeof d[k] === 'number' ? (d[k] as number) : 0);

export interface AppStatsRollup {
  appId: string;
  reports: number;
  reportsCompleted: number;
  reportsFailed: number; // total error count
  /** Failures we stopped ourselves at the cost ceiling (refunded, but already paid for). */
  budgetStoppedReports: number;
  degradedReports: number;
  users: number;
  /** Users who have ever purchased credits (the rest signed up but never paid). */
  payingUsers: number;
  costUsd: number;
  /** Of `costUsd`, the part spent on jobs that failed and were refunded — pure loss. */
  failedCostUsd: number;
  /** Request-path model spend (moderation + assisted review), separate from job cost. */
  requestLlmUsd: number;
  requestLlmCalls: number;
  /** Requests allowed through because the moderation classifier could not answer. */
  moderationFailOpen: number;
  /** Writes in which the guard removed our own prompt from a section (never a strike). */
  promptEchoBlocked?: number;
  promptEchoFields?: number;
  promptEchoLastAt?: string;
  revenueUsd: number;
  purchases: number;
  creditsPurchased: number;
  avgGenMs: number | null;
  genTimeMsMin: number | null;
  genTimeMsMax: number | null;
}

export interface AdminStats {
  totals: Omit<AppStatsRollup, 'appId'>;
  apps: AppStatsRollup[];
  daily: Array<{ date: string; reports: number; reportsCompleted: number; reportsFailed: number; costUsd: number; failedCostUsd: number; revenueUsd: number }>;
  /**
   * The state of the layers that decide whether a request is allowed to run at
   * all — the thing an admin should see on the way IN, not after an incident.
   *
   * Round 10 (R10-10) reproduced two shipping paths on which the moderation
   * classifier does not run: `MODERATION_LLM=false`, which is independent of
   * `VALIDATION_LLM` so the assisted review still prompts a model with the buyer's
   * free text; and any admin caller, for whom the whole moderation block is
   * skipped on both routes. §K's decision to stop chasing semantic injection
   * patterns with regexes rests on the classifier running. This block is how that
   * assumption gets checked instead of assumed.
   */
  health: {
    /** `MODERATION_LLM`. False = the deterministic pre-screen is the only layer. */
    classifierEnabled: boolean;
    /** Fail-open events (threw / unparsable) in the last `days` of daily buckets. */
    moderationFailOpenRecent: number;
    /** …and over the lifetime of the app documents. */
    moderationFailOpen: number;
    /** ISO time of the most recent one, across apps. Absent if there has never been one. */
    moderationFailOpenLastAt?: string;
    /** True where an admin's own requests bypass moderation entirely (R10-10). */
    adminBypassesModeration: boolean;
  };
}

function rollup(d: Record<string, unknown>): AppStatsRollup {
  const genTotal = num(d, 'genTimeMsTotal');
  const genCount = num(d, 'genCount');
  return {
    appId: String(d.appId ?? ''),
    reports: num(d, 'reports'),
    reportsCompleted: num(d, 'reportsCompleted'),
    reportsFailed: num(d, 'reportsFailed'),
    budgetStoppedReports: num(d, 'budgetStoppedReports'),
    degradedReports: num(d, 'degradedReports'),
    users: num(d, 'users'),
    payingUsers: num(d, 'payingUsers'),
    costUsd: num(d, 'costUsd'),
    failedCostUsd: num(d, 'failedCostUsd'),
    requestLlmUsd: num(d, 'requestLlmUsd'),
    requestLlmCalls: num(d, 'requestLlmCalls'),
    moderationFailOpen: num(d, 'moderationFailOpen'),
    revenueUsd: num(d, 'revenueUsd'),
    purchases: num(d, 'purchases'),
    creditsPurchased: num(d, 'creditsPurchased'),
    avgGenMs: genCount > 0 ? genTotal / genCount : null,
    genTimeMsMin: typeof d.genTimeMsMin === 'number' ? (d.genTimeMsMin as number) : null,
    genTimeMsMax: typeof d.genTimeMsMax === 'number' ? (d.genTimeMsMax as number) : null,
  };
}

/**
 * Cross-app dashboard aggregate: per-app rollups, global totals (errors =
 * reportsFailed, avg/min/max total gen time), and a merged daily series.
 */
export async function getAdminStats(days = 30): Promise<AdminStats> {
  const docs = await listAllAppStats();
  const apps = docs.map(rollup).sort((a, b) => b.reports - a.reports);

  // Global totals. avg is recomputed from the summed total/count, not averaged.
  let genTotal = 0;
  let genCount = 0;
  const totals: Omit<AppStatsRollup, 'appId'> = {
    reports: 0, reportsCompleted: 0, reportsFailed: 0, budgetStoppedReports: 0, degradedReports: 0,
    users: 0, payingUsers: 0,
    costUsd: 0, failedCostUsd: 0, requestLlmUsd: 0, requestLlmCalls: 0, moderationFailOpen: 0, revenueUsd: 0, purchases: 0, creditsPurchased: 0,
    avgGenMs: null, genTimeMsMin: null, genTimeMsMax: null,
  };
  for (const d of docs) {
    totals.reports += num(d, 'reports');
    totals.reportsCompleted += num(d, 'reportsCompleted');
    totals.reportsFailed += num(d, 'reportsFailed');
    totals.budgetStoppedReports += num(d, 'budgetStoppedReports');
    totals.degradedReports += num(d, 'degradedReports');
    totals.users += num(d, 'users');
    totals.payingUsers += num(d, 'payingUsers');
    totals.costUsd += num(d, 'costUsd');
    totals.failedCostUsd += num(d, 'failedCostUsd');
    totals.requestLlmUsd += num(d, 'requestLlmUsd');
    totals.requestLlmCalls += num(d, 'requestLlmCalls');
    totals.moderationFailOpen += num(d, 'moderationFailOpen');
    totals.revenueUsd += num(d, 'revenueUsd');
    totals.purchases += num(d, 'purchases');
    totals.creditsPurchased += num(d, 'creditsPurchased');
    genTotal += num(d, 'genTimeMsTotal');
    genCount += num(d, 'genCount');
    if (typeof d.genTimeMsMin === 'number') {
      totals.genTimeMsMin = totals.genTimeMsMin == null ? (d.genTimeMsMin as number) : Math.min(totals.genTimeMsMin, d.genTimeMsMin as number);
    }
    if (typeof d.genTimeMsMax === 'number') {
      totals.genTimeMsMax = totals.genTimeMsMax == null ? (d.genTimeMsMax as number) : Math.max(totals.genTimeMsMax, d.genTimeMsMax as number);
    }
  }
  totals.avgGenMs = genCount > 0 ? genTotal / genCount : null;

  // Merge each app's daily buckets by date (summed) → newest-first series.
  let failOpenRecent = 0;
  const byDate = new Map<string, { date: string; reports: number; reportsCompleted: number; reportsFailed: number; costUsd: number; failedCostUsd: number; revenueUsd: number }>();
  await Promise.all(
    apps.map(async (a) => {
      for (const b of await getDailyStats(a.appId, days)) {
        const date = String(b.date ?? '');
        if (!date) continue;
        const cur = byDate.get(date) ?? { date, reports: 0, reportsCompleted: 0, reportsFailed: 0, costUsd: 0, failedCostUsd: 0, revenueUsd: 0 };
        cur.reports += num(b, 'reports');
        cur.reportsCompleted += num(b, 'reportsCompleted');
        cur.reportsFailed += num(b, 'reportsFailed');
        cur.costUsd += num(b, 'costUsd');
        cur.failedCostUsd += num(b, 'failedCostUsd');
        cur.revenueUsd += num(b, 'revenueUsd');
        failOpenRecent += num(b, 'moderationFailOpen');
        byDate.set(date, cur);
      }
    }),
  );
  const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, days);

  const lastAt = docs
    .map((d) => (typeof d.moderationFailOpenLastAt === 'string' ? d.moderationFailOpenLastAt : ''))
    .filter(Boolean)
    .sort()
    .at(-1);
  const health: AdminStats['health'] = {
    classifierEnabled: config.moderation.llm,
    moderationFailOpenRecent: failOpenRecent,
    moderationFailOpen: totals.moderationFailOpen,
    ...(lastAt ? { moderationFailOpenLastAt: lastAt } : {}),
    // Not a setting — a fact about the code, stated here so the dashboard does not
    // have to know it. If the admin bypass is ever removed, this goes with it.
    adminBypassesModeration: true,
  };

  return { totals, apps, daily, health };
}

export interface UserRecord {
  appId: string;
  userId: string;
  reports: number;
  costUsd: number;
  spentUsd: number;
  creditsPurchased: number;
  /** True once the user has ever bought credits; false = signed up but never paid. */
  hasPurchased: boolean;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastLoginAt?: string;
  logins?: number;
  /** Blocked users can still log in and read past reports, but can't generate
   *  reports or buy credits. Set after repeated moderation rejections or by an admin. */
  blocked?: boolean;
  blockedReason?: string;
  blockedAt?: string;
  /** How many times this user's params were rejected by moderation. */
  moderationStrikes?: number;
  /** Assisted (LLM) reviews run without any generation since the last report —
   *  resets to 0 on generation; puts the feature on cooldown when it hits the limit. */
  preflightCount?: number;
  /** While set (ISO), the assisted review is paused for this user. */
  assistCooldownUntil?: string;
  /** How many cooldowns this user has earned (drives the escalating backoff). */
  assistCooldowns?: number;
}

function toUserRecord(d: Record<string, unknown>): UserRecord {
  const creditsPurchased = num(d, 'creditsPurchased');
  return {
    appId: String(d.appId ?? ''),
    userId: String(d.userId ?? ''),
    reports: num(d, 'reports'),
    costUsd: num(d, 'costUsd'),
    spentUsd: num(d, 'spentUsd'),
    creditsPurchased,
    // Legacy docs predate the flag → derive it from purchased credits.
    hasPurchased: d.hasPurchased === true || creditsPurchased > 0,
    firstSeenAt: d.firstSeenAt as string | undefined,
    lastSeenAt: d.lastSeenAt as string | undefined,
    lastLoginAt: d.lastLoginAt as string | undefined,
    logins: typeof d.logins === 'number' ? (d.logins as number) : undefined,
    blocked: d.blocked === true,
    blockedReason: d.blockedReason as string | undefined,
    blockedAt: d.blockedAt as string | undefined,
    moderationStrikes: typeof d.moderationStrikes === 'number' ? (d.moderationStrikes as number) : undefined,
    preflightCount: typeof d.preflightCount === 'number' ? (d.preflightCount as number) : undefined,
    assistCooldownUntil: d.assistCooldownUntil as string | undefined,
    assistCooldowns: typeof d.assistCooldowns === 'number' ? (d.assistCooldowns as number) : undefined,
  };
}

/** A user is blocked from generating reports / buying credits after this many
 *  moderation rejections. */
export const MODERATION_STRIKE_LIMIT = 4;

/** Quick block-state read for enforcing the gate (report generation / checkout). */
export async function getUserFlags(appId: string, userId: string): Promise<{ blocked: boolean; blockedReason?: string }> {
  const snap = await appUsers().doc(userKey(appId, userId)).get();
  const d = snap.exists ? (snap.data() as Record<string, unknown>) : {};
  return { blocked: d.blocked === true, blockedReason: d.blockedReason as string | undefined };
}

/**
 * Record a moderation rejection. Increments the strike counter and, on reaching
 * `MODERATION_STRIKE_LIMIT`, blocks the user. The stored `blockedReason` is copy
 * WE wrote, derived from the closed category set — never a string produced by the
 * classifier, which would otherwise let a crafted request write its own text into
 * the admin panel. The raw categories are kept for triage.
 */
export async function recordModerationStrike(
  appId: string,
  userId: string,
  categories: ModerationCategory[],
): Promise<{ blocked: boolean; strikes: number; blockedReason?: string }> {
  const uref = appUsers().doc(userKey(appId, userId));
  const now = nowIso();
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    const cur = (snap.exists ? snap.data() : {}) as { moderationStrikes?: number; blocked?: boolean; blockedReason?: string };
    if (cur.blocked) return { blocked: true, strikes: cur.moderationStrikes ?? MODERATION_STRIKE_LIMIT, blockedReason: cur.blockedReason };
    const strikes = (cur.moderationStrikes ?? 0) + 1;
    const blockedReason = blockReasonFor(categories);
    const willBlock = strikes >= MODERATION_STRIKE_LIMIT;
    tx.set(
      uref,
      {
        appId,
        userId,
        moderationStrikes: strikes,
        lastModerationCategories: categories,
        updatedAt: now,
        ...(willBlock ? { blocked: true, blockedReason, blockedAt: now } : {}),
      },
      { merge: true },
    );
    return { blocked: willBlock, strikes, blockedReason: willBlock ? blockedReason : undefined };
  });
}

/** Admin block/unblock. Unblocking clears the reason and resets the strike counters. */
export async function setUserBlocked(appId: string, userId: string, blocked: boolean, reason?: string): Promise<void> {
  const now = nowIso();
  await appUsers()
    .doc(userKey(appId, userId))
    .set(
      blocked
        ? { appId, userId, blocked: true, blockedReason: reason ?? 'Blocked by an administrator.', blockedAt: now, updatedAt: now }
        : { blocked: false, blockedReason: FieldValue.delete(), blockedAt: FieldValue.delete(), moderationStrikes: 0, preflightCount: 0, updatedAt: now },
      { merge: true },
    );
}

/**
 * Assisted-review allowance.
 *
 * The assisted (LLM) pass costs tokens and only pays for itself when it leads to
 * a generated report. So a user gets `ASSIST_FREE_ATTEMPTS` assisted previews
 * between reports; past that the feature goes on an escalating cooldown and the
 * preview falls back to the deterministic layer — which is complete on its own,
 * so nothing is blocked and no error is shown. Generating resets the allowance
 * and pays back one escalation step.
 */
/** Assisted reviews allowed for ONE report being drafted. */
export const ASSIST_FREE_ATTEMPTS = config.validation.assistAttempts;
/** Backstop across all drafts between two generated reports. */
export const ASSIST_USER_ATTEMPTS = config.validation.assistUserAttempts;
/** Escalating pause, applied only when the backstop trips. */
export const ASSIST_COOLDOWN_HOURS = config.validation.cooldownHours;
const ASSIST_WINDOW_MS = config.validation.windowHours * 60 * 60 * 1000;

const secondsUntil = (iso: string): number => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 1000));

function cooldownFor(previousCooldowns: number): number {
  const steps = ASSIST_COOLDOWN_HOURS;
  return steps[Math.min(previousCooldowns, steps.length - 1)] ?? steps[steps.length - 1] ?? 1;
}

/** Why an assisted review was refused. */
export type AssistDenial = 'attempts' | 'cooldown';

export interface AssistReservation {
  allowed: boolean;
  /** Set when `allowed` is false. */
  reason?: AssistDenial;
  /** Assisted reviews used for this draft, including the one just claimed. */
  count: number;
  /** Only meaningful for `cooldown`; `attempts` has nothing to wait for. */
  retryAfterSeconds: number;
}

/**
 * Claim one assisted review for a draft.
 *
 * Two limits with deliberately different consequences:
 *
 *  - **Per draft** (`draftId`): the user reads the findings, edits, and re-checks.
 *    Past `ASSIST_FREE_ATTEMPTS` the answer is simply "no more model" — the
 *    deterministic review still runs and generation proceeds immediately. Nothing
 *    to wait for, because iterating on a request is normal behaviour, not abuse.
 *  - **Per user across drafts**: the backstop. Someone cycling draft ids to farm
 *    assisted reviews trips this one, and only this one starts a cooldown.
 *
 * A draft is identified by the client. That is fine precisely because the
 * per-user backstop does not trust it: rotating the id buys a couple more
 * reviews, not unlimited ones.
 */
export async function reserveAssistedReview(
  appId: string,
  userId: string,
  draftId?: string,
): Promise<AssistReservation> {
  const uref = appUsers().doc(userKey(appId, userId));
  const now = nowIso();
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    const cur = (snap.exists ? snap.data() : {}) as {
      preflightCount?: number;
      preflightAt?: string;
      assistCooldownUntil?: string;
      assistCooldowns?: number;
      assistDraftId?: string;
      assistDraftCount?: number;
    };

    if (cur.assistCooldownUntil && Date.parse(cur.assistCooldownUntil) > Date.now()) {
      return { allowed: false, reason: 'cooldown' as const, count: 0, retryAfterSeconds: secondsUntil(cur.assistCooldownUntil) };
    }

    // Per draft. A new draft id starts its own count; the previous one is dropped,
    // since a user works on one report at a time.
    const sameDraft = !!draftId && cur.assistDraftId === draftId;
    const draftCount = (sameDraft ? cur.assistDraftCount ?? 0 : 0) + 1;
    if (draftId && draftCount > ASSIST_FREE_ATTEMPTS) {
      // Deliberately writes nothing: this is not a violation, just the end of the
      // useful part. Retrying costs nothing and stays refused.
      return { allowed: false, reason: 'attempts' as const, count: draftCount - 1, retryAfterSeconds: 0 };
    }

    // Per user across drafts — the window lapses on its own, so an idle user never
    // accumulates.
    const lastMs = cur.preflightAt ? Date.parse(cur.preflightAt) : 0;
    const withinWindow = !!lastMs && Date.parse(now) - lastMs <= ASSIST_WINDOW_MS;
    const userCount = (withinWindow ? cur.preflightCount ?? 0 : 0) + 1;
    if (userCount > ASSIST_USER_ATTEMPTS) {
      const cooldowns = cur.assistCooldowns ?? 0;
      const until = new Date(Date.now() + cooldownFor(cooldowns) * 60 * 60 * 1000).toISOString();
      tx.set(
        uref,
        { appId, userId, preflightCount: 0, assistCooldownUntil: until, assistCooldowns: cooldowns + 1, updatedAt: now },
        { merge: true },
      );
      return { allowed: false, reason: 'cooldown' as const, count: 0, retryAfterSeconds: secondsUntil(until) };
    }

    tx.set(
      uref,
      {
        appId,
        userId,
        preflightCount: userCount,
        preflightAt: now,
        ...(draftId ? { assistDraftId: draftId, assistDraftCount: draftCount } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
    return { allowed: true, count: draftCount, retryAfterSeconds: 0 };
  });
}

/**
 * The user generated a report — the assisted previews they ran did their job.
 * Resets the allowance, lifts any cooldown, and pays back one escalation step.
 */
export async function resetAssistAllowance(appId: string, userId: string): Promise<void> {
  const uref = appUsers().doc(userKey(appId, userId));
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    const cooldowns = (snap.exists ? (snap.data()?.assistCooldowns as number | undefined) : undefined) ?? 0;
    tx.set(
      uref,
      {
        preflightCount: 0,
        preflightAt: FieldValue.delete(),
        assistDraftId: FieldValue.delete(),
        assistDraftCount: 0,
        assistCooldownUntil: FieldValue.delete(),
        assistCooldowns: Math.max(0, cooldowns - 1),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  });
}

/**
 * Search/list users from the `app-users` rollup. Filter by app and/or an email
 * prefix (case-sensitive prefix match on userId). Needs composite indexes in
 * prod: (appId, userId) for the prefix path, (appId, lastSeenAt desc) otherwise.
 */
export async function queryUsers(
  opts: { appId?: string; emailPrefix?: string; limit?: number; neverPurchased?: boolean; blocked?: boolean } = {},
): Promise<UserRecord[]> {
  let q: Query = appUsers();
  if (opts.appId) q = q.where('appId', '==', opts.appId);
  if (opts.emailPrefix) {
    q = q.where('userId', '>=', opts.emailPrefix).where('userId', '<', `${opts.emailPrefix}`).orderBy('userId');
  } else {
    q = q.orderBy('lastSeenAt', 'desc');
  }
  const inMemoryFilter = opts.neverPurchased || opts.blocked;
  const limit = opts.limit ?? 50;
  // When filtering in memory, over-fetch so the page can still fill up.
  const snap = await q.limit(inMemoryFilter ? Math.max(limit, 300) : limit).get();
  let users = snap.docs.map((d) => toUserRecord(d.data() as Record<string, unknown>));
  if (opts.neverPurchased) users = users.filter((u) => !u.hasPurchased);
  if (opts.blocked) users = users.filter((u) => u.blocked);
  return users.slice(0, limit);
}
