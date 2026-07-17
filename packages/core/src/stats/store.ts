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
  degradedReports: number;
  users: number;
  /** Users who have ever purchased credits (the rest signed up but never paid). */
  payingUsers: number;
  costUsd: number;
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
  daily: Array<{ date: string; reports: number; reportsCompleted: number; reportsFailed: number; costUsd: number; revenueUsd: number }>;
}

function rollup(d: Record<string, unknown>): AppStatsRollup {
  const genTotal = num(d, 'genTimeMsTotal');
  const genCount = num(d, 'genCount');
  return {
    appId: String(d.appId ?? ''),
    reports: num(d, 'reports'),
    reportsCompleted: num(d, 'reportsCompleted'),
    reportsFailed: num(d, 'reportsFailed'),
    degradedReports: num(d, 'degradedReports'),
    users: num(d, 'users'),
    payingUsers: num(d, 'payingUsers'),
    costUsd: num(d, 'costUsd'),
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
    reports: 0, reportsCompleted: 0, reportsFailed: 0, degradedReports: 0, users: 0, payingUsers: 0,
    costUsd: 0, revenueUsd: 0, purchases: 0, creditsPurchased: 0,
    avgGenMs: null, genTimeMsMin: null, genTimeMsMax: null,
  };
  for (const d of docs) {
    totals.reports += num(d, 'reports');
    totals.reportsCompleted += num(d, 'reportsCompleted');
    totals.reportsFailed += num(d, 'reportsFailed');
    totals.degradedReports += num(d, 'degradedReports');
    totals.users += num(d, 'users');
    totals.payingUsers += num(d, 'payingUsers');
    totals.costUsd += num(d, 'costUsd');
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
  const byDate = new Map<string, { date: string; reports: number; reportsCompleted: number; reportsFailed: number; costUsd: number; revenueUsd: number }>();
  await Promise.all(
    apps.map(async (a) => {
      for (const b of await getDailyStats(a.appId, days)) {
        const date = String(b.date ?? '');
        if (!date) continue;
        const cur = byDate.get(date) ?? { date, reports: 0, reportsCompleted: 0, reportsFailed: 0, costUsd: 0, revenueUsd: 0 };
        cur.reports += num(b, 'reports');
        cur.reportsCompleted += num(b, 'reportsCompleted');
        cur.reportsFailed += num(b, 'reportsFailed');
        cur.costUsd += num(b, 'costUsd');
        cur.revenueUsd += num(b, 'revenueUsd');
        byDate.set(date, cur);
      }
    }),
  );
  const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, days);

  return { totals, apps, daily };
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
 * `MODERATION_STRIKE_LIMIT`, blocks the user (storing the moderation explanation +
 * what was detected as `blockedReason`). Returns the new state.
 */
export async function recordModerationStrike(
  appId: string,
  userId: string,
  detail: { reason?: string; categories?: string[] },
): Promise<{ blocked: boolean; strikes: number; blockedReason?: string }> {
  const uref = appUsers().doc(userKey(appId, userId));
  const now = nowIso();
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    const cur = (snap.exists ? snap.data() : {}) as { moderationStrikes?: number; blocked?: boolean; blockedReason?: string };
    if (cur.blocked) return { blocked: true, strikes: cur.moderationStrikes ?? MODERATION_STRIKE_LIMIT, blockedReason: cur.blockedReason };
    const strikes = (cur.moderationStrikes ?? 0) + 1;
    const detected = detail.categories?.length ? ` (detected: ${detail.categories.join(', ')})` : '';
    const blockedReason = `${detail.reason ?? 'Repeated policy violations in report requests.'}${detected}`;
    const willBlock = strikes >= MODERATION_STRIKE_LIMIT;
    tx.set(
      uref,
      { appId, userId, moderationStrikes: strikes, updatedAt: now, ...(willBlock ? { blocked: true, blockedReason, blockedAt: now } : {}) },
      { merge: true },
    );
    return { blocked: willBlock, strikes, blockedReason: willBlock ? blockedReason : undefined };
  });
}

/** Admin block/unblock. Unblocking clears the reason and resets the strike count. */
export async function setUserBlocked(appId: string, userId: string, blocked: boolean, reason?: string): Promise<void> {
  const now = nowIso();
  await appUsers()
    .doc(userKey(appId, userId))
    .set(
      blocked
        ? { appId, userId, blocked: true, blockedReason: reason ?? 'Blocked by an administrator.', blockedAt: now, updatedAt: now }
        : { blocked: false, blockedReason: FieldValue.delete(), blockedAt: FieldValue.delete(), moderationStrikes: 0, updatedAt: now },
      { merge: true },
    );
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
