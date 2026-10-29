/**
 * Monthly spend ledger and the caps that read it (Firestore `spend/{YYYY-MM}`).
 *
 *   spend/2026-10  { month, totalUsd, apps: { fbizlab: 12.3 },
 *                    searchUsd, searchCalls, appsSearchUsd: { fbizlab: 1.2 },
 *                    alerted: { 'global:alert': iso } }
 *
 * `totalUsd` is everything (LLM + search) and is what the caps read; the search
 * fields are the web-search provider's slice of it, kept so the admin can see what
 * the provider costs apart from the model.
 *
 * Why our own ledger and not the GCP bill: the bill arrives hours late and has no
 * idea which app a Vertex call belonged to, so it can neither stop a runaway in
 * time nor cap one app without capping all of them. Every paid call already lands
 * in a CostSink; this books those figures as they happen. The GCP budget on the
 * billing account stays as the backstop for whatever this does not see (infra).
 *
 * What gets booked: job cost as each dispatch persists it (`bookJobCost`, delta
 * against what the job already booked, so a re-save never double-counts), and the
 * per-request LLM calls (moderation, assist) via `recordRequestLlmCost`.
 */
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import { getApp } from '../apps/store.js';
import type { AppRecord } from '../apps/types.js';
import { sendAppEmail } from '../email/postmark.js';
import { getSettings, type GeneralSettings } from '../settings/store.js';
import { jobLogger } from '../obs/log.js';

const log = jobLogger({ jobId: '-' });

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const spendDoc = (month: string) => firestore().collection(config.spend.collection).doc(month);
const jobDoc = (jobId: string) => firestore().collection(config.jobs.collection).doc(jobId);

/** The UTC calendar month a spend belongs to, `YYYY-MM`. */
export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export interface MonthSpend {
  month: string;
  totalUsd: number;
  /** USD per appId. */
  apps: Record<string, number>;
  /** The web-search provider's share of `totalUsd`, and how many billed calls made it. */
  searchUsd: number;
  searchCalls: number;
  /** Search USD per appId. */
  appsSearchUsd: Record<string, number>;
}

export async function getMonthSpend(month = monthKey()): Promise<MonthSpend> {
  const snap = await spendDoc(month).get();
  const d = (snap.exists ? snap.data() : undefined) ?? {};
  return {
    month,
    totalUsd: typeof d.totalUsd === 'number' ? d.totalUsd : 0,
    apps: (d.apps as Record<string, number> | undefined) ?? {},
    searchUsd: typeof d.searchUsd === 'number' ? d.searchUsd : 0,
    searchCalls: typeof d.searchCalls === 'number' ? d.searchCalls : 0,
    appsSearchUsd: (d.appsSearchUsd as Record<string, number> | undefined) ?? {},
  };
}

/** A positive cap, or null for "no cap" (absent, null, 0 and negatives all mean none). */
const capOf = (v: number | null | undefined): number | null => (typeof v === 'number' && v > 0 ? v : null);

export interface SpendBlock {
  /** `paused` = the admin's kill switch; `global`/`app` = a monthly cap was reached. */
  scope: 'paused' | 'global' | 'app';
  spentUsd: number;
  capUsd: number | null;
}

/**
 * Whether new spend is refused, and why. Pure, so the rule is testable without a
 * store: the kill switch first, then the global cap, then the app's own.
 * Reaching a cap blocks (`>=`): at exactly $200 of a $200 cap, nothing more starts.
 */
export function spendBlockFor(
  spend: MonthSpend,
  settings: Pick<GeneralSettings, 'jobsPaused' | 'globalMonthlySpendCapUsd'>,
  app: Pick<AppRecord, 'appId' | 'monthlySpendCapUsd'> | undefined,
): SpendBlock | null {
  if (settings.jobsPaused) return { scope: 'paused', spentUsd: spend.totalUsd, capUsd: null };
  const globalCap = capOf(settings.globalMonthlySpendCapUsd);
  if (globalCap != null && spend.totalUsd >= globalCap) return { scope: 'global', spentUsd: spend.totalUsd, capUsd: globalCap };
  const appCap = capOf(app?.monthlySpendCapUsd);
  const appSpent = app ? (spend.apps[app.appId] ?? 0) : 0;
  if (appCap != null && appSpent >= appCap) return { scope: 'app', spentUsd: appSpent, capUsd: appCap };
  return null;
}

/** Reads settings, the app and this month's spend, and answers `spendBlockFor`. */
export async function checkSpendBlock(appId: string): Promise<SpendBlock | null> {
  const [spend, settings, app] = await Promise.all([getMonthSpend(), getSettings(), getApp(appId)]);
  return spendBlockFor(spend, settings, app);
}

/**
 * Add `usd` to this month's ledger, for the whole deployment and for `appId`,
 * then send any alert that this booking crossed. Never throws: a ledger write
 * that fails must not fail the paid work it is counting — it is logged loudly.
 *
 * `search` is the part of `usd` (and the calls) that went to the web-search
 * provider; omitted, the whole amount is model spend.
 */
export async function bookSpend(appId: string, usd: number, search?: { usd: number; calls: number }): Promise<void> {
  const searchUsd = Math.max(0, search?.usd ?? 0);
  const searchCalls = Math.max(0, search?.calls ?? 0);
  if (!(usd > 0) && !(searchCalls > 0)) return;
  const month = monthKey();
  try {
    await spendDoc(month).set(
      {
        month,
        totalUsd: FieldValue.increment(Math.max(0, usd)),
        apps: { [appId]: FieldValue.increment(Math.max(0, usd)) },
        ...(searchUsd > 0 || searchCalls > 0
          ? { searchUsd: FieldValue.increment(searchUsd), searchCalls: FieldValue.increment(searchCalls), appsSearchUsd: { [appId]: FieldValue.increment(searchUsd) } }
          : {}),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (err) {
    log.error('spend.book_failed', { appId, usd, message: (err as Error).message });
    return;
  }
  await notifyCrossings(appId, month).catch((err) =>
    log.error('spend.alert_failed', { appId, message: (err as Error).message }),
  );
}

/**
 * Persist a job's running cost and book whatever it adds to the month.
 *
 * The job doc carries what it already put in the ledger — `costBookedUsd` (the
 * total), `costBookedSearchUsd` and `costBookedSearchCalls` (the search slice) —
 * written in the same transaction as the cost, so a dispatch that re-saves the
 * same total books nothing, and a total that went DOWN (a stale dispatch writing
 * an older view) books nothing either rather than a negative.
 *
 * The two search fields arrived a release after `costBookedUsd`. A job already in
 * flight across that deploy reads them as 0 and books its whole search slice on
 * its next save: the search figure catches up, and the total — which the caps
 * read — is unaffected, because it is booked from `costBookedUsd` alone.
 */
export async function bookJobCost(
  jobId: string,
  cost: { usd: number; searchUsd?: number; searchCalls?: number } & Record<string, unknown>,
): Promise<void> {
  const booked = await firestore().runTransaction(async (tx) => {
    const ref = jobDoc(jobId);
    const snap = await tx.get(ref);
    const d = snap.data() ?? {};
    const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
    const delta = Math.max(0, (cost.usd || 0) - num('costBookedUsd'));
    const searchUsd = Math.max(0, (cost.searchUsd || 0) - num('costBookedSearchUsd'));
    const searchCalls = Math.max(0, (cost.searchCalls || 0) - num('costBookedSearchCalls'));
    tx.set(
      ref,
      {
        cost,
        costBookedUsd: num('costBookedUsd') + delta,
        costBookedSearchUsd: num('costBookedSearchUsd') + searchUsd,
        costBookedSearchCalls: num('costBookedSearchCalls') + searchCalls,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return { delta, searchUsd, searchCalls, appId: d.appId as string | undefined };
  });
  if ((booked.delta > 0 || booked.searchCalls > 0) && booked.appId) {
    await bookSpend(booked.appId, booked.delta, { usd: booked.searchUsd, calls: booked.searchCalls });
  }
}

/**
 * Email the admins the first time this month a threshold is passed. Each
 * threshold is claimed in a transaction on the month doc (`alerted.<key>`), so two
 * workers crossing it together send one mail, not two.
 */
async function notifyCrossings(appId: string, month: string): Promise<void> {
  const [settings, app] = await Promise.all([getSettings(), getApp(appId)]);
  const checks: Array<{ key: string; label: string; spent: (s: MonthSpend) => number; at: number | null }> = [
    { key: 'global:alert', label: 'Global monthly spend alert', spent: (s) => s.totalUsd, at: capOf(settings.globalMonthlySpendAlertUsd) },
    { key: 'global:cap', label: 'Global monthly spend CAP reached — new jobs are refused', spent: (s) => s.totalUsd, at: capOf(settings.globalMonthlySpendCapUsd) },
    { key: `app:${appId}:alert`, label: `App "${appId}" monthly spend alert`, spent: (s) => s.apps[appId] ?? 0, at: capOf(app?.monthlySpendAlertUsd) },
    { key: `app:${appId}:cap`, label: `App "${appId}" monthly spend CAP reached — its new jobs are refused`, spent: (s) => s.apps[appId] ?? 0, at: capOf(app?.monthlySpendCapUsd) },
  ];
  if (!checks.some((c) => c.at != null)) return;

  const claimed = await firestore().runTransaction(async (tx) => {
    const ref = spendDoc(month);
    const snap = await tx.get(ref);
    const d = snap.data() ?? {};
    const spend: MonthSpend = { month, totalUsd: (d.totalUsd as number) ?? 0, apps: (d.apps as Record<string, number>) ?? {}, searchUsd: 0, searchCalls: 0, appsSearchUsd: {} };
    const alerted = (d.alerted as Record<string, string> | undefined) ?? {};
    const now = new Date().toISOString();
    const crossed = checks.filter((c) => c.at != null && c.spent(spend) >= c.at && !alerted[c.key]);
    if (crossed.length) tx.set(ref, { alerted: Object.fromEntries(crossed.map((c) => [c.key, now])) }, { merge: true });
    return crossed.map((c) => ({ ...c, spentUsd: c.spent(spend) }));
  });
  if (!claimed.length) return;

  for (const c of claimed) log.warn('spend.threshold', { key: c.key, month, spentUsd: c.spentUsd, thresholdUsd: c.at });
  const admin = await getApp('admin');
  const to = settings.spendAlertEmails.length ? settings.spendAlertEmails : (admin?.adminEmails ?? []);
  // Sent as the app that spent — it is the one with a verified From address; the
  // admin app usually has none.
  const sender = app?.emailFrom ? app : admin;
  if (!sender || !to.length) {
    log.error('spend.alert_unsendable', { reason: !to.length ? 'no recipients' : 'no app with emailFrom', keys: claimed.map((c) => c.key) });
    return;
  }
  const lines = claimed.map((c) => `${c.label}: $${c.spentUsd.toFixed(2)} spent in ${month} (threshold $${c.at!.toFixed(2)}).`);
  const subject = `[agent-researcher ${config.server.appEnv}] ${claimed[0]!.label}`;
  for (const addr of to) {
    await sendAppEmail({
      app: sender,
      to: addr,
      subject,
      textBody: lines.join('\n') + '\n\nLimits are edited in the admin app → Limits.',
      htmlBody: `<p>${lines.join('<br>')}</p><p>Limits are edited in the admin app → Limits.</p>`,
    }).catch((err) => log.error('spend.alert_send_failed', { to: addr, message: (err as Error).message }));
  }
}
