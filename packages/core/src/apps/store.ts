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
  emailFrom?: string;
  webUrl?: string;
}

/**
 * The shape an app id may have. Enforced HERE, not only in the admin route's JSON
 * schema, because there are two creation surfaces and the CLI (`npm run apps`) is
 * the other one — so the rule was enforced at one of them and the tool an operator
 * reaches for first could still mint an id the product cannot use.
 *
 * Underscores are the reason the rule exists: balances, credentials and stats are
 * keyed `<appId>__<userId>`, so an appId containing `_` makes two different
 * identities share one key. Uppercase, dots and anything longer than 64 characters
 * are refused for the other half — `isValidAppId` (apps/api/src/stripe.ts) guards
 * the Stripe search DSL, and an id outside it is silently unbillable: no catalog,
 * no checkout, and nothing in the logs to explain it months later.
 *
 * A generated `randomUUID()` satisfies this, which is what makes it safe to apply
 * to the default path too.
 */
const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function createApp(input: CreateAppInput): Promise<AppRecord> {
  if (input.appId != null && !APP_ID_RE.test(input.appId)) {
    throw new Error(
      `Invalid appId "${input.appId}": lowercase letters, digits and "-" only, starting with a letter or digit, ` +
        'at most 64 characters. Underscores are not allowed — balances and credentials are keyed `<appId>__<userId>`.',
    );
  }
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
    ...(input.emailFrom ? { emailFrom: input.emailFrom } : {}),
    ...(input.webUrl ? { webUrl: input.webUrl } : {}),
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
  emailFrom?: string;
  webUrl?: string;
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
  if (patch.emailFrom != null) data.emailFrom = patch.emailFrom;
  if (patch.webUrl != null) data.webUrl = patch.webUrl;
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
 *
 * Check and increment are ONE operation, and that matters twice over. It keeps
 * the count honest, and — because contended Firestore transactions on the same
 * document serialize — it is also the only thing that stops a simultaneous burst
 * from all reading "0 used" and all being admitted. Callers rely on that second
 * property, so do not split this into a read and a later write.
 */
export async function checkRateLimits(entries: RateLimitEntry[]): Promise<RateLimitResult> {
  const bucket = nowIso().slice(0, 13); // "yyyy-mm-ddTHH"
  const active = activeEntries(entries);
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

/**
 * Read-only check: is any dimension already at its cap? Writes nothing.
 *
 * A cheap early rejection, so a caller who is already over does not pay for the
 * expensive work in between (a moderation model call, Firestore reads) on the way
 * to a 429 they were always going to get.
 *
 * It is NOT an enforcement point. It contends with nothing, so a simultaneous
 * burst all reads the same count and all passes. Always follow it with
 * `checkRateLimits` before anything is actually spent.
 */
export async function peekRateLimits(entries: RateLimitEntry[]): Promise<RateLimitResult> {
  const bucket = nowIso().slice(0, 13);
  const active = activeEntries(entries);
  if (active.length === 0) return { allowed: true, bucket };

  const refs = active.map((e) => rateLimits().doc(`${e.key}:${bucket}`));
  const snaps = await firestore().getAll(...refs);
  for (let i = 0; i < active.length; i++) {
    const count = snaps[i]!.exists ? ((snaps[i]!.data()?.count as number) ?? 0) : 0;
    if (count >= active[i]!.limit) {
      return { allowed: false, violation: { scope: active[i]!.scope, limit: active[i]!.limit, count }, bucket };
    }
  }
  return { allowed: true, bucket };
}

/** Entries with a meaningful cap (null/<=0 means "no limit"). */
function activeEntries(entries: RateLimitEntry[]) {
  return entries.filter((e) => typeof e.limit === 'number' && e.limit > 0) as Array<
    Required<Pick<RateLimitEntry, 'key' | 'scope'>> & { limit: number }
  >;
}
