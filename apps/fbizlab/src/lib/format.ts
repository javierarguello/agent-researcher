export const usd = (n: number | null | undefined): string => (n == null ? '—' : `$${n.toFixed(2)}`);
/**
 * The BUYER's locale, not ours.
 *
 * These were `en-US` everywhere, so a Portuguese buyer read `1,234.5` where they
 * write `1.234,5` and `Aug 3, 2026` where they write `3 de ago. de 2026` — the
 * exact bug the PDF's date already had fixed, still live on the screen beside it.
 * The caller passes the language it is rendering in; omitting it keeps English.
 */
export const int = (n: number | null | undefined, lang = 'en'): string => (n == null ? '—' : n.toLocaleString(lang));
export const secs = (ms: number | null | undefined): string => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

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
export function shortDate(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
}
