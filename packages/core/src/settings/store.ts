/**
 * General settings (Firestore `settings/general`).
 *
 * Holds the default rate limits applied to apps and users, and the monthly spend
 * limits. Editable at runtime (admin endpoint / CLI). An app may override its own
 * hourly cap via its app doc's `rateLimitPerHour`, and carries its own monthly
 * spend cap/alert on the same doc; users always use the settings default.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';

export interface GeneralSettings {
  /** Default reports/hour per app (null = unlimited). */
  appRateLimitPerHour: number | null;
  /** Default reports/hour per user (null = unlimited). */
  userRateLimitPerHour: number | null;
  /**
   * Hard cap on what the whole deployment may spend (LLM + search) in one UTC
   * calendar month, in USD. Reached → no new job is accepted and no queued job
   * starts until next month or until an admin raises it. null = no cap.
   */
  globalMonthlySpendCapUsd: number | null;
  /** Email the admins once a month when the global spend passes this (USD). null = no alert. */
  globalMonthlySpendAlertUsd: number | null;
  /** Who gets the spend alerts. Empty = the admin app's `adminEmails`. */
  spendAlertEmails: string[];
  /** Manual kill switch: while true, no new job is accepted and no queued job starts. */
  jobsPaused: boolean;
  /**
   * The Postmark plan, for the admin's cost estimate only (Postmark has no billing
   * API). Flat monthly fee, emails it includes, and USD per 1,000 past that.
   * Not a cap: mail is a fixed plan, not per-job spend.
   */
  postmarkPlanUsd: number | null;
  postmarkIncludedEmails: number | null;
  postmarkOveragePer1000Usd: number | null;
  updatedAt: string;
}

/** Applied when the settings doc does not exist yet, or lacks a field. */
export const DEFAULT_SETTINGS = {
  appRateLimitPerHour: 100,
  userRateLimitPerHour: 20,
  globalMonthlySpendCapUsd: 200,
  globalMonthlySpendAlertUsd: 100,
  spendAlertEmails: [] as string[],
  jobsPaused: false,
  postmarkPlanUsd: null as number | null,
  postmarkIncludedEmails: null as number | null,
  postmarkOveragePer1000Usd: null as number | null,
};

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}

const settingsDoc = () => firestore().collection(config.settings.collection).doc(config.settings.generalDoc);
const nowIso = () => new Date().toISOString();

export async function getSettings(): Promise<GeneralSettings> {
  const snap = await settingsDoc().get();
  const d = (snap.exists ? snap.data() : undefined) ?? {};
  // Distinguish "field absent" (use default) from "field is null" (unlimited):
  // a present null must survive, so check presence rather than using `??`.
  const nullable = (
    k:
      | 'appRateLimitPerHour' | 'userRateLimitPerHour' | 'globalMonthlySpendCapUsd' | 'globalMonthlySpendAlertUsd'
      | 'postmarkPlanUsd' | 'postmarkIncludedEmails' | 'postmarkOveragePer1000Usd',
  ) =>
    k in d ? (d[k] as number | null) : DEFAULT_SETTINGS[k];
  return {
    appRateLimitPerHour: nullable('appRateLimitPerHour'),
    userRateLimitPerHour: nullable('userRateLimitPerHour'),
    globalMonthlySpendCapUsd: nullable('globalMonthlySpendCapUsd'),
    globalMonthlySpendAlertUsd: nullable('globalMonthlySpendAlertUsd'),
    spendAlertEmails: Array.isArray(d.spendAlertEmails) ? (d.spendAlertEmails as string[]) : DEFAULT_SETTINGS.spendAlertEmails,
    jobsPaused: d.jobsPaused === true,
    postmarkPlanUsd: nullable('postmarkPlanUsd'),
    postmarkIncludedEmails: nullable('postmarkIncludedEmails'),
    postmarkOveragePer1000Usd: nullable('postmarkOveragePer1000Usd'),
    updatedAt: (d.updatedAt as string) ?? '',
  };
}

export interface UpdateSettingsInput {
  appRateLimitPerHour?: number | null;
  userRateLimitPerHour?: number | null;
  globalMonthlySpendCapUsd?: number | null;
  globalMonthlySpendAlertUsd?: number | null;
  spendAlertEmails?: string[];
  jobsPaused?: boolean;
  postmarkPlanUsd?: number | null;
  postmarkIncludedEmails?: number | null;
  postmarkOveragePer1000Usd?: number | null;
}

export async function updateSettings(patch: UpdateSettingsInput): Promise<GeneralSettings> {
  const data: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) data[k] = v;
  await settingsDoc().set(data, { merge: true });
  return getSettings();
}

/** Creates the settings doc with defaults if it does not exist yet. */
export async function ensureDefaultSettings(): Promise<GeneralSettings> {
  const snap = await settingsDoc().get();
  if (!snap.exists) await settingsDoc().set({ ...DEFAULT_SETTINGS, updatedAt: nowIso() });
  return getSettings();
}
