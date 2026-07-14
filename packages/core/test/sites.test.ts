import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the external web-search/extract tools (no network).
vi.mock('../src/tools/web-search.js', () => ({
  searchWeb: async (query: string) => [
    { title: `Result for ${query}`, url: `https://example.com/${Math.random().toString(36).slice(2)}`, snippet: 'snippet' },
  ],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'Full page content.' })),
}));

import { buildAgentKickoff } from '../src/engine/prompt.js';
import { effectiveSites, runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';
import type { AgentSpec, ResearchTemplate } from '../src/templates/types.js';

const agent: AgentSpec = { id: 'a', role: 'producer', objective: 'Find things.', produces: ['x'] };

describe('workflow sites — additive suggested sources', () => {
  it('effectiveSites unions template-level and agent-level sites (deduped)', () => {
    const template = { sites: ['a.com', 'b.com'] } as ResearchTemplate<any>;
    const withAgent = { ...agent, sites: ['b.com', 'c.com'] };
    expect(effectiveSites(template, withAgent).sort()).toEqual(['a.com', 'b.com', 'c.com']);
    // No sites anywhere → empty.
    expect(effectiveSites({} as ResearchTemplate<any>, agent)).toEqual([]);
    // Only template-level applies to an agent with none of its own.
    expect(effectiveSites(template, agent).sort()).toEqual(['a.com', 'b.com']);
  });

  it('the agent kickoff frames sites as ADDITIVE, never a restriction', () => {
    const kickoff = buildAgentKickoff({
      agent,
      brief: 'brief',
      sections: [],
      maxTurns: 5,
      context: {},
      sites: ['bizbuysell.com', 'loopnet.com'],
    });
    expect(kickoff).toContain('SUGGESTED SOURCES');
    expect(kickoff).toContain('additive');
    expect(kickoff).toContain('NOT a restriction');
    expect(kickoff).toContain('bizbuysell.com');
    expect(kickoff).toContain('loopnet.com');
    // Open web search must still be the baseline.
    expect(kickoff).toMatch(/IN ADDITION TO open web search/i);
  });

  it('omits the suggested-sources block when no sites are configured', () => {
    const kickoff = buildAgentKickoff({ agent, brief: 'brief', sections: [], maxTurns: 5, context: {} });
    expect(kickoff).not.toContain('SUGGESTED SOURCES');
  });

  it("propagates a template's agent sites into the run (deal-scout gets the marketplaces)", async () => {
    const mock = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', mock);
    const template = getTemplate('florida-business-for-sale')!;
    const params = template.paramsSchema.parse({ industry: 'laundromats', mode: 'essential' }) as Record<string, unknown>;
    const out = await runResearch({ template, params, jobId: 'sites-job', generatedAt: '2026-07-13T00:00:00.000Z' });

    const scout = out.trace.agents.find((a) => a.id === 'deal-scout');
    expect(scout).toBeDefined();
    const note = scout!.notes.find((n) => n.includes('Suggested sources (additive)'));
    expect(note).toBeTruthy();
    expect(note).toContain('bizbuysell.com');
  });
});
