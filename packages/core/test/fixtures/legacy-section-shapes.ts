/**
 * Every shape `meta.sections` / `checkpoint.degraded` can arrive in, and what a
 * reader must turn it into.
 *
 * Shared on purpose. `normalizeSectionStatuses` exists twice — once in core, once
 * in `apps/fbizlab/src/lib/section-status.ts`, because the buyer app is a static
 * bundle with no dependency on core. Both suites assert THIS table, so the two
 * copies cannot drift without one of them going red.
 *
 * Imported across the workspace boundary by
 * `apps/fbizlab/test/section-status-parity.test.tsx` — moving this file breaks
 * that import loudly, which is the intent.
 */

export interface LegacyShapeCase {
  /** What the failure looks like to a buyer if the coercion gets this wrong. */
  why: string;
  /** Positional args, exactly as the renderers pass them. */
  args: unknown[];
  expected: Array<{ key: string; status: 'lost' | 'unenriched' | 'reconstructed' }>;
}

export const LEGACY_SHAPES: LegacyShapeCase[] = [
  {
    why: 'the current shape passes through untouched',
    args: [[{ key: 'verdict', status: 'lost' }, { key: 'market', status: 'unenriched' }], undefined],
    expected: [{ key: 'verdict', status: 'lost' }, { key: 'market', status: 'unenriched' }],
  },
  {
    why: 'a report.json written before the rename carries meta.degradedSections',
    args: [undefined, ['verdict']],
    expected: [{ key: 'verdict', status: 'lost' }],
  },
  {
    why: 'a checkpoint held before the rename resumes with degraded: string[]',
    args: [['verdict', 'financial_analysis']],
    expected: [{ key: 'verdict', status: 'lost' }, { key: 'financial_analysis', status: 'lost' }],
  },
  {
    why: 'an entry with no status at all predates the field and meant lost',
    args: [[{ key: 'verdict' }]],
    expected: [{ key: 'verdict', status: 'lost' }],
  },
  {
    why: 'reconstructed passes through — a body an enricher wrote must not be suppressed',
    args: [[{ key: 'charts', status: 'reconstructed' }]],
    expected: [{ key: 'charts', status: 'reconstructed' }],
  },
  {
    why: 'a status this build does not know coerces to lost, never to a rendered body',
    args: [[{ key: 'verdict', status: 'partially_enriched' }]],
    expected: [{ key: 'verdict', status: 'lost' }],
  },
  {
    why: 'both keys present: the current shape wins, the legacy one does not duplicate it',
    args: [[{ key: 'verdict', status: 'unenriched' }], ['verdict', 'market']],
    expected: [{ key: 'verdict', status: 'unenriched' }, { key: 'market', status: 'lost' }],
  },
  {
    why: 'nothing to report renders everything, with no notice',
    args: [undefined, undefined],
    expected: [],
  },
  {
    why: 'garbage in the store must not crash the render or invent a key',
    args: [[null, 42, {}, { key: 7 }, { status: 'lost' }, '', { key: 'verdict', status: 'lost' }], 'not-an-array'],
    expected: [{ key: 'verdict', status: 'lost' }],
  },
];
