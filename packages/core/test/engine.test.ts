import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock the external web-search/extract tools (no network).
vi.mock('../src/tools/web-search.js', () => ({
  // The engine asks the search module what a call costs, so a mock of it must
  // answer too. Free here: these tests assert behaviour, not spend.
  searchCostPerCall: (_operation: 'search' | 'extract') => 0,
  canExtractPages: () => true,
  searchWeb: async (query: string) => [
    { title: `Result for ${query}`, url: `https://example.com/${Math.random().toString(36).slice(2)}`, snippet: 'snippet' },
  ],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'Full page content.' })),
}));

import { runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { reportSchemaOf } from '../src/templates/types.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';
import type { ResearchTemplate } from '../src/templates/types.js';

const template = getTemplate('florida-business-for-sale')!;

function run(mode: 'essential' | 'comprehensive') {
  // Mirror the API: params are validated (defaults applied) before runResearch.
  const params = template.paramsSchema.parse({
    industry: 'laundromats',
    location: 'Miami-Dade County, FL',
    language: 'es',
    mode,
  }) as Record<string, unknown>;
  return runResearch({ template, params, jobId: `job-${mode}`, generatedAt: '2026-07-10T00:00:00.000Z' });
}

/**
 * Make every agent write one key no section declares.
 *
 * The point is what the buyer receives: an agent that returns a stray field —
 * a hallucinated column, a leftover scratch key, a future schema it half
 * remembers — must not have it show up in the report. Only the parse removes it,
 * so this is the assertion that actually distinguishes "validated" from "passed
 * through".
 */
function smuggleAnExtraKey(mock: MockLlmProvider): void {
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    const res = await base(opts);
    if (!opts.responseSchema) return res;
    const value = JSON.parse(res.text) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value)) {
      // Inside the section body, not beside it: an unknown key at the top level
      // of an agent's write is a different rule (the subset schema) and would
      // degrade the section instead of exercising the strip.
      if (k !== '_handoff' && v && typeof v === 'object' && !Array.isArray(v)) {
        (v as Record<string, unknown>).zzSmuggled = 'never asked for';
      }
    }
    return { ...res, text: JSON.stringify(value) };
  };
}

describe('engine — runResearch with mocked LLM + search', () => {
  let mock: MockLlmProvider;
  beforeEach(() => {
    mock = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', mock);
  });

  it('produces a schema-valid essential report (12 sections) with lorem-ipsum prose', async () => {
    smuggleAnExtraKey(mock);
    const out = await run('essential');
    expect(out.trace.status).toBe('completed');
    expect(out.meta.mode).toBe('essential');
    expect(out.meta.sections).toBeUndefined();

    // Essential drops the heavy analytical sections.
    expect(Object.keys(out.report)).toHaveLength(12);
    expect(out.report).not.toHaveProperty('financial_analysis');
    expect(out.report).toHaveProperty('sources');

    // The delivered report is the PARSED one, not what the agents returned.
    //
    // Re-parsing `out.report` proves nothing on its own: the engine already parsed
    // it and returns `parsed.data`, so that assertion was true of its own input.
    // What only validation can produce is the STRIPPING — the mock adds a key no
    // section declares, and it must not survive into what the buyer receives.
    //
    // Measured: for a section an AGENT writes, two parses hold this — the write in
    // `synthesizeStructured` and the whole-report parse at the end — and each strips
    // on its own. Removing either alone leaves this green; removing both turns it
    // red. So this assertion pins the property, not either mechanism.
    //
    // It does NOT cover a DERIVED section, which has only one guard. See the case
    // below: `derive` output is assigned straight into the report and never sees the
    // agent write parse, so the whole-report parse is the only thing between it and
    // the buyer. `sources` — one of the 12 sections this very assertion runs over —
    // is derived, which is what makes the distinction worth stating rather than
    // leaving for the next reader to discover.
    const exclude = new Set(template.modes!.essential!.exclude);
    const eff = { ...template, sections: template.sections.filter((s) => !exclude.has(s.key)) };
    expect(reportSchemaOf(eff).safeParse(out.report).success).toBe(true);
    expect(JSON.stringify(out.report)).not.toContain('zzSmuggled');

    // Prose came from the mock (lorem ipsum), and cost was accounted.
    expect(String((out.report.market_overview as { overview?: string }).overview)).toMatch(/Lorem ipsum/);
    expect(out.meta.cost.usd).toBeGreaterThan(0);
    expect(mock.calls).toBeGreaterThan(0);
  });

  it('produces the full comprehensive report (18 sections)', async () => {
    const out = await run('comprehensive');
    expect(out.trace.status).toBe('completed');
    expect(out.meta.mode).toBe('comprehensive');
    expect(Object.keys(out.report)).toHaveLength(18);
    expect(out.report).toHaveProperty('financial_analysis');
    expect(out.report).toHaveProperty('growth_playbook');
  });

  it('isolates a failing agent into a degraded section', async () => {
    // Make the synthesis call throw for one section by returning invalid JSON twice.
    const original = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('market_overview')) {
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return original(opts);
    };
    const out = await run('essential');
    expect((out.meta.sections ?? []).map((x) => x.key)).toContain('market_overview');
    expect(out.trace.status).toBe('completed'); // other sections still complete
  });
});

/**
 * A derived section that returns a key its schema does not declare.
 *
 * `derive` runs after every agent and its result is assigned straight into the
 * report — it never passes through `synthesizeStructured`, so the whole-report
 * parse is the ONLY thing standing between it and the buyer. The flagship
 * template's `sources` section is derived, which is why this is worth its own
 * case rather than a note.
 */
const derivedTemplate: ResearchTemplate<Record<string, unknown>> = {
  id: 'derived-strip', name: 'Derived', description: 'x', version: 1,
  basePrompt: 'Be useful.',
  paramsSchema: z.object({}),
  sections: [
    { key: 'body', title: 'Body', guidance: 'Write it.', schema: z.object({ text: z.string() }) },
    {
      key: 'tally', title: 'Tally', guidance: 'Counted, not written.',
      derived: true,
      schema: z.object({ count: z.number() }),
      derive: ({ sources }) => ({ count: sources.length, zzDerived: 'never asked for' }),
    },
  ],
  agents: [{ id: 'writer', role: 'producer', objective: 'Write.', produces: ['body'], researchBudget: 1 }],
  buildBrief: () => 'Find things.',
};

describe('a derived section is validated too', () => {
  it('strips a key the section never declared', async () => {
    // One guard, not two: deleting the whole-report parse in `research-engine`
    // turns this red on its own, where the agent-written case above stays green.
    const out = await runResearch({ template: derivedTemplate, params: {}, jobId: 'der1', generatedAt: 't' });

    expect(out.trace.status).toBe('completed');
    // Non-vacuous by construction: the section really was derived and delivered.
    expect(out.report.tally).toBeDefined();
    expect(JSON.stringify(out.report.tally)).not.toContain('zzDerived');
  });
});
