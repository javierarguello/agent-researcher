/**
 * User credentials store — the identity/login record, ONE per (app, email). This
 * is separate from the stats `app-users` rollup. A user may authenticate with a
 * password and/or Google; both resolve to the SAME record for that email in that
 * app (users are always per-app — the same email in another app is a different
 * user). Google logins mark the email verified automatically.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const credentials = () => firestore().collection(config.auth.credentialsCollection);

export type AuthProvider = 'password' | 'google';

export interface UserCredential {
  appId: string;
  email: string;
  name?: string;
  /** Present only for password users. */
  passwordHash?: string;
  emailVerified: boolean;
  /** Auth methods linked to this record. */
  providers: AuthProvider[];
  createdAt: string;
  updatedAt: string;
}

export class UserExistsError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'UserExistsError';
  }
}

/**
 * Canonicalize an email for identity: lowercase/trim, strip +subaddressing (so
 * `alias+tag@domain` can't spawn duplicate accounts), and collapse Gmail dots
 * (`a.b@gmail.com` == `ab@gmail.com`). Applied everywhere identity is compared
 * (register, login, credential lookup) so the variants all resolve to one account.
 */
export const normalizeEmail = (email: string): string => {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus); // drop +subaddress
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : e;
};
const docId = (appId: string, email: string) => `${appId}__${normalizeEmail(email)}`;
const nowIso = () => new Date().toISOString();

export async function getCredential(appId: string, email: string): Promise<UserCredential | undefined> {
  const snap = await credentials().doc(docId(appId, email)).get();
  return snap.exists ? (snap.data() as UserCredential) : undefined;
}

/** Create a password user. Throws UserExistsError if the email is already taken
 *  in this app (by ANY provider) — registration must not silently overwrite. */
export async function createPasswordUser(input: { appId: string; email: string; name?: string; passwordHash: string }): Promise<UserCredential> {
  const email = normalizeEmail(input.email);
  const ref = credentials().doc(docId(input.appId, email));
  const now = nowIso();
  const rec: UserCredential = {
    appId: input.appId,
    email,
    ...(input.name ? { name: input.name } : {}),
    passwordHash: input.passwordHash,
    emailVerified: false,
    providers: ['password'],
    createdAt: now,
    updatedAt: now,
  };
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) throw new UserExistsError(email);
    tx.set(ref, rec);
  });
  return rec;
}

export async function setEmailVerified(appId: string, email: string): Promise<void> {
  await credentials().doc(docId(appId, email)).set({ emailVerified: true, updatedAt: nowIso() }, { merge: true });
}

/** Update a password user's hash. Only called for records that already have the
 *  'password' provider (registration retry / reset), so `providers` is untouched. */
export async function setPassword(appId: string, email: string, passwordHash: string): Promise<void> {
  await credentials().doc(docId(appId, email)).set({ passwordHash, updatedAt: nowIso() }, { merge: true });
}

/**
 * Resolve a Google login to the app+email record: create it (verified) if absent,
 * or link Google to an existing record and mark it verified (Google proves the
 * address). Returns the resolved credential.
 */
export async function upsertGoogleUser(input: { appId: string; email: string; name?: string }): Promise<UserCredential> {
  const email = normalizeEmail(input.email);
  const ref = credentials().doc(docId(input.appId, email));
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    if (!snap.exists) {
      const rec: UserCredential = {
        appId: input.appId,
        email,
        ...(input.name ? { name: input.name } : {}),
        emailVerified: true,
        providers: ['google'],
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ref, rec);
      return rec;
    }
    const cur = snap.data() as UserCredential;
    const providers = Array.from(new Set([...(cur.providers ?? []), 'google'])) as AuthProvider[];
    const merged: UserCredential = { ...cur, emailVerified: true, providers, name: cur.name ?? input.name, updatedAt: now };
    tx.set(ref, { emailVerified: true, providers, ...(cur.name ? {} : input.name ? { name: input.name } : {}), updatedAt: now }, { merge: true });
    return merged;
  });
}
