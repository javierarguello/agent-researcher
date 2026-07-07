/**
 * General settings (Firestore `settings/general`).
 *
 * Holds the default rate limits applied to apps and users. Editable at runtime
 * (admin endpoint / CLI). An app may override its own cap via its app doc's
 * `rateLimitPerHour`; users always use the settings default.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';

export interface GeneralSettings {
  /** Default reports/hour per app (null = unlimited). */
  appRateLimitPerHour: number | null;
  /** Default reports/hour per user (null = unlimited). */
  userRateLimitPerHour: number | null;
  updatedAt: string;
}

/** Applied when the settings doc does not exist yet. */
export const DEFAULT_SETTINGS = { appRateLimitPerHour: 100, userRateLimitPerHour: 20 };

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
  return {
    appRateLimitPerHour:
      'appRateLimitPerHour' in d
        ? (d.appRateLimitPerHour as number | null)
        : DEFAULT_SETTINGS.appRateLimitPerHour,
    userRateLimitPerHour:
      'userRateLimitPerHour' in d
        ? (d.userRateLimitPerHour as number | null)
        : DEFAULT_SETTINGS.userRateLimitPerHour,
    updatedAt: (d.updatedAt as string) ?? '',
  };
}

export interface UpdateSettingsInput {
  appRateLimitPerHour?: number | null;
  userRateLimitPerHour?: number | null;
}

export async function updateSettings(patch: UpdateSettingsInput): Promise<GeneralSettings> {
  const data: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.appRateLimitPerHour !== undefined) data.appRateLimitPerHour = patch.appRateLimitPerHour;
  if (patch.userRateLimitPerHour !== undefined) data.userRateLimitPerHour = patch.userRateLimitPerHour;
  await settingsDoc().set(data, { merge: true });
  return getSettings();
}

/** Creates the settings doc with defaults if it does not exist yet. */
export async function ensureDefaultSettings(): Promise<GeneralSettings> {
  const snap = await settingsDoc().get();
  if (!snap.exists) await settingsDoc().set({ ...DEFAULT_SETTINGS, updatedAt: nowIso() });
  return getSettings();
}
