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
 * Read the core file for why an unrecognised status coerces to `lost`.
 */

export interface SectionStatus {
  key: string;
  status: 'lost' | 'unenriched' | 'reconstructed';
}

const KNOWN = new Set(['lost', 'unenriched', 'reconstructed']);

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
        push(key, typeof status === 'string' && KNOWN.has(status) ? (status as SectionStatus['status']) : 'lost');
      }
    }
  }
  return out;
}
