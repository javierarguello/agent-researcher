/**
 * MEASUREMENT, not a test. Skipped unless `MEASURE=1`.
 *
 *   MEASURE=1 npx vitest run test/context-size.measure.test.ts --reporter=basic
 *
 * The question it answers: how much text does each agent of the COMPREHENSIVE
 * Florida model actually receive, and where do the C4 caps bite? Comprehensive on
 * purpose — `essential` drops six sections and skips three agents, including the
 * heavy ones, so it would understate the thing being measured.
 *
 * No model is involved. Sections are generated at the LENGTHS THE GUIDANCE ASKS
 * FOR (a "≥250 words" field gets ~250 words), which makes the numbers a realistic
 * upper-middle case, deterministic and free. A live model would give one sample of
 * one run; this gives the shape.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { sampleFromSchema } from './mocks/llm.js';
import type { GenerateOptions, GenerateResult, LlmProvider } from '../src/llm/provider.js';

const template = getTemplate('florida-business-for-sale')!;

/** Roughly what a "2-3 paragraph" / "≥250 words" prose field really weighs. */
const PROSE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(20);

/** Which agent owns a set of section keys, so a call can be attributed. */
function agentFor(keys: string[]): string {
  const sectionKeys = keys.filter((k) => !k.startsWith('_')); // drop the handoff
  const owned = (a: { produces?: string[]; enriches?: string[] }) => [...(a.produces ?? []), ...(a.enriches ?? [])];
  return template.agents.find((a) => sectionKeys.every((k) => owned(a).includes(k)))?.id ?? sectionKeys.join('+');
}

interface Row { agent: string; systemChars: number; contextChars: number; totalChars: number }

class Measuring implements LlmProvider {
  readonly name = 'measuring';
  readonly writes: Row[] = [];
  /** Size of every request the research loop made, in order. */
  readonly loop: number[] = [];
  /** Of each, how much was the upstream context block carried in the kickoff. */
  readonly loopContext: number[] = [];

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const usage = { inputTokens: 100, outputTokens: 100 };

    if (opts.responseSchema) {
      const keys = Object.keys((opts.responseSchema as { properties?: object }).properties ?? {});
      const text = JSON.stringify(opts.messages.map((m) => m.text ?? '').join(''));
      const marker = 'SECTIONS ALREADY PRODUCED';
      const context = text.includes(marker) ? text.slice(text.indexOf(marker)) : '';
      this.writes.push({
        agent: agentFor(keys),
        systemChars: opts.system.length,
        contextChars: context.length,
        totalChars: opts.system.length + text.length,
      });
      // Realistic-length sections, so downstream context is realistic too.
      return { text: JSON.stringify(sampleFromSchema(opts.responseSchema as never, undefined, 0, PROSE)), toolCalls: [], usage };
    }

    if (opts.tools?.length) {
      const chars = opts.system.length + JSON.stringify(opts.messages).length;
      this.loop.push(chars);
      // The kickoff carries the agent's upstream context, and it is re-sent on
      // EVERY turn — so its share is the multiplier worth knowing.
      const kickoff = opts.messages[0]?.text ?? '';
      const ctx = kickoff.includes('SECTIONS ALREADY PRODUCED') ? kickoff.slice(kickoff.indexOf('SECTIONS ALREADY PRODUCED')) : '';
      this.loopContext.push(ctx.length);
      const toolMsgs = opts.messages.filter((m) => m.role === 'tool').length;
      if (toolMsgs === 0) {
        return { text: '', usage, toolCalls: [{ id: 't0', name: 'update_plan', args: { steps: [{ task: 'go', status: 'doing' }] } }] };
      }
      if (toolMsgs < 6) {
        return {
          text: '',
          usage,
          toolCalls: [
            toolMsgs % 2 === 0
              ? { id: `s${toolMsgs}`, name: 'web_search', args: { query: `q${toolMsgs}` } }
              : { id: `f${toolMsgs}`, name: 'fetch_page', args: { url: `https://example.com/p${toolMsgs}` } },
          ],
        };
      }
      return { text: 'Ready to write.', toolCalls: [], usage };
    }
    return { text: PROSE, toolCalls: [], usage };
  }
}

const k = (n: number) => `${(n / 1000).toFixed(1)}k`;

describe.skipIf(process.env.MEASURE !== '1')('how much text each agent receives (comprehensive)', () => {
  it('measures it', { timeout: 600_000 }, async () => {
    const provider = new Measuring();
    __setProviderForTests('gemini-vertex', provider);

    const params = template.paramsSchema.parse({
      industry: 'laundromats', location: 'Miami-Dade County, FL', mode: 'comprehensive',
    }) as Record<string, unknown>;
    const out = await runResearch({ template, params, jobId: 'measure', generatedAt: 't' });
    expect(out.trace.status).toBe('completed');
    // …and WHOLE. This run used to lose `charts` (the fixture's prose ignored the
    // chart schema's `maxLength`, both chart agents failed their writes) and the
    // "completed" here hid it — along with 417k chars of failed calls in the
    // write-size total everyone cited. Mutation that reds this: ignore `maxLength`
    // in `sampleFromSchema` again.
    expect(out.meta.sections ?? []).toEqual([]);

    const rows = [...provider.writes].sort((a, b) => b.totalChars - a.totalChars);
    console.log('\n=== WRITE CALLS — input size per agent (sorted) ===');
    console.log('agent                     total    of which upstream context');
    for (const r of rows) {
      console.log(`${r.agent.padEnd(24)} ${k(r.totalChars).padStart(7)}   ${k(r.contextChars).padStart(7)}`);
    }

    const trimmed = rows.filter((r) => r.contextChars > 0);
    console.log(`\nagents receiving upstream context: ${trimmed.length}/${rows.length}`);
    console.log(`largest single input:              ${k(rows[0]!.totalChars)}  (${rows[0]!.agent})`);
    console.log(`total across all write calls:      ${k(rows.reduce((n, r) => n + r.totalChars, 0))}`);

    console.log('\n=== RESEARCH LOOP — request size, first to last ===');
    console.log(provider.loop.map((n) => k(n)).join(' → '));
    console.log(`turns: ${provider.loop.length}   first: ${k(provider.loop[0] ?? 0)}   largest: ${k(Math.max(...provider.loop))}`);

    const loopTotal = provider.loop.reduce((n, x) => n + x, 0);
    const loopCtx = provider.loopContext.reduce((n, x) => n + x, 0);
    const writeTotal = rows.reduce((n, r) => n + r.totalChars, 0);
    console.log('\n=== WHERE THE INPUT ACTUALLY GOES ===');
    console.log(`research loops:  ${k(loopTotal).padStart(8)}   of which re-sent upstream context: ${k(loopCtx)} (${Math.round((loopCtx / loopTotal) * 100)}%)`);
    console.log(`write calls:     ${k(writeTotal).padStart(8)}`);
    console.log(`TOTAL:           ${k(loopTotal + writeTotal).padStart(8)}`);
  });
});
