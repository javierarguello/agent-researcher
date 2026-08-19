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
import type { GenerateOptions, GenerateResult } from '../src/llm/provider.js';
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

describe('a kind is what happened, not what we would rather say', () => {
  it('a loop that was CUT OFF does not tell the buyer its research is complete', async () => {
    // `stopped` — "Research for this step is complete." — was fired for every exit,
    // including the loop we force-stopped after four plan-only turns with ZERO
    // searches, and the one that hit the job's cost ceiling. Two lines, both false,
    // one right after the other (round 7, R7-22 / R7-31). Mutation that reds this:
    // `'stopped'` unconditionally at the end of `gather`.
    const { gather, createEvidence } = await import('../src/engine/gather.js');
    const { resolveModel, __setProviderForTests } = await import('../src/llm/models.js');
    const { MockLlmProvider } = await import('./mocks/llm.js');

    /** A model that only ever re-plans: the shape both real July plan-loops had. */
    class Planner extends MockLlmProvider {
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        if (!opts.tools?.length) return super.generate(opts);
        return { text: '', toolCalls: [{ id: 'p', name: 'update_plan', args: { steps: [{ task: 'plan', status: 'doing' }] } }], usage: { inputTokens: 10, outputTokens: 5 } };
      }
    }
    const p = new Planner();
    for (const n of ['gemini-vertex', 'ollama']) __setProviderForTests(n, p);
    const kinds: string[] = [];
    const res = await gather({
      model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }],
      maxTurns: 2, evidence: createEvidence(), onNote: (_m: string, kind: string) => { kinds.push(kind); },
    } as never);

    expect(res.stop, 'the premise: cut off, not finished').toBe('stalled');
    expect(res.turns).toBe(0);
    expect(kinds).toContain('cut_off');
    expect(kinds, 'nothing here may say the research is complete').not.toContain('stopped');
  });

  it('…and one that finished, or spent its allowance, still does', async () => {
    // The control: `cut_off` must not swallow the honest ending.
    const { gather, createEvidence } = await import('../src/engine/gather.js');
    const { resolveModel } = await import('../src/llm/models.js');
    const { installMockProvider } = await import('./mocks/llm.js');
    installMockProvider();
    const kinds: string[] = [];
    const res = await gather({
      model: resolveModel('gather'), system: 's', messages: [{ role: 'user', text: 'go' }],
      maxTurns: 2, evidence: createEvidence(), onNote: (_m: string, kind: string) => { kinds.push(kind); },
    } as never);
    expect(['done', 'budget']).toContain(res.stop);
    expect(kinds).toContain('stopped');
    expect(kinds).not.toContain('cut_off');
  });

  it('clips a search query by code point, so a hostile one cannot end in half a character', () => {
    // The rest of the batch cuts by code point (`sourceLabel`, the handoff); this one
    // sliced UTF-16 units, and the one string a hostile page chooses is exactly where
    // that leaves a lone surrogate for the buyer's screen to paint as `�` (R7-22).
    const q = `${'x'.repeat(PROGRESS_DETAIL_MAX - 1)}🏦 and more`;
    const out = clientProgress({ phase: 'scout', message: `Searched: ${q}`, kind: 'searched', detail: q, turnsUsed: 1, sourcesFound: 1, updatedAt: 't' });
    expect([...(out.detail ?? '')]).toHaveLength(PROGRESS_DETAIL_MAX);
    expect(out.detail!.endsWith('🏦'), 'the whole character or none of it').toBe(true);
    // Mutation that reds this: `.slice(0, PROGRESS_DETAIL_MAX)`.
    expect(/[\uD800-\uDBFF]$/.test(out.detail ?? ''), 'no lone surrogate').toBe(false);
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
