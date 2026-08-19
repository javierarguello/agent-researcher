/**
 * The browser copy of `packages/core/src/engine/section-status.ts`.
 *
 * This app does not depend on `@agent-researcher/core` — it is a static bundle
 * and that separation is deliberate. So this is a second implementation of a
 * rule where being wrong means printing a recommendation the engine never made,
 * at a price of zero, to the buyer.
 *
 * A duplicated rule that drifts is exactly how the currency formatter ended up
 * hoisted in this file and rebuilt per value in the PDF. So the two copies are
 * pinned by the SAME fixture table, `LEGACY_SHAPES`, asserted in this app's
 * suite and in core's. Change one copy and the other suite goes red.
 *
 * Read the core file for why an unrecognised status coerces to `lost` — and for
 * what that costs HERE, which is where it costs anything: this bundle is cached
 * by the browser, so this reader can be older than the writer, and an unknown
 * status suppresses a body the PDF of the same report still shows (R8-17). The
 * set of statuses the engine writes is pinned against `KNOWN_STATUSES` below
 * from `test/section-copy-parity.test.tsx`, so a new one is red here before it
 * is live.
 */

export interface SectionStatus {
  key: string;
  status: 'lost' | 'unenriched' | 'reconstructed';
}

export const KNOWN_STATUSES = new Set(['lost', 'unenriched', 'reconstructed']);

export function normalizeSectionStatuses(...raws: unknown[]): SectionStatus[] {
  const out: SectionStatus[] = [];
  const seen = new Set<string>();
  const push = (key: string, status: SectionStatus['status']): void => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, status });
  };
  for (const raw of raws) {
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (typeof entry === 'string') {
        push(entry, 'lost');
      } else if (entry && typeof entry === 'object') {
        const { key, status } = entry as { key?: unknown; status?: unknown };
        if (typeof key !== 'string') continue;
        push(key, typeof status === 'string' && KNOWN_STATUSES.has(status) ? (status as SectionStatus['status']) : 'lost');
      }
    }
  }
  return out;
}
