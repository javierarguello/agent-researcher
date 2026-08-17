/**
 * A model that has already lost to the attacker.
 *
 * `MockLlmProvider` answers every prompt with schema-valid lorem ipsum and a fixed
 * three-turn research script. This one does the same UNTIL it has read a poisoned
 * page (`fixtures/poisoned-web.ts`), and from then on it does exactly what the page
 * asked: writes the payload into its sections, seeds its handoff, spends its
 * budget where it was told to, or loops on free tool calls.
 *
 * That is the point. The mock tier of the red team is not asking "would a model
 * fall for this" — a 3B model will, and a frontier model sometimes will. It is
 * asking "when the model has fallen for it, what stops the damage": the fence
 * position, the schema parse, `splitHandoff`'s cap, the renderers' escaping, the
 * loop's iteration bound. Every one of those is deterministic and this provider
 * makes them measurable without a network.
 *
 * It also records every prompt it was shown, flattened, so a test can count reach
 * per sentinel and per fence region — the "20 of 42 prompts" measurement, made
 * repeatable.
 */
import { __setProviderForTests } from '../../src/llm/models.js';
import type { GenerateOptions, GenerateResult, ToolCall } from '../../src/llm/provider.js';
import { SOURCE_FENCE } from '../../src/engine/prompt.js';
import { MockLlmProvider, sampleFromSchema } from './llm.js';
import type { Payload } from '../fixtures/poisoned-web.js';

export interface SeenPrompt {
  /** 1-based index of the generate() call. */
  call: number;
  /** Structured (schema) call, research-loop call, or plain text. */
  kind: 'structured' | 'loop' | 'text';
  system: string;
  /** Every message flattened — text as-is, tool results JSON-encoded, joined by newlines. */
  body: string;
}

/** Text a model reads AS OURS: the even regions between exact markers. */
export function outsideTheFence(prompt: string): string {
  return prompt.split(SOURCE_FENCE).filter((_, i) => i % 2 === 0).join('\n');
}

/** Text a model is told carries no authority: the odd regions. */
export function insideTheFence(prompt: string): string {
  return prompt.split(SOURCE_FENCE).filter((_, i) => i % 2 === 1).join('\n');
}

export interface Reach {
  /** Prompts (generate calls) that carried the sentinel anywhere. */
  prompts: number;
  /** Structured (writing) calls that carried it — the ones whose output is the report. */
  structured: number;
  /**
   * Writing calls where it appeared OUTSIDE the marker fence — read as ours.
   *
   * Counted for structured calls only. The research loop carries no marker by
   * design (tool results are JSON-encoded and labelled, not fenced), so "outside
   * the fence" is trivially true there and would say nothing.
   */
  outsideStructured: number;
  /** Total generate calls, for the denominator. */
  total: number;
}

/** How far a sentinel travelled through the prompts a run produced. */
export function reach(seen: SeenPrompt[], sentinel: string): Reach {
  const carrying = seen.filter((p) => p.system.includes(sentinel) || p.body.includes(sentinel));
  const structured = carrying.filter((p) => p.kind === 'structured');
  return {
    prompts: carrying.length,
    structured: structured.length,
    outsideStructured: structured.filter((p) => outsideTheFence(`${p.system}\n${p.body}`).includes(sentinel)).length,
    total: seen.length,
  };
}

function flatten(opts: GenerateOptions): string {
  return opts.messages
    .map((m) => m.text ?? (m.toolResult ? JSON.stringify(m.toolResult) : m.toolCalls ? JSON.stringify(m.toolCalls) : ''))
    .join('\n');
}

/** Pull the top result URL out of the last web_search tool result in the conversation. */
function lastSearchTopUrl(opts: GenerateOptions): string | undefined {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const r = opts.messages[i]?.toolResult;
    if (r?.name !== 'web_search') continue;
    const first = (r.response as { results?: Array<{ url?: string }> })?.results?.[0];
    return first?.url;
  }
  return undefined;
}

export class ObedientMockProvider extends MockLlmProvider {
  readonly seen: SeenPrompt[] = [];
  /** Which payloads this model has read so far (by id), in order of first sight. */
  readonly obeyed: string[] = [];

  constructor(
    private readonly payloads: Payload[],
    private readonly opts: {
      /** The query the default script searches with. Broad on purpose — poison ranks first. */
      query?: string;
      /** How many honest searches the default script makes after the poisoned fetch. */
      searches?: number;
    } = {},
  ) {
    super();
  }

  private sawPayloads(text: string): Payload[] {
    return this.payloads.filter((p) => text.includes(p.page.url) || text.includes(p.sentinel));
  }

  override async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.calls += 1;
    const usage = { inputTokens: 200, outputTokens: 80 };
    const body = flatten(opts);
    const kind: SeenPrompt['kind'] = opts.responseSchema ? 'structured' : opts.tools?.length ? 'loop' : 'text';
    this.seen.push({ call: this.calls, kind, system: opts.system, body });
    const everything = `${opts.system}\n${body}`;
    const saw = this.sawPayloads(everything);
    for (const p of saw) if (!this.obeyed.includes(p.id)) this.obeyed.push(p.id);

    // Structured write: sample, then let every payload the model has read rewrite it.
    if (opts.responseSchema) {
      let value = sampleFromSchema(opts.responseSchema) as Record<string, unknown>;
      for (const p of saw) if (p.obeyStructured) value = p.obeyStructured(value);
      return { text: JSON.stringify(value), toolCalls: [], usage };
    }

    if (opts.tools?.length) {
      const toolMsgs = opts.messages.filter((m) => m.role === 'tool').length;
      const spent = opts.messages.filter((m) => m.role === 'tool' && (m.toolResult?.name === 'web_search' || m.toolResult?.name === 'fetch_page')).length;
      // A payload the model has read gets to drive the loop.
      for (const p of saw) {
        const move = p.obeyLoop?.({ toolMsgs, text: everything, spent });
        if (move === 'stop') return { text: 'Ready to write.', toolCalls: [], usage };
        if (move) return { text: '', toolCalls: move, usage };
      }
      // Default script: plan → one broad search → fetch its top result (the poison,
      // if any is installed) → a couple of honest searches → stop.
      const script = this.defaultLoop(opts, toolMsgs);
      return { text: script ? '' : 'Ready to write.', toolCalls: script ?? [], usage };
    }

    return super.generate(opts);
  }

  private defaultLoop(opts: GenerateOptions, toolMsgs: number): ToolCall[] | null {
    const query = this.opts.query ?? 'laundromat business for sale Miami';
    const honest = this.opts.searches ?? 1;
    if (toolMsgs === 0) return [{ id: 't0', name: 'update_plan', args: { steps: [{ task: 'search listings', status: 'doing' }] } }];
    if (toolMsgs === 1) return [{ id: 't1', name: 'web_search', args: { query } }];
    if (toolMsgs === 2) {
      const url = lastSearchTopUrl(opts);
      return url ? [{ id: 't2', name: 'fetch_page', args: { url } }] : null;
    }
    if (toolMsgs < 3 + honest) return [{ id: `t${toolMsgs}`, name: 'web_search', args: { query: `${query} revenue SDE` } }];
    return null;
  }
}

/** Install under every provider name (see `installMockProvider`), and return it. */
export function installObedientProvider(payloads: Payload[], opts?: ConstructorParameters<typeof ObedientMockProvider>[1]): ObedientMockProvider {
  const mock = new ObedientMockProvider(payloads, opts);
  for (const name of ['gemini-vertex', 'ollama']) __setProviderForTests(name, mock);
  return mock;
}
