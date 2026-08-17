/**
 * Every progress event the engine emits carries a KIND from the closed
 * vocabulary, and a search carries its query as `detail`. The kind is what a
 * client localizes; `message` stays the engine's English sentence for the trace.
 * A `searched` line used to be the only way a buyer saw the research happening
 * — and the only way a web page could put a sentence on their screen.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));
import { runResearch, type ResearchProgress } from '../src/engine/research-engine.js';
import { clientProgress, PROGRESS_DETAIL_MAX, type ProgressKind } from '../src/jobs/types.js';
import { installMockProvider } from './mocks/llm.js';
import { compactModel } from './fixtures/compact-model.js';

const KINDS = new Set<ProgressKind>(['starting', 'wave', 'researching', 'reusing', 'plan', 'searched', 'search_failed', 'fetched', 'cached', 'stopped', 'ceiling', 'writing', 'composing', 'retry', 'failed', 'assembling', 'done', 'held', 'incomplete']);

describe('progress events carry a kind', () => {
  it('every event of a run has a kind from the closed set; searches carry the query; nothing else carries a detail', async () => {
    installMockProvider();
    const events: ResearchProgress[] = [];
    await runResearch({
      template: compactModel,
      params: compactModel.paramsSchema.parse({}) as Record<string, unknown>,
      jobId: 'pk1',
      generatedAt: 't',
      onProgress: (p) => {
        events.push(p);
      },
    });
    expect(events.length).toBeGreaterThan(5);
    // Mutation that reds this: emit any event without a kind (the type stops most;
    // this catches a `kind: undefined as never`).
    for (const e of events) expect(KINDS.has(e.kind), `${e.phase}: ${e.message}`).toBe(true);
    const searched = events.filter((e) => e.kind === 'searched');
    expect(searched.length).toBeGreaterThan(0);
    // The stock mock searches "test query"; the detail IS the query, and the
    // message carries it too (for the trace).
    for (const e of searched) {
      expect(e.detail).toBe('test query');
      expect(e.message).toBe('Searched: test query');
    }
    for (const e of events.filter((e) => e.kind !== 'searched')) expect(e.detail).toBeUndefined();
    // The lifecycle kinds are there, in order.
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('starting');
    expect(kinds).toContain('wave');
    expect(kinds).toContain('researching');
    expect(kinds).toContain('writing');
    expect(kinds).toContain('composing');
    expect(kinds).toContain('assembling');
    expect(kinds.at(-1)).toBe('done');
  });
});

describe('clientProgress — the buyer-facing shape', () => {
  const base = { phase: 'scout', turnsUsed: 1, sourcesFound: 2, updatedAt: 't' };
  it('drops the message, keeps phase/kind/updatedAt, and clips a searched detail', () => {
    expect(clientProgress({ ...base, message: 'Writing (a, b).', kind: 'writing' })).toEqual({ phase: 'scout', kind: 'writing', updatedAt: 't' });
    const long = 'x'.repeat(PROGRESS_DETAIL_MAX + 50);
    expect(clientProgress({ ...base, message: `Searched: ${long}`, kind: 'searched', detail: long })).toEqual({ phase: 'scout', kind: 'searched', detail: 'x'.repeat(PROGRESS_DETAIL_MAX), updatedAt: 't' });
    // Mutation that reds this: send `detail` for every kind.
    expect(clientProgress({ ...base, message: 'Fetched 1 page(s).', kind: 'fetched', detail: 'https://x' })).toEqual({ phase: 'scout', kind: 'fetched', updatedAt: 't' });
    // A document from before the field: phase and updatedAt only.
    expect(clientProgress({ ...base, message: 'Searched: q' })).toEqual({ phase: 'scout', updatedAt: 't' });
  });
});
