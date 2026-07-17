import { config } from '../config';
import type { SessionResponse } from './types';

const TOKEN_KEY = 'fbizlab_jwt';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const UNAUTHORIZED_EVENT = 'web:unauthorized';

/** A plan the visitor picked on the landing before logging in; consumed post-login. */
export const PENDING_PLAN_KEY = 'fbizlab_pending_plan';

/** A half-filled New-report form, saved before sending the user to buy credits so
 *  they return to exactly the same inputs after paying (or cancelling). */
export const DRAFT_KEY = 'fbizlab_newreport_draft';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  anonymous?: boolean;
  /** Use this bearer token instead of the stored session (e.g. an admin read-only
   *  report link). A 401 here does not log the real user out. */
  token?: string;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) {
    headers.authorization = `Bearer ${opts.token}`;
  } else if (!opts.anonymous) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !opts.anonymous && !opts.token) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Fetch a report file through the authenticated proxy (with the session token) and
 *  trigger a browser download — there is no shareable link. */
export async function downloadFile(path: string, filename: string, override?: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = override ?? getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${config.apiBaseUrl}${path}`, { headers });
  if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Ensure a report PDF exists (generated once, server-side) and download it. The
 * first call enqueues the render and returns `{ ready:false }`; we poll until it's
 * ready, then stream it through the authenticated file proxy. `token` routes an
 * admin read-only link; `onProgress(true)` lets the caller show "Preparing…".
 */
export async function ensureReportPdf(
  jobId: string,
  filename: string,
  opts: { token?: string; onProgress?: (generating: boolean) => void } = {},
): Promise<void> {
  const id = encodeURIComponent(jobId);
  for (let i = 0; i < 40; i++) {
    const res = await api<{ ready: boolean; name: string }>(`/research/${id}/pdf`, { token: opts.token });
    if (res.ready) {
      opts.onProgress?.(false);
      await downloadFile(`/research/${id}/files/${res.name}`, filename, opts.token);
      return;
    }
    opts.onProgress?.(true);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new ApiError(504, 'The PDF is taking longer than expected. Please try again in a moment.');
}

// --- Password auth (register / verify email / reset) -----------------------
/** Register a password account. 202 = verification email sent. Throws ApiError
 *  (409 email_taken) if the email already belongs to a verified account. */
export function register(email: string, password: string, name?: string): Promise<{ status: string; email: string }> {
  return api('/auth/register', { method: 'POST', anonymous: true, body: { appId: config.appId, email, password, name } });
}

/** Verify an email from the emailed link → returns a login session. */
export function verifyEmail(token: string): Promise<SessionResponse> {
  return api('/auth/verify-email', { method: 'POST', anonymous: true, body: { token } });
}

/** Always resolves 202 (never reveals whether the email exists). */
export function requestPasswordReset(email: string): Promise<{ status: string }> {
  return api('/auth/request-password-reset', { method: 'POST', anonymous: true, body: { appId: config.appId, email } });
}

/** Set a new password from the emailed reset link → returns a login session. */
export function resetPassword(token: string, password: string): Promise<SessionResponse> {
  return api('/auth/reset-password', { method: 'POST', anonymous: true, body: { token, password } });
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}
