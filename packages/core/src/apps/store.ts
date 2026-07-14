/**
 * App registry + per-app rate limiting, backed by Firestore.
 *
 *   apps collection:        one doc per app (doc id = appId), holds the apiKey,
 *                           active flag, role, and optional rateLimitPerHour.
 *   rate-limits collection: one counter doc per app per calendar hour.
 */
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { AppRecord, AppRole } from './types.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}

const apps = () => firestore().collection(config.apps.collection);
const rateLimits = () => firestore().collection(config.rateLimits.collection);

const nowIso = () => new Date().toISOString();

/** Generates a fresh secret API key, e.g. "ar_a1b2…". */
export function generateApiKey(prefix = 'ar'): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

export interface CreateAppInput {
  name: string;
  role?: AppRole;
  appId?: string;
  apiKey?: string;
  active?: boolean;
  rateLimitPerHour?: number;
  googleClientId?: string;
  adminEmails?: string[];
  allowedTemplates?: string[];
}

export async function createApp(input: CreateAppInput): Promise<AppRecord> {
  const now = nowIso();
  const app: AppRecord = {
    appId: input.appId ?? randomUUID(),
    name: input.name,
    apiKey: input.apiKey ?? generateApiKey(input.role === 'admin' ? 'ar_admin' : 'ar'),
    active: input.active ?? true,
    role: input.role ?? 'app',
    ...(input.rateLimitPerHour != null ? { rateLimitPerHour: input.rateLimitPerHour } : {}),
    ...(input.googleClientId ? { googleClientId: input.googleClientId } : {}),
    ...(input.adminEmails ? { adminEmails: input.adminEmails } : {}),
    ...(input.allowedTemplates ? { allowedTemplates: input.allowedTemplates } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await apps().doc(app.appId).set(app);
  return app;
}

export async function getApp(appId: string): Promise<AppRecord | undefined> {
  const snap = await apps().doc(appId).get();
  return snap.exists ? (snap.data() as AppRecord) : undefined;
}

/** Resolves an app by its API key. Returns undefined if not found or inactive. */
export async function getAppByApiKey(apiKey: string): Promise<AppRecord | undefined> {
  if (!apiKey) return undefined;
  const q = await apps().where('apiKey', '==', apiKey).limit(1).get();
  if (q.empty) return undefined;
  const app = q.docs[0]!.data() as AppRecord;
  return app.active ? app : undefined;
}

export async function listApps(): Promise<AppRecord[]> {
  const q = await apps().get();
  return q.docs.map((d) => d.data() as AppRecord);
}

export async function deleteApp(appId: string): Promise<void> {
  await apps().doc(appId).delete();
}

export interface UpdateAppInput {
  name?: string;
  active?: boolean;
  rateLimitPerHour?: number | null; // null clears the limit
  googleClientId?: string;
  adminEmails?: string[];
  allowedTemplates?: string[];
}

export async function updateApp(appId: string, patch: UpdateAppInput): Promise<AppRecord | undefined> {
  const ref = apps().doc(appId);
  const snap = await ref.get();
  if (!snap.exists) return undefined;
  const data: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.name != null) data.name = patch.name;
  if (patch.active != null) data.active = patch.active;
  if (patch.rateLimitPerHour === null) data.rateLimitPerHour = FieldValue.delete();
  else if (patch.rateLimitPerHour != null) data.rateLimitPerHour = patch.rateLimitPerHour;
  if (patch.googleClientId != null) data.googleClientId = patch.googleClientId;
  if (patch.adminEmails != null) data.adminEmails = patch.adminEmails;
  if (patch.allowedTemplates != null) data.allowedTemplates = patch.allowedTemplates;
  await ref.set(data, { merge: true });
  return (await ref.get()).data() as AppRecord;
}

/** One dimension to rate-limit (e.g. an app or a user) with its hourly cap. */
export interface RateLimitEntry {
  /** Namespaced key, e.g. "app:<appId>" or "user:<userId>". */
  key: string;
  /** Max allowed per calendar hour. Ignored if null/<=0. */
  limit: number | null | undefined;
  /** For error reporting: which scope this entry represents. */
  scope: string;
}

export interface RateLimitViolation {
  scope: string;
  limit: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  violation?: RateLimitViolation;
  /** Calendar-hour bucket the decision applies to (yyyy-mm-ddTHH, UTC). */
  bucket: string;
}

/**
 * Atomically checks ALL given dimensions and, only if none is over its cap,
 * increments every one. If any is exceeded, nothing is incremented and the
 * first violation is returned. Buckets by calendar hour (UTC).
 */
export async function checkRateLimits(entries: RateLimitEntry[]): Promise<RateLimitResult> {
  const bucket = nowIso().slice(0, 13); // "yyyy-mm-ddTHH"
  const active = entries.filter((e) => typeof e.limit === 'number' && e.limit > 0) as Array<
    Required<Pick<RateLimitEntry, 'key' | 'scope'>> & { limit: number }
  >;
  if (active.length === 0) return { allowed: true, bucket };

  return firestore().runTransaction(async (tx) => {
    const refs = active.map((e) => rateLimits().doc(`${e.key}:${bucket}`));
    const snaps = await tx.getAll(...refs);
    const counts = snaps.map((s) => (s.exists ? ((s.data()?.count as number) ?? 0) : 0));

    for (let i = 0; i < active.length; i++) {
      if (counts[i]! >= active[i]!.limit) {
        return { allowed: false, violation: { scope: active[i]!.scope, limit: active[i]!.limit, count: counts[i]! }, bucket };
      }
    }
    for (let i = 0; i < active.length; i++) {
      tx.set(
        refs[i]!,
        { key: active[i]!.key, scope: active[i]!.scope, bucket, count: counts[i]! + 1, updatedAt: nowIso() },
        { merge: true },
      );
    }
    return { allowed: true, bucket };
  });
}
