/**
 * User credentials store — the identity/login record, ONE per (app, email). This
 * is separate from the stats `app-users` rollup. A user may authenticate with a
 * password and/or Google; both resolve to the SAME record for that email in that
 * app (users are always per-app — the same email in another app is a different
 * user). Google logins mark the email verified automatically.
 */
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import { logEvent } from '../obs/log.js';

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
  /**
   * When this account's credentials last changed — a password set or reset, or the
   * address being verified.
   *
   * It is what makes a stateless session revocable, and what makes an emailed link
   * single-use. Sessions are JWTs with a seven-day life, so before this a password
   * reset did not evict whoever had stolen the account, and a reset link stayed
   * redeemable for its whole TTL however many times it had already been used.
   * Anything issued at or before this moment is refused.
   */
  credentialsChangedAt?: string;
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
  // A trailing dot is a legal FQDN form of the same domain, and would otherwise be
  // a second key for one inbox.
  let domain = e.slice(at + 1).replace(/\.$/, '');
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus); // drop +subaddress
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    // googlemail.com IS gmail.com — same inbox. Collapsing the dots but not the
    // domain left two keys for one address, which doubles any per-address limit.
    domain = 'gmail.com';
  }
  return local ? `${local}@${domain}` : e;
};
/**
 * ONE address, and nothing that can turn into a header or a recipient list.
 *
 * `To:` accepts a comma-separated list, so an address field that reaches Postmark
 * unchecked is a mail-bomb primitive aimed at third parties from our verified
 * sender — and it slips the per-target cap too, because the counter keys on the
 * whole string, so every permutation of the list is a fresh bucket. Newlines and
 * semicolons are refused for the same reason.
 */
export const isSingleEmail = (email: string): boolean =>
  /^[^\s,;<>"@]+@[^\s,;<>"@]+\.[^\s,;<>"@]+$/.test(email) && email.length <= 320;

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
  const now = nowIso();
  // Stamping here is what makes the verification link one-time: the token that
  // opened this door was issued before this moment, so it cannot open it again.
  await credentials()
    .doc(docId(appId, email))
    .set({ emailVerified: true, credentialsChangedAt: now, updatedAt: now }, { merge: true });
}

/**
 * Redeem a single-purpose email link, once.
 *
 * Returns false if this exact link has already been used. Transactional, so two
 * clicks racing each other cannot both win.
 *
 * A link that stays redeemable for its whole TTL is a repeatable account takeover:
 * reset links reach inbox backups, forwarded threads, shared browsers and link
 * scanners, and each redemption handed out a fresh seven-day session.
 */
export async function consumeActionToken(tokenId: string): Promise<boolean> {
  const ref = firestore().collection(config.auth.usedTokensCollection).doc(tokenId);
  return firestore().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    tx.set(ref, { usedAt: nowIso() });
    return true;
  });
}

/**
 * Whether a token issued at `issuedAt` (epoch seconds) still belongs to a live set
 * of credentials.
 *
 * Fails OPEN when there is no record or no stamp: an app-key caller and an account
 * that has never changed anything have nothing to compare against, and refusing
 * them would sign everyone out the moment this shipped.
 */
export function credentialsStillValid(
  cred: Pick<UserCredential, 'credentialsChangedAt'> | undefined,
  issuedAt: number | undefined,
): boolean {
  if (!cred?.credentialsChangedAt || !issuedAt) return true;
  // Inclusive, because a JWT's `iat` is in SECONDS. Resetting a password issues a
  // session in the same second, and so does verifying then signing straight in —
  // with a strict comparison those are indistinguishable from a token minted
  // before the change, and every legitimate flow that ends in a login breaks.
  //
  // What that costs: a stolen session minted inside the same second as the reset
  // survives. The scenario this exists for — an intruder holding a session from
  // before — is unaffected, because that token is seconds or days older.
  return issuedAt >= Math.floor(new Date(cred.credentialsChangedAt).getTime() / 1000);
}

/**
 * Set a password on an existing record, adding the `password` provider.
 *
 * `onlyIfUnverified` is registration's guard. Registration reads the record, then
 * spends ~40ms hashing (scrypt), then writes — and a blind write after that pause
 * is a race: if the address got VERIFIED in between (the owner clicked the link,
 * or signed in with Google), an unverified registrant's password would land on a
 * now-verified account and be immediately usable. The write re-reads under a
 * transaction and refuses.
 *
 * Password RESET has no such guard on purpose: the emailed link is itself proof of
 * ownership, so it may set a password on a verified record — including one that
 * has only ever used Google. That is the recovery path.
 */
export async function setPassword(
  appId: string,
  email: string,
  passwordHash: string,
  opts: { onlyIfUnverified?: boolean } = {},
): Promise<boolean> {
  const ref = credentials().doc(docId(appId, email));
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = (snap.exists ? snap.data() : {}) as Partial<UserCredential>;
    if (opts.onlyIfUnverified && cur.emailVerified === true) return false;
    const providers = Array.from(new Set([...(cur.providers ?? []), 'password'])) as AuthProvider[];
    const now = nowIso();
    // A new password ends every session that knew the old one. Recovering a
    // compromised account has to actually evict the intruder, and it did not: the
    // session they held stayed valid for the rest of its seven days.
    tx.set(ref, { passwordHash, providers, credentialsChangedAt: now, updatedAt: now }, { merge: true });
    return true;
  });
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
    // PRE-HIJACK. Registration creates a credential for an address nobody has
    // proven yet — anyone can plant one on someone else's email. Marking the
    // record verified here would promote that planted password: the login gate
    // only asks for `passwordHash` + `emailVerified`, so whoever registered first
    // gets a session as the person who just signed in with Google. Google proves
    // the ADDRESS, never the password attached to it, so an unverified credential
    // is discarded rather than inherited. The owner's way back to a password is the
    // reset link, which `/auth/request-password-reset` sends for any credential —
    // it used to require an existing `passwordHash`, i.e. the exact field this line
    // deletes, so the recovery this comment promised did not exist.
    const stale = cur.emailVerified !== true && !!cur.passwordHash;
    const kept = stale ? (cur.providers ?? []).filter((p) => p !== 'password') : (cur.providers ?? []);
    const providers = Array.from(new Set([...kept, 'google'])) as AuthProvider[];
    const merged: UserCredential = {
      ...cur,
      ...(stale ? { passwordHash: undefined } : {}),
      emailVerified: true,
      providers,
      name: cur.name ?? input.name,
      updatedAt: now,
    };
    tx.set(
      ref,
      {
        emailVerified: true,
        providers,
        ...(stale ? { passwordHash: FieldValue.delete() } : {}),
        ...(cur.name ? {} : input.name ? { name: input.name } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
    if (stale) {
      logEvent({ jobId: '-', appId: input.appId, userId: email }, 'WARNING', 'auth.unverified_password_discarded', {
        reason: 'google sign-in superseded a password nobody had verified',
      });
    }
    return merged;
  });
}
