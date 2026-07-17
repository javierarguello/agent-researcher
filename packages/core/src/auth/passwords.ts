/**
 * Password hashing with Node's built-in scrypt (no external dependency). Stored
 * form: "scrypt$<N>$<saltHex>$<hashHex>". Verification is constant-time.
 */
import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: BinaryLike, salt: BinaryLike, keylen: number, options?: { N?: number }) => Promise<Buffer>;
const N = 16384; // cost
const KEYLEN = 32;

export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 200;

/** Basic strength/format check. Returns an error message, or null if acceptable. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < MIN_PASSWORD_LEN) return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  if (pw.length > MAX_PASSWORD_LEN) return 'Password is too long.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEYLEN, { N })) as Buffer;
  return `scrypt$${N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  if (!Number.isInteger(n) || salt.length === 0 || expected.length === 0) return false;
  const derived = (await scryptAsync(password, salt, expected.length, { N: n })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
