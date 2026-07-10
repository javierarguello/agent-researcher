/**
 * Mock LLM provider for tests. Implements the real `LlmProvider` interface and
 * returns deterministic, pre-generated content — no network, no cost.
 *
 * - Structured output (responseSchema present): returns schema-valid JSON with
 *   lorem-ipsum strings, so the engine assembles a valid report.json.
 * - Tool-calling loop (gather): plays a short plan → 2 searches → stop script,
 *   so the research loop terminates quickly.
 * - Reports fixed token usage so cost accounting is exercised deterministically.
 */
import type { GenerateOptions, GenerateResult, LlmProvider } from '../../src/llm/provider.js';

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.';

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  /** Count of generate() calls, for assertions. */
  calls = 0;

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.calls += 1;
    const usage = { inputTokens: 200, outputTokens: 80 };

    // Structured synthesis → return schema-valid JSON.
    if (opts.responseSchema) {
      return { text: JSON.stringify(sampleFromSchema(opts.responseSchema)), toolCalls: [], usage };
    }

    // Tool-calling research loop → short deterministic script.
    if (opts.tools?.length) {
      const toolMsgs = opts.messages.filter((m) => m.role === 'tool').length;
      if (toolMsgs === 0) {
        return { text: '', usage, toolCalls: [{ id: 't0', name: 'update_plan', args: { steps: [{ task: 'search', status: 'doing' }] } }] };
      }
      if (toolMsgs < 3) {
        return { text: '', usage, toolCalls: [{ id: `t${toolMsgs}`, name: 'web_search', args: { query: 'test query' } }] };
      }
      return { text: 'Ready to write.', toolCalls: [], usage };
    }

    // Plain text.
    return { text: LOREM, toolCalls: [], usage };
  }
}

// --- schema-valid sample generation -----------------------------------------

type Node = Record<string, unknown>;

export function sampleFromSchema(root: Node, node: Node = root, depth = 0): unknown {
  const defs = (root.$defs ?? root.definitions ?? {}) as Record<string, Node>;

  if (typeof node.$ref === 'string') {
    const name = node.$ref.replace(/^#\/(?:\$defs|definitions)\//, '');
    return sampleFromSchema(root, defs[name] ?? {}, depth);
  }
  // nullable union → pick the non-null branch
  const union = (node.anyOf ?? node.oneOf) as Node[] | undefined;
  if (Array.isArray(union)) {
    const branch = union.find((s) => s.type !== 'null') ?? union[0] ?? {};
    return sampleFromSchema(root, branch, depth);
  }
  if (Array.isArray(node.enum)) return (node.enum as unknown[])[0];

  const type = Array.isArray(node.type) ? (node.type as string[]).find((t) => t !== 'null') : node.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, Node>)) {
        out[k] = sampleFromSchema(root, v, depth + 1);
      }
      return out;
    }
    case 'array': {
      const items = (node.items ?? {}) as Node;
      const min = typeof node.minItems === 'number' ? node.minItems : 1;
      return Array.from({ length: Math.max(min, 1) }, () => sampleFromSchema(root, items, depth + 1));
    }
    case 'number':
    case 'integer':
      return 100;
    case 'boolean':
      return true;
    case 'string':
    default:
      return LOREM;
  }
}
