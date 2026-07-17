import { config } from '../config';

const TOKEN_KEY = 'admin_jwt';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Fired when a request is rejected 401 — the AuthProvider logs the user out. */
export const UNAUTHORIZED_EVENT = 'admin:unauthorized';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip attaching the bearer token (e.g. the login call). */
  anonymous?: boolean;
}

/** Fetch a report file's text (authenticated) — for the in-app formatted viewer. */
export async function fetchFileText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${config.apiBaseUrl}${path}`, { headers });
  if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError(res.status, `Load failed (${res.status})`);
  return res.text();
}

/** Download a report file through the authenticated proxy (no shareable link). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
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
 * Ensure a report PDF exists (generated once, server-side) and download it. Polls
 * the on-demand endpoint until the render is ready, then streams the file. Admins
 * can download any app's report.
 */
export async function ensureReportPdf(jobId: string, filename: string, onProgress?: (generating: boolean) => void): Promise<void> {
  const id = encodeURIComponent(jobId);
  for (let i = 0; i < 40; i++) {
    const res = await api<{ ready: boolean; name: string }>(`/research/${id}/pdf`);
    if (res.ready) {
      onProgress?.(false);
      await downloadFile(`/research/${id}/files/${res.name}`, filename);
      return;
    }
    onProgress?.(true);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new ApiError(504, 'The PDF is taking longer than expected. Please try again in a moment.');
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.anonymous) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.anonymous) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Build a querystring from defined params only. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`;
}
