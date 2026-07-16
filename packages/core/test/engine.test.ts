import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the external web-search/extract tools (no network).
vi.mock('../src/tools/web-search.js', () => ({
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

describe('engine — runResearch with mocked LLM + search', () => {
  let mock: MockLlmProvider;
  beforeEach(() => {
    mock = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', mock);
  });

  it('produces a schema-valid essential report (12 sections) with lorem-ipsum prose', async () => {
    const out = await run('essential');
    expect(out.trace.status).toBe('completed');
    expect(out.meta.mode).toBe('essential');
    expect(out.meta.degradedSections).toBeUndefined();

    // Essential drops the heavy analytical sections.
    expect(Object.keys(out.report)).toHaveLength(12);
    expect(out.report).not.toHaveProperty('financial_analysis');
    expect(out.report).toHaveProperty('sources');

    // The assembled report validates against the effective schema.
    const exclude = new Set(template.modes!.essential!.exclude);
    const eff = { ...template, sections: template.sections.filter((s) => !exclude.has(s.key)) };
    expect(reportSchemaOf(eff).safeParse(out.report).success).toBe(true);

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
    expect(out.meta.degradedSections).toContain('market_overview');
    expect(out.trace.status).toBe('completed'); // other sections still complete
  });
});
