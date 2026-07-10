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
import { FieldValue, Firestore, Timestamp } from '@google-cloud/firestore';
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
}

/** Record a finished report into the app + daily + user aggregates. */
export async function recordReportStats(input: ReportStatsInput): Promise<void> {
  const now = nowIso();
  const date = utcDate();
  await ensureUserSeen(input.appId, input.userId, date);

  const completed = input.status === 'completed';
  const inc: Record<string, unknown> = {
    reports: FieldValue.increment(1),
    [completed ? 'reportsCompleted' : 'reportsFailed']: FieldValue.increment(1),
    costUsd: FieldValue.increment(input.costUsd || 0),
    reportsByTemplate: { [input.template]: FieldValue.increment(1) },
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
