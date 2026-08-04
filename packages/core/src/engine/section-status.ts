/**
 * What went wrong with a section, and the coercion that reads it back.
 *
 * The renderers use this to decide whether to SUPPRESS a body. That makes the
 * shape safety-critical in one direction only: a section that is really `lost`
 * holds a placeholder that satisfies the report schema — a required enum takes
 * its first value, a required number takes 0 — so failing to recognise it prints
 * a recommendation the engine never made, at a price of zero, into the artifact
 * the buyer keeps and forwards.
 *
 * This shape replaced `degradedSections: string[]`, and the rename had no reader
 * for the old one. Both live stores keep pre-rename data:
 *
 *   - `report.json` in Cloud Storage, which the worker re-renders on demand and
 *     the web viewer reads directly. Every report written before the rename.
 *   - `checkpoint.json`, which a HELD job keeps on purpose so an approval can
 *     resume it — a job parked before the rename and approved after resumes with
 *     `degraded: string[]` and finalizes into `meta.sections`.
 *
 * In both cases `x.status === 'lost'` matched nothing, every section rendered,
 * and `sectionsNotice` returned `''`, so the buyer was not told either. That is
 * why the coercion lives here, in one place, and is called at every read.
 */

/** One section that did not come out whole, and in what way. */
export interface SectionStatus {
  key: string;
  status: 'lost' | 'unenriched';
}

const KNOWN = new Set(['lost', 'unenriched']);

/**
 * Read section statuses out of anything a store may hold, in priority order —
 * first mention of a key wins, so pass the current shape before the legacy one.
 *
 * Accepts `SectionStatus[]`, the legacy `string[]`, and mixtures, and drops
 * entries with no usable key rather than inventing one.
 *
 * **An unrecognised `status` becomes `lost`**, deliberately. Every shape that
 * can actually reach this from a store predates `status` and meant exactly
 * "lost"; a genuinely new state would ship with the renderers that understand
 * it. Guessing `unenriched` on old data is the failure this function exists to
 * stop — it renders the fabricated body.
 */
export function normalizeSectionStatuses(...raws: unknown[]): SectionStatus[] {
  const out: SectionStatus[] = [];
  const seen = new Set<string>();
  const push = (key: string, status: 'lost' | 'unenriched'): void => {
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
        push(key, typeof status === 'string' && KNOWN.has(status) ? (status as 'lost' | 'unenriched') : 'lost');
      }
    }
  }
  return out;
}
