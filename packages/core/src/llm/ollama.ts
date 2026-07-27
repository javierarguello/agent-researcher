/**
 * Ollama provider — a local, free model server for development and testing.
 *
 * This exists so the whole flow (moderation → pre-flight review → job) can be
 * exercised end-to-end on a laptop, with no cloud credentials and no token bill.
 * It is NOT meant for production: a 3B local model is far weaker than the hosted
 * ones, which is exactly why it is a good test target — if the guards hold with a
 * sloppy model, they hold.
 *
 * Talks the native `/api/chat` endpoint:
 *  - structured output → `format: <json schema>`, Ollama's constrained decoding,
 *    the same contract `responseSchema` expresses for Gemini;
 *  - tool calling → `tools: [...]` (supported by qwen2.5 / llama3.1 and similar);
 *  - determinism → `temperature` + `seed` in `options`.
 *
 * Enable with:
 *   LLM_PROVIDER=ollama  LLM_PROVIDER_FLASH=ollama  OLLAMA_HOST=http://localhost:11434
 */
import { config } from '../config.js';
import type {
  GenerateOptions,
  GenerateResult,
  LlmMessage,
  LlmProvider,
  ToolCall,
} from './provider.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaResponse {
  message?: OllamaMessage;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function toOllamaMessage(m: LlmMessage): OllamaMessage {
  if (m.role === 'tool') {
    return { role: 'tool', content: JSON.stringify(m.toolResult?.response ?? null) };
  }
  if (m.role === 'model') {
    return {
      role: 'assistant',
      content: m.text ?? '',
      ...(m.toolCalls?.length
        ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
        : {}),
    };
  }
  return { role: 'user', content: m.text ?? '' };
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const structured = !!opts.responseSchema;
    const tools = structured || opts.disableTools ? undefined : opts.tools;

    const body = {
      model: opts.model,
      stream: false,
      messages: [
        { role: 'system' as const, content: opts.system },
        ...opts.messages.map(toOllamaMessage),
      ],
      ...(structured ? { format: opts.responseSchema } : {}),
      ...(tools?.length
        ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
      options: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.seed != null ? { seed: opts.seed } : {}),
        ...(opts.maxOutputTokens ? { num_predict: opts.maxOutputTokens } : {}),
      },
    };

    const res = await fetch(`${config.llm.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.llm.ollamaTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as OllamaResponse;
    if (data.error) throw new Error(`Ollama error: ${data.error}`);

    const toolCalls: ToolCall[] = (data.message?.tool_calls ?? []).map((c, i) => ({
      id: `${c.function.name}-${i}`,
      name: c.function.name,
      args: c.function.arguments ?? {},
    }));

    return {
      text: (data.message?.content ?? '').trim(),
      toolCalls,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
    };
  }
}
