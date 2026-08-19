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

/**
 * One section that did not come out whole, and in what way.
 *
 *   - `lost` — nothing wrote it; the body is a placeholder and both renderers
 *     suppress it.
 *   - `unenriched` — a producer wrote it and the pass that deepens it never
 *     finished. Real content, less depth than the tier bought.
 *   - `reconstructed` — the producer never delivered it and an ENRICHER wrote it
 *     anyway (finalize-in-place runs the deferred steps best-effort). The body
 *     stays — an enricher with other finished dependencies writes from real
 *     sections — but nothing researched this section directly, so it must never
 *     borrow `unenriched`'s "researched and written… sourced as usual" copy.
 */
export interface SectionStatus {
  key: string;
  status: 'lost' | 'unenriched' | 'reconstructed';
}

export const KNOWN_STATUSES = new Set(['lost', 'unenriched', 'reconstructed']);

/**
 * Read section statuses out of anything a store may hold, in priority order —
 * first mention of a key wins, so pass the current shape before the legacy one.
 *
 * Accepts `SectionStatus[]`, the legacy `string[]`, and mixtures, and drops
 * entries with no usable key rather than inventing one.
 *
 * **An unrecognised `status` becomes `lost`**, deliberately — and the choice is
 * a trade, not a free safety. It is right in the direction this function was
 * written for: every shape that can actually reach it from a STORE predates
 * `status` and meant exactly "lost", and guessing `unenriched` there renders the
 * fabricated body — a recommendation the engine never made, at a price of zero,
 * in the artifact the buyer keeps.
 *
 * It is wrong in the other direction, and that direction is real. The buyer app
 * is a static bundle a browser CACHES, so a reader can be older than the writer:
 * when `reconstructed` shipped, a browser one bundle behind coerced it to `lost`,
 * SUPPRESSED a section that had real content, and printed "everything else was
 * researched as usual" — while the server-rendered PDF of the same report showed
 * the section. Two artifacts of one purchase disagreeing (round 8, R8-17).
 *
 * Keeping the body for an unknown status would trade that for the worse failure
 * above, so the coercion stays. What is pinned instead is the writer: the set of
 * statuses the engine emits is asserted against BOTH readers' `KNOWN_STATUSES`
 * (`test/fixtures/section-lines.ts`), so a fourth status is red in every renderer
 * that does not know it yet, and shipping one is a decision about deploy order
 * rather than an accident a cached bundle discovers for us.
 */
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
