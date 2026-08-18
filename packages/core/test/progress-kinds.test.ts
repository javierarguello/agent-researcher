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
import { clientProgress, PROGRESS_KINDS, PROGRESS_DETAIL_MAX, type ProgressKind } from '../src/jobs/types.js';
import { LIFECYCLE_OTHER, phaseLabel } from '../src/templates/phases.js';
import { installMockProvider } from './mocks/llm.js';
import { compactModel } from './fixtures/compact-model.js';

// Read from the exported const, not copied: a hand-written set here caught the
// engine emitting a kind nobody knew, and was blind to the direction that actually
// happens — core grows a kind and every client that hand-copied the union renders a
// blank line for it (round 7, R7-6).
const KINDS = new Set<ProgressKind>(PROGRESS_KINDS);

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

  it('gives a legacy lifecycle document its kind — and invents one for nothing else', () => {
    // `held` is the phase that OUTLIVES a deploy: the job sits waiting for a human.
    // A held document written before `kind` existed reached the buyer as
    // `{phase:'held', updatedAt}`, so the client had no line to render and the page
    // showed the pulsing dot and "Generating your dossier…" forever, with the one
    // sentence written for that screen — "paused while we review it, nothing more is
    // being spent" — gone (round 7, R7-5).
    expect(clientProgress({ ...base, phase: 'held', message: 'Held at the cost ceiling.' })).toEqual({ phase: 'held', kind: 'held', updatedAt: 't' });
    for (const phase of ['incomplete', 'failed', 'done', 'assembling', 'planning'] as const) {
      const out = clientProgress({ ...base, phase, message: 'x' });
      expect(out.kind, phase).toBe(phase === 'planning' ? undefined : phase);
    }
    // …and NOT for an agent phase: a `searched` has no safe kind without its query,
    // which is exactly what C3 removed. Mutation that reds this: coerce every phase.
    expect(clientProgress({ ...base, phase: 'deal-scout', message: 'Searched: q' })).toEqual({ phase: 'deal-scout', updatedAt: 't' });
    // A kind already on the document always wins.
    expect(clientProgress({ ...base, phase: 'held', message: 'x', kind: 'ceiling' }).kind).toBe('ceiling');
  });
});

describe('held is a lifecycle phase like the others', () => {
  it('has a step in the manifest, in every language — the buyer’s client looks it up by phase', () => {
    // `held` was the one phase with no step, so `stepsById['held']` was undefined and
    // both the job page's headline and the inbox row fell back: "Generating your
    // dossier…" over an "En revisión" badge, and the raw English key `held` in the
    // list (round 7, R7-5 / G3-verify F4).
    expect(LIFECYCLE_OTHER).toContain('held');
    for (const [lang, label] of [['en', 'Under review'], ['es', 'En revisión'], ['fr', 'En révision'], ['pt', 'Em revisão']] as const) {
      expect(phaseLabel('held', lang).label, lang).toBe(label);
      expect(phaseLabel('held', lang).description, lang).toBeTruthy();
    }
  });
});
