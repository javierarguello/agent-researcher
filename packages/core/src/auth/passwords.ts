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

// The most common / obvious passwords people actually try (compared lowercased).
// Not exhaustive — a cheap guard on top of the letter+digit rule.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'passw0rd1',
  '12345678', '123456789', '1234567890', '12345678910', 'qwerty123', 'qwertyuiop',
  'qwerty12345', '1q2w3e4r', '1qaz2wsx', 'abc12345', 'abcd1234', 'admin123', 'root1234',
  'welcome1', 'welcome123', 'letmein123', 'iloveyou1', 'sunshine1', 'football1',
  'baseball1', 'dragon123', 'monkey123', 'princess1', 'superman1', 'trustno1',
  'changeme1', 'test1234', 'user1234',
]);

/** Strength/format check. Returns an error message, or null if acceptable. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < MIN_PASSWORD_LEN) return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  if (pw.length > MAX_PASSWORD_LEN) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include at least one letter and one number.';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'This password is too common. Please choose a stronger one.';
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
