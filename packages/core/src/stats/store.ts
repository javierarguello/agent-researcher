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
    tx.set(uref, { appId, userId, firstSeenAt: now, lastSeenAt: now });
    tx.set(appStats().doc(appId), { appId, users: FieldValue.increment(1), updatedAt: now }, { merge: true });
    tx.set(
      dailyDoc(appId, date),
      { appId, date, newUsers: FieldValue.increment(1), expireAt: expireAt(), updatedAt: now },
      { merge: true },
    );
    return true;
  });
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

  await Promise.all([
    appStats().doc(input.appId).set({ appId: input.appId, ...inc }, { merge: true }),
    dailyDoc(input.appId, date).set({ appId: input.appId, date, expireAt: expireAt(), ...inc }, { merge: true }),
    appUsers()
      .doc(userKey(input.appId, input.userId))
      .set(
        {
          spentUsd: FieldValue.increment(input.amountUsd || 0),
          creditsPurchased: FieldValue.increment(input.credits || 0),
          lastSeenAt: now,
        },
        { merge: true },
      ),
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
    reports: 0, reportsCompleted: 0, reportsFailed: 0, degradedReports: 0, users: 0,
    costUsd: 0, revenueUsd: 0, purchases: 0, creditsPurchased: 0,
    avgGenMs: null, genTimeMsMin: null, genTimeMsMax: null,
  };
  for (const d of docs) {
    totals.reports += num(d, 'reports');
    totals.reportsCompleted += num(d, 'reportsCompleted');
    totals.reportsFailed += num(d, 'reportsFailed');
    totals.degradedReports += num(d, 'degradedReports');
    totals.users += num(d, 'users');
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
  firstSeenAt?: string;
  lastSeenAt?: string;
}

/**
 * Search/list users from the `app-users` rollup. Filter by app and/or an email
 * prefix (case-sensitive prefix match on userId). Needs composite indexes in
 * prod: (appId, userId) for the prefix path, (appId, lastSeenAt desc) otherwise.
 */
export async function queryUsers(opts: { appId?: string; emailPrefix?: string; limit?: number } = {}): Promise<UserRecord[]> {
  let q: Query = appUsers();
  if (opts.appId) q = q.where('appId', '==', opts.appId);
  if (opts.emailPrefix) {
    q = q.where('userId', '>=', opts.emailPrefix).where('userId', '<', `${opts.emailPrefix}`).orderBy('userId');
  } else {
    q = q.orderBy('lastSeenAt', 'desc');
  }
  const snap = await q.limit(opts.limit ?? 50).get();
  return snap.docs.map((d) => d.data() as UserRecord);
}
