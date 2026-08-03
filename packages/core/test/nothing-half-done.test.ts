/**
 * Nothing half-done gets kept, and nothing half-read gets used as if it were whole.
 *
 * Javier, 2026-07-31: a retry must not pick up a section left half-made or a link
 * half-reviewed. `retry-waste.test.ts` covers the pass-level rule (only a research
 * loop that FINISHED may be reused). This file covers the two units below it, where
 * "partial" is easy to create and invisible once created:
 *
 *   - a page we could only read the start of,
 *   - a section from an agent that did not finish.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pages } = vi.hoisted(() => ({ pages: { next: [] as unknown[] } }));

vi.mock('../src/tools/web-search.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/web-search.js')>();
  return {
    ...actual,
    searchCostPerCall: () => 0,
    canExtractPages: () => true,
    searchWeb: async (query: string) => [
      { title: `Result for ${query}`, url: `https://example.com/${encodeURIComponent(query)}`, snippet: 's' },
    ],
    extractPages: async () => pages.next,
  };
});

import { capContent } from '../src/tools/web-search.js';
import { createEvidence, gather } from '../src/engine/gather.js';
import { runResearch } from '../src/engine/research-engine.js';
import { compactModel } from './fixtures/compact-model.js';
import { installMockProvider, MockLlmProvider } from './mocks/llm.js';
import type { ResolvedModel } from '../src/llm/index.js';
import type { GenerateOptions, GenerateResult, LlmProvider } from '../src/llm/provider.js';

const params = () => compactModel.paramsSchema.parse({}) as Record<string, unknown>;

/** Asks for one page, then stops. */
class FetchesOnePage implements LlmProvider {
  readonly name = 'fetcher';
  private done = false;
  async generate(): Promise<GenerateResult> {
    const usage = { inputTokens: 1, outputTokens: 1 };
    if (this.done) return { text: 'Ready to write.', toolCalls: [], usage };
    this.done = true;
    return { text: '', usage, toolCalls: [{ id: 'f', name: 'fetch_page', args: { url: 'https://example.com/p' } }] };
  }
}

const fetcherModel = (): ResolvedModel => ({
  alias: 'gather', provider: new FetchesOnePage(), model: 'm', inPerM: 0, outPerM: 0,
});

async function gatherOnce() {
  const evidence = createEvidence();
  await gather({
    model: fetcherModel(), system: 's', messages: [{ role: 'user', text: 'go' }],
    maxTurns: 2, evidence,
  });
  return evidence;
}

beforeEach(() => {
  pages.next = [];
});

describe('a link we could only half read says so', () => {
  it('marks a page that was cut off, inside the text the agent reads', () => {
    const cut = capContent('x'.repeat(20_000));

    expect(cut.truncated).toBe(true);
    expect(cut.content.length).toBeLessThan(20_000);
    // In the CONTENT, not on a flag beside it: every path that shows an agent a
    // page shows it the content, and a flag is what the first of them forgets to
    // render. Reading 6,000 characters of a 40,000-character page and being told
    // nothing is how an agent concludes a figure is absent when it is further down.
    expect(cut.content).toMatch(/CUT OFF/);
    expect(cut.content).toMatch(/do not conclude it is missing/i);
  });

  it('leaves a page that fitted completely alone', () => {
    const whole = capContent('a short page');
    expect(whole.truncated).toBeUndefined();
    expect(whole.content).toBe('a short page');
    expect(whole.content).not.toMatch(/CUT OFF/);
  });
});

describe('a link that could not be read is not kept at all', () => {
  it('keeps a page that came back whole', async () => {
    pages.next = [{ url: 'https://example.com/p', content: 'Full text.', ok: true }];
    const evidence = await gatherOnce();
    expect(evidence.extracted).toHaveLength(1);
  });

  it('keeps nothing when the fetch failed', async () => {
    pages.next = [{ url: 'https://example.com/p', content: '', ok: false, error: 'timeout' }];
    const evidence = await gatherOnce();

    // A failed fetch in the store would be an empty page the agent reads as "this
    // link says nothing", which is a different claim from "we could not open it".
    expect(evidence.extracted).toHaveLength(0);
    expect(evidence.extractedUrls.size).toBe(0);
  });

  it('keeps nothing when the fetch succeeded but returned no text', async () => {
    pages.next = [{ url: 'https://example.com/p', content: '', ok: true }];
    const evidence = await gatherOnce();
    expect(evidence.extracted).toHaveLength(0);
  });
});

describe('a section from an agent that did not finish is never kept', () => {
  it('leaves the report and the checkpoint without it', async () => {
    const mock: MockLlmProvider = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts: GenerateOptions) => {
      // WELL-FORMED JSON that does not satisfy the section's schema: `overview` is
      // required prose and `listings` a required array. This is the shape a half-made
      // section actually arrives in — not a parse error, a plausible object missing
      // half of itself. The schema gate is the only thing standing in its way.
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('findings')) {
        return {
          // `_handoff` INCLUDED, and that is the point. Without it the write is
          // rejected for the missing briefing, not for the half-made section — so
          // making `listings` optional in the fixture left this green and the
          // schema gate it names was never what did the work.
          text: JSON.stringify({ findings: { overview: 'Half a section.' }, _handoff: 'Found some things.' }),
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return base(opts);
    };

    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'h1', generatedAt: 't', finalize: false,
    });

    // Half a section is never a thing: the write is validated as a whole, so an
    // agent either contributes all of its sections or none of them.
    expect(out.checkpoint.report).not.toHaveProperty('findings');
    expect(out.checkpoint.doneAgentIds).not.toContain('scout');
    // …and the agent that depends on it did not run on stale context either.
    expect(out.checkpoint.doneAgentIds).not.toContain('advisor');
  });

  it('keeps the sections of the agents that DID finish', async () => {
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'h2', generatedAt: 't', finalize: false,
    });

    expect(out.checkpoint.doneAgentIds).toContain('scout');
    expect(out.checkpoint.report).toHaveProperty('findings');
  });
});
