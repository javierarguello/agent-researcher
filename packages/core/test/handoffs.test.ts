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
import type { AgentSpec, ReportSection } from '../src/templates/types.js';
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
    expect(out.meta.degradedSections).toBeUndefined();
    expect(out.trace.agents.every((a) => a.attempts === 1)).toBe(true);
    // Kept, but bounded — a briefing that ran long is still a useful briefing.
    expect(out.checkpoint.handoffs!.scout!.length).toBeLessThan(2_000);
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
