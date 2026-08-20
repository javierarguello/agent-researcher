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

/**
 * Identifies the report currently being drafted, so the API can tell "the same
 * request, edited" from "a different request". Stable across edits and across a
 * trip to buy credits; cleared once the report is generated.
 */
const DRAFT_ID_KEY = 'fbizlab_newreport_draft_id';

export function draftId(): string {
  let id = localStorage.getItem(DRAFT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DRAFT_ID_KEY, id);
  }
  return id;
}

/** A generated report ends the draft: the next one starts its own allowance. */
export function clearDraftId(): void {
  localStorage.removeItem(DRAFT_ID_KEY);
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
  /** Machine-readable error code from the API body (e.g. 'preflight_rate_limited'). */
  get code(): string | undefined { return this.body?.code as string | undefined; }
  /** Seconds to wait before retrying, when the API provides it (429s). */
  get retryAfterSeconds(): number | undefined { return this.body?.retryAfterSeconds as number | undefined; }
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
  // The language the SWITCHER is on, not the browser's. The API answers a person in
  // `body.lang`, then `?lang=`, then this header — and until now this header was
  // whatever the laptop was configured in, so a Spanish speaker on a US machine read
  // the rate-limit and blocked-account messages in English inside a Spanish page.
  // One line here, and every route that answers a person gets it: the four 429s, the
  // blocked-account 403, and the two emails that used to need `lang` in the body.
  const headers: Record<string, string> = { 'content-type': 'application/json', ...langHeader() };
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
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, data as Record<string, unknown>);
  return data as T;
}

/** Fetch a report file through the authenticated proxy (with the session token) and
 *  trigger a browser download — there is no shareable link. */
export async function downloadFile(path: string, filename: string, override?: string): Promise<void> {
  const headers: Record<string, string> = { ...langHeader() };
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

/** The Turnstile token, under the field name Cloudflare's own widget posts.
 *  Omitted entirely when there is no token, so unprotected flows are unchanged. */
export const captchaBody = (token?: string): Record<string, string> =>
  token ? { 'cf-turnstile-response': token } : {};

/**
 * The language the person actually chose, for the two emails that go out before
 * they have an account to store a preference on.
 *
 * Read from the same key `i18n.tsx` writes, so it follows the switcher and the URL
 * language. The server falls back to `Accept-Language`, which is the BROWSER's
 * setting — `en` for a Spanish speaker on a US-configured laptop, i.e. exactly the
 * person this is for.
 */
const chosenLang = (): string | undefined => localStorage.getItem('fbizlab_lang') ?? undefined;

/**
 * `Accept-Language` for every call, set to the language the switcher is on.
 *
 * `Accept-Language` is not a forbidden header name, so `fetch` may set it — and
 * setting it is what makes the server's fallback the CHOSEN language rather than
 * the laptop's. Omitted entirely when nothing has been chosen, so the browser's own
 * value is sent, which is the right default for a first visit.
 */
const langHeader = (): Record<string, string> => {
  const l = chosenLang();
  return l ? { 'accept-language': l } : {};
};

// --- Password auth (register / verify email / reset) -----------------------
/** Register a password account. 202 = verification email sent. Throws ApiError
 *  (409 email_taken) if the email already belongs to a verified account. */
export function register(email: string, password: string, name?: string, captcha?: string): Promise<{ status: string; email: string }> {
  return api('/auth/register', { method: 'POST', anonymous: true, body: { appId: config.appId, email, password, name, lang: chosenLang(), ...captchaBody(captcha) } });
}

/** Verify an email from the emailed link. Does NOT sign you in: the password on
 *  that account was not necessarily chosen by whoever opened the mail. */
export function verifyEmail(token: string, password: string): Promise<{ status: string; email: string }> {
  return api('/auth/verify-email', { method: 'POST', anonymous: true, body: { token, password } });
}

/** Always resolves 202 (never reveals whether the email exists). */
export function requestPasswordReset(email: string, captcha?: string): Promise<{ status: string }> {
  return api('/auth/request-password-reset', { method: 'POST', anonymous: true, body: { appId: config.appId, email, lang: chosenLang(), ...captchaBody(captcha) } });
}

/** Set a new password from the emailed reset link → returns a login session. */
export function resetPassword(token: string, password: string): Promise<SessionResponse> {
  return api('/auth/reset-password', { method: 'POST', anonymous: true, body: { token, password } });
}

/** Send a contact / API-access request. If the user is logged in, the stored
 *  session token is included so the server can note their account. */
export function contactRequest(payload: { subject?: string; name: string; email: string; message: string }, captcha?: string): Promise<{ status: string }> {
  return api('/contact', { method: 'POST', body: { appId: config.appId, ...payload, ...captchaBody(captcha) } });
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}
