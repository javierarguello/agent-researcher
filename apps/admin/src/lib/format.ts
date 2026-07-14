/** Small, dependency-free formatters shared across the admin UI. */

export const usd = (n: number | null | undefined): string =>
  n == null ? '—' : `$${n.toFixed(2)}`;

export const secs = (ms: number | null | undefined): string =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

export const int = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US');

/** Short absolute datetime, e.g. "Jul 14, 15:32". */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Compact relative time, e.g. "3m", "2h", "5d". */
export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
