/**
 * What one step tells the next.
 *
 * Measured on a comprehensive report, 68% of a job's entire input was upstream
 * context re-sent — the research loop carried every dependency's full sections and
 * re-sent them on every one of its turns, and the exec-summary writer was handed
 * 109k characters of raw report to write a summary of. Trimming that is a cut;
 * a HANDOFF is a decision: each agent writes, in the same call that writes its
 * sections, a short briefing for whoever comes next.
 *
 * The two are additive on purpose. A handoff carries what the agent that did the
 * work thought mattered; the raw sections carry the FIGURES, which prose loses and
 * which the chart and financial agents cannot work without. So a context that no
 * longer fits degrades to "everyone is represented, the long ones are cut" rather
 * than "the last few dependencies disappear".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch, type Checkpoint } from '../src/engine/research-engine.js';
import { buildAgentKickoff, buildProducerSynthPrompt } from '../src/engine/prompt.js';
import { compactModel } from './fixtures/compact-model.js';
import { installMockProvider } from './mocks/llm.js';
import { z } from 'zod';
import type { AgentSpec, ReportSection, ResearchTemplate } from '../src/templates/types.js';
import type { GenerateOptions } from '../src/llm/provider.js';

const params = () => compactModel.paramsSchema.parse({}) as Record<string, unknown>;

/** Every request the run made, so we can look at what each one carried. */
function recording() {
  const seen: GenerateOptions[] = [];
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    seen.push(opts);
    return base(opts);
  };
  return seen;
}

const asText = (opts: GenerateOptions) => opts.messages.map((m) => m.text ?? '').join('\n');

beforeEach(() => {
  /* each test installs its own provider */
});

describe('an agent writes its own handoff', () => {
  it('asks for it in the same call that writes the sections — not an extra one', async () => {
    const seen = recording();
    await runResearch({ template: compactModel, params: params(), jobId: 'ho1', generatedAt: 't' });

    const writes = seen.filter((o) => o.responseSchema);
    for (const w of writes) {
      const props = Object.keys((w.responseSchema as { properties?: object }).properties ?? {});
      expect(props).toContain('_handoff');
    }
    // A separate summarising call per agent would be a second model call and a
    // second place to lose a figure quietly.
    expect(writes).toHaveLength(2); // scout + advisor, one call each
  });

  it('keeps it out of the report — it is a message between steps, not a section', async () => {
    installMockProvider();
    const out = await runResearch({ template: compactModel, params: params(), jobId: 'ho2', generatedAt: 't' });

    // A report that grew a `_handoff` section would break every consumer of the
    // schema contract the manifest publishes.
    expect(out.report).not.toHaveProperty('_handoff');
    expect(Object.keys(out.report).sort()).toEqual(['findings', 'recommendation', 'sources']);

    // And in the CHECKPOINT, which is the un-parsed one. The final schema parse
    // strips unknown keys, so asserting only on the delivered report would pass
    // even if the split never happened — and a resumed dispatch reads this copy,
    // then hands `_handoff` to the next agent as though it were a section.
    expect(out.checkpoint.report).not.toHaveProperty('_handoff');
  });

  it('passes it to the step that depends on it', async () => {
    const seen = recording();
    await runResearch({ template: compactModel, params: params(), jobId: 'ho3', generatedAt: 't' });

    // The advisor depends on the scout, so it should be told what the scout found.
    const advisorWrite = seen.filter((o) => o.responseSchema).at(-1)!;
    expect(asText(advisorWrite)).toMatch(/WHAT THE EARLIER STEPS REPORTED/);
  });

  it('carries them across a re-dispatch', async () => {
    installMockProvider();
    const first = await runResearch({
      template: compactModel, params: params(), jobId: 'ho4', generatedAt: 't', finalize: false,
    });
    expect(Object.keys(first.checkpoint.handoffs ?? {})).toContain('scout');

    // Without this, a resumed job hands its later steps an empty summary of work
    // its predecessors had already done, and they write from nothing.
    const seen = recording();
    const resume: Checkpoint = { ...first.checkpoint, doneAgentIds: ['scout'] };
    await runResearch({ template: compactModel, params: params(), jobId: 'ho4', generatedAt: 't', resume });

    const advisorWrite = seen.filter((o) => o.responseSchema).at(-1)!;
    expect(asText(advisorWrite)).toMatch(/WHAT THE EARLIER STEPS REPORTED/);
  });
});

// --- What each prompt is allowed to carry ------------------------------------

const agent: AgentSpec = { id: 'a', role: 'producer', objective: 'Do it.', produces: ['x'] };
const sections: ReportSection[] = [
  { key: 'x', title: 'X', guidance: 'Write X.', schema: { safeParse: () => ({ success: true }) } as never },
];
const HANDOFFS = { 'deal-scout': 'Found three laundromats; the best is $410k at 2.8x SDE.' };
const BIG = { deep_dives: { overview: 'z'.repeat(50_000) } };

describe('the research loop is told what is covered, not the text of it', () => {
  const kickoff = buildAgentKickoff({ agent, brief: 'b', sections, maxTurns: 4, handoffs: HANDOFFS });

  it('carries the handoffs', () => {
    expect(kickoff).toMatch(/WHAT THE EARLIER STEPS REPORTED/);
    expect(kickoff).toContain('2.8x SDE');
  });

  it('carries no dependency\u2019s CONTENT, however it is routed', async () => {
    // Asserting on the block marker was not enough: routing the sections through
    // the `current` block instead smuggles them back in under a different heading
    // and the marker check stays green. This asserts on the text itself, so any
    // path that puts a dependency's prose in the kickoff fails.
    const SECRET = 'ZZTOPSECRETUPSTREAMPROSE';
    const twoSection: ResearchTemplate<Record<string, unknown>> = {
      id: 'e2e-upstream', name: 'Upstream', description: 'x', version: 1,
      basePrompt: 'Be useful.',
      paramsSchema: z.object({}),
      sections: [
        { key: 'items', title: 'Items', guidance: 'List.', schema: z.array(z.object({ name: z.string() })) },
        { key: 'summary', title: 'Summary', guidance: 'Sum.', schema: z.object({ text: z.string() }) },
        { key: 'notes', title: 'Notes', guidance: 'Note.', schema: z.object({ text: z.string() }) },
      ],
      agents: [
        { id: 'lister', role: 'producer', objective: 'List.', produces: ['items', 'summary'], researchBudget: 1 },
        // Depends on `lister` but owns only `items` — so `summary` is a pure
        // upstream dependency, exactly the thing the loop must not be handed.
        { id: 'reviser', role: 'producer', objective: 'Revise.', produces: ['notes'], enriches: ['items'], dependsOn: ['lister'], researchBudget: 1 },
      ],
      buildBrief: () => 'Find things.',
    };

    const seen: GenerateOptions[] = [];
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      seen.push(opts);
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('summary')) {
        const value = JSON.parse((await base(opts)).text) as Record<string, unknown>;
        value.summary = { text: SECRET };
        return { text: JSON.stringify(value), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    await runResearch({ template: twoSection, params: {}, jobId: 'upstream1', generatedAt: 't' });

    const loopCalls = seen.filter((o) => o.tools?.length);
    expect(loopCalls.length).toBeGreaterThan(1); // the reviser's loop really ran
    for (const call of loopCalls) {
      expect(JSON.stringify(call.messages)).not.toContain(SECRET);
    }
    // …and the write DOES get it, so this is about the loop, not about hiding it.
    const revise = seen.filter((o) => o.responseSchema).at(-1)!;
    expect(JSON.stringify(revise.messages)).toContain(SECRET);
  });

  it('carries no raw sections at all', () => {
    // This prompt is re-sent on EVERY turn of the loop, and the loop decides what
    // to search for — it needs to know what is already covered, not read it. That
    // re-sending was 68% of a comprehensive report's total input.
    expect(kickoff).not.toMatch(/SECTIONS ALREADY PRODUCED/);
    expect(kickoff.length).toBeLessThan(4_000);
  });
});

describe('a long handoff never costs an agent its sections', () => {
  it('cuts the briefing instead of failing the write', async () => {
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      const res = await base(opts);
      if (!opts.responseSchema) return res;
      // A model that writes a 20,000-character briefing. A `.max()` in the SCHEMA
      // would make that a validation failure for the WHOLE write — the agent's
      // sections retried and eventually degraded because it was chatty.
      const value = JSON.parse(res.text) as Record<string, unknown>;
      value._handoff = 'w'.repeat(20_000);
      return { ...res, text: JSON.stringify(value) };
    };

    const out = await runResearch({ template: compactModel, params: params(), jobId: 'ho5', generatedAt: 't' });

    expect(out.trace.status).toBe('completed');
    expect(out.meta.sections ?? []).toEqual([]);
    expect(out.trace.agents.every((a) => a.attempts === 1)).toBe(true);
    // Kept, but bounded — a briefing that ran long is still a useful briefing.
    expect(out.checkpoint.handoffs!.scout!.length).toBeLessThan(2_000);
  });
});

describe('a section an agent will REWRITE is never trimmed', () => {
  // The worst thing trimming can do. An agent that both produces and enriches —
  // valuation-analyst enriches `deep_dives` while producing two sections of its
  // own — is schema-forced to emit the enriched section, and its output REPLACES
  // what is in the report. Hand it a trimmed copy and whatever fell past the cut
  // is deleted from the customer's report, permanently, with the job green.
  const SIX_PROFILES = {
    deep_dives: Array.from({ length: 6 }, (_, i) => ({ business: `Laundromat ${i}`, overview: 'z'.repeat(5_000) })),
  };

  it('arrives whole in the write, however long it is', () => {
    const prompt = buildProducerSynthPrompt({
      agent, brief: 'b', sections, evidence: [], extracted: [], context: {}, current: SIX_PROFILES, lang: 'en',
    });

    for (let i = 0; i < 6; i++) expect(prompt).toContain(`Laundromat ${i}`);
    expect(prompt).toMatch(/you are REWRITING these/i);
    expect(prompt).toMatch(/NEVER drop an item/i);
  });

  it('arrives whole in the research loop too', () => {
    // A refiner's job is to fill the gaps in what is already there — the listing
    // URLs to re-open, the figures still marked n/a. It cannot look for them if it
    // cannot see them, and its search budget is spent by the time the write runs.
    const kickoff = buildAgentKickoff({
      agent, brief: 'b', sections, maxTurns: 4, handoffs: {}, current: SIX_PROFILES,
    });
    for (let i = 0; i < 6; i++) expect(kickoff).toContain(`Laundromat ${i}`);
  });

  it('survives a real run: the agent that rewrites it sees every entry', async () => {
    // Through the ENGINE, because the protection lives in `contextFor` — a
    // prompt-level test passes `current` by hand and so cannot see whether the
    // engine actually routed it there.
    const LONG = 'z'.repeat(6_000);
    const twoStep: ResearchTemplate<Record<string, unknown>> = {
      id: 'e2e-enrich', name: 'Enrich', description: 'x', version: 1,
      basePrompt: 'Be useful.',
      paramsSchema: z.object({}),
      sections: [
        { key: 'items', title: 'Items', guidance: 'List them.', schema: z.array(z.object({ name: z.string(), detail: z.string() })) },
        { key: 'notes', title: 'Notes', guidance: 'Note them.', schema: z.object({ text: z.string() }) },
      ],
      agents: [
        { id: 'lister', role: 'producer', objective: 'List.', produces: ['items'], researchBudget: 1 },
        { id: 'reviser', role: 'producer', objective: 'Revise.', produces: ['notes'], enriches: ['items'], dependsOn: ['lister'], researchBudget: 1 },
      ],
      buildBrief: () => 'Find things.',
    };

    const seen: GenerateOptions[] = [];
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      seen.push(opts);
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('items')) {
        const value = JSON.parse((await base(opts)).text) as Record<string, unknown>;
        // Six long entries — over any per-section share the budget would allow.
        value.items = Array.from({ length: 6 }, (_, i) => ({ name: `Item ${i}`, detail: LONG }));
        return { text: JSON.stringify(value), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };

    await runResearch({ template: twoStep, params: {}, jobId: 'enrich1', generatedAt: 't' });

    // The reviser's write is the last call carrying `items` in its schema.
    const revise = seen.filter((o) => o.responseSchema && JSON.stringify(o.responseSchema).includes('items')).at(-1)!;
    const prompt = revise.messages.map((m) => m.text ?? '').join('\n');
    for (let i = 0; i < 6; i++) expect(prompt).toContain(`Item ${i}`);
    expect(prompt).not.toMatch(/trimmed to fit/i);
    // Exactly once: the engine drops it from the budgeted context because it is
    // already carried whole. Sending it twice loses nothing, it just pays twice.
    expect(prompt.match(/Item 0/g)).toHaveLength(1);
  });

  it('is not also sent as budgeted context, which would send it twice', () => {
    const prompt = buildProducerSynthPrompt({
      agent, brief: 'b', sections, evidence: [], extracted: [],
      context: { other_dep: { note: 'from upstream' } }, current: SIX_PROFILES, lang: 'en',
    });
    expect(prompt).toContain('from upstream');
    expect(prompt.match(/Laundromat 0/g)).toHaveLength(1);
  });
});

describe('the write gets both', () => {
  const prompt = buildProducerSynthPrompt({
    agent, brief: 'b', sections, evidence: [], extracted: [], context: BIG, handoffs: HANDOFFS, lang: 'en',
  });

  it('carries the handoffs and the sections together', () => {
    // Additive, not either/or: the digest says what mattered, the sections carry
    // the figures a digest cannot be trusted to preserve.
    expect(prompt).toMatch(/WHAT THE EARLIER STEPS REPORTED/);
    expect(prompt).toContain('2.8x SDE');
    expect(prompt).toMatch(/SECTIONS ALREADY PRODUCED/);
    expect(prompt).toMatch(/Use these for exact figures/);
  });

  it('still bounds the raw half', () => {
    expect(prompt).toMatch(/trimmed to fit/i);
    expect(prompt.length).toBeLessThan(60_000);
  });
});
