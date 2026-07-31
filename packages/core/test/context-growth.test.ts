/**
 * What a job re-sends on every call, and why it used to grow without limit (C4).
 *
 * Two growers, both invisible: nothing fails, the bill just gets bigger the longer
 * a job runs.
 *
 *   1. The research loop keeps every tool result in context for every later turn.
 *      A fetched page is 6,000 characters, so by turn twelve the model re-reads
 *      eleven full pages to decide one more query — the loop's input cost grows
 *      with the SQUARE of the budget.
 *   2. An agent's context is its upstream dependencies serialized whole, with no
 *      cap. The exec-summary writer depends on twelve agents, so it received the
 *      entire report as input.
 *
 * These count CHARACTERS ACTUALLY SENT, measured off the provider, because that is
 * the thing being paid for.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/tools/web-search.js', () => ({
  searchCostPerCall: () => 0,
  canExtractPages: () => true,
  searchWeb: async () => [{ title: 't', url: 'https://example.com/s', snippet: 's' }],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'P'.repeat(6000) })),
}));

import { createEvidence, gather } from '../src/engine/gather.js';
import { buildProducerSynthPrompt } from '../src/engine/prompt.js';
import type { ResolvedModel } from '../src/llm/index.js';
import type { AgentSpec, ReportSection } from '../src/templates/types.js';
import type { GenerateOptions, GenerateResult, LlmProvider } from '../src/llm/provider.js';

/** Fetches a different page every turn, and records what each call carried. */
class PageHungry implements LlmProvider {
  readonly name = 'hungry';
  readonly sizes: number[] = [];
  readonly requests: GenerateOptions[] = [];
  private turn = 0;

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.requests.push(structuredClone(opts));
    this.sizes.push(JSON.stringify(opts.messages).length);
    this.turn += 1;
    const usage = { inputTokens: 1, outputTokens: 1 };
    if (this.turn > 8) return { text: 'Ready to write.', toolCalls: [], usage };
    return {
      text: '',
      usage,
      toolCalls: [{ id: `f${this.turn}`, name: 'fetch_page', args: { url: `https://example.com/p${this.turn}` } }],
    };
  }
}

const modelFor = (provider: LlmProvider): ResolvedModel => ({
  alias: 'gather', provider, model: 'm', inPerM: 0, outPerM: 0,
});

async function runLoop(provider: PageHungry) {
  const evidence = createEvidence();
  await gather({
    model: modelFor(provider), system: 's', messages: [{ role: 'user', text: 'go' }],
    maxTurns: 8, evidence,
  });
  return evidence;
}

/** Full page bodies carried by one request. */
function fullPagesIn(opts: GenerateOptions): number {
  return opts.messages.filter((m) => {
    const body = m.toolResult?.response as { pages?: Array<{ content?: string }> } | undefined;
    return m.toolResult?.name === 'fetch_page' && (body?.pages ?? []).some((p) => (p.content ?? '').length > 1000);
  }).length;
}

describe('the research loop stops re-sending every page it has read', () => {
  it('carries at most a couple of full page bodies, however long it runs', async () => {
    const provider = new PageHungry();
    await runLoop(provider);

    expect(provider.requests.length).toBeGreaterThan(5); // it really did run long
    for (const req of provider.requests) expect(fullPagesIn(req)).toBeLessThanOrEqual(2);
  });

  it('stops the context growing with the number of turns', async () => {
    const provider = new PageHungry();
    await runLoop(provider);

    const first = provider.sizes[1]!; // after one page
    const last = provider.sizes.at(-1)!;
    // Unbounded, the last turn carried eight pages where the second carried one.
    // Bounded, the difference is the small stuff: URLs, plans, stubs.
    expect(last).toBeLessThan(first * 3);
  });

  it('says where the text went, instead of looking like an empty page', async () => {
    const provider = new PageHungry();
    await runLoop(provider);

    const stubbed = JSON.stringify(provider.requests.at(-1)!.messages);
    // A blanked-out page reads to an agent as "this link says nothing" — a
    // different claim from "we already read it".
    expect(stubbed).toMatch(/kept in full for the write-up/i);
  });

  it('keeps every page WHOLE in the evidence the report is written from', async () => {
    const provider = new PageHungry();
    const evidence = await runLoop(provider);

    // The trimming is about what the loop re-sends, never about what was bought.
    expect(evidence.extracted.length).toBeGreaterThan(2);
    for (const page of evidence.extracted) expect(page.content.length).toBe(6000);
  });
});

// --- Grower 2: an agent's upstream context ----------------------------------

const agent: AgentSpec = { id: 'writer', role: 'synthesizer', objective: 'Write it.', produces: ['x'] };
const sections: ReportSection[] = [
  { key: 'x', title: 'X', guidance: 'Write X.', schema: { safeParse: () => ({ success: true }) } as never },
];

const promptWith = (context: Record<string, unknown>) =>
  buildProducerSynthPrompt({ agent, brief: 'b', sections, evidence: [], extracted: [], context, lang: 'en' });

describe('an agent’s context does not carry the whole report', () => {
  it('trims a section that is too long, and says where the rest is', () => {
    const prompt = promptWith({ deep_dives: { overview: 'z'.repeat(80_000) } });

    expect(prompt.length).toBeLessThan(60_000);
    expect(prompt).toMatch(/trimmed to fit/i);
    // Where the rest is, so the agent does not read the gap as missing data.
    expect(prompt).toMatch(/complete in the report/i);
  });

  it('bounds the TOTAL, not each section on its own', () => {
    // The per-section cap was the wrong shape: measured on a comprehensive report
    // almost no single section exceeded it, so the exec-summary writer still got
    // 109k across a dozen dependencies that were each individually fine.
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`section_${i}`, { overview: 'z'.repeat(20_000) }]),
    );
    const prompt = promptWith(many);
    expect(prompt.length).toBeLessThan(70_000);
  });

  it('gives every dependency a share, so none of them vanishes', () => {
    const prompt = promptWith({
      big: { overview: 'z'.repeat(80_000) },
      small_one: { note: 'first' },
      small_two: { note: 'second' },
    });

    expect(prompt).toContain('first');
    expect(prompt).toContain('second');
  });

  it('leaves an ordinary context untouched', () => {
    const prompt = promptWith({ market: { overview: 'A normal section.' } });
    expect(prompt).toContain('A normal section.');
    expect(prompt).not.toMatch(/trimmed to fit/i);
  });

  it('keeps the block valid JSON, trimmed or not', () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`s${i}`, { overview: 'z'.repeat(20_000) }]),
    );
    const prompt = promptWith({ ...many, small: { note: 'x' } });
    const block = prompt.split('"""')[1]!;
    const parsed = JSON.parse(block) as Record<string, unknown>;

    expect(Object.keys(parsed)).toHaveLength(13);
    expect(typeof parsed.s0).toBe('string'); // the trimmed stand-in
    expect(parsed.small).toEqual({ note: 'x' });
  });
});
