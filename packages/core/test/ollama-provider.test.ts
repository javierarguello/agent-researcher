/**
 * The Ollama provider's wire contract, against a stubbed `fetch`.
 *
 * The live suites can't run in CI, so without this the local-model path would be
 * entirely unverified until someone starts Docker — and a typo in a field name
 * (`format`, `num_predict`, `tool_calls`) would only surface then, as a silent
 * fail-soft degrade rather than an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../src/llm/ollama.js';

let lastRequest: { url: string; body: Record<string, any> };

function stubFetch(response: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: { body?: string } = {}) => {
      lastRequest = { url: String(url), body: JSON.parse(init.body ?? '{}') };
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as Response;
    }),
  );
}

const provider = new OllamaProvider();
const base = { system: 'You classify text.', messages: [{ role: 'user' as const, text: 'hello' }], model: 'qwen2.5:3b' };

describe('ollama provider', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('posts to /api/chat with the system turn first and streaming off', async () => {
    stubFetch({ message: { role: 'assistant', content: 'hi' }, prompt_eval_count: 12, eval_count: 3 });
    const res = await provider.generate(base);

    expect(lastRequest.url).toBe('http://localhost:11434/api/chat');
    expect(lastRequest.body.stream).toBe(false);
    expect(lastRequest.body.model).toBe('qwen2.5:3b');
    expect(lastRequest.body.messages[0]).toEqual({ role: 'system', content: 'You classify text.' });
    expect(lastRequest.body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(res.text).toBe('hi');
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('passes a responseSchema as `format` (constrained decoding) and drops tools', async () => {
    stubFetch({ message: { content: '{"quality":"ok"}' } });
    const schema = { type: 'object', properties: { quality: { type: 'string', enum: ['ok', 'broad'] } } };
    const res = await provider.generate({
      ...base,
      responseSchema: schema,
      tools: [{ name: 'web_search', description: 'search', parameters: { type: 'object' as const } }],
    });

    expect(lastRequest.body.format).toEqual(schema);
    expect(lastRequest.body.tools).toBeUndefined(); // structured output excludes tool calling
    expect(JSON.parse(res.text)).toEqual({ quality: 'ok' });
  });

  it('forwards the determinism knobs the gate-style calls rely on', async () => {
    stubFetch({ message: { content: '{}' } });
    await provider.generate({ ...base, temperature: 0, seed: 7, maxOutputTokens: 256 });

    expect(lastRequest.body.options).toEqual({ temperature: 0, seed: 7, num_predict: 256 });
  });

  it('maps tool definitions and reads tool calls back', async () => {
    stubFetch({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'web_search', arguments: { query: 'laundromats miami' } } }],
      },
    });
    const res = await provider.generate({
      ...base,
      tools: [{ name: 'web_search', description: 'Search the web', parameters: { type: 'object' as const, properties: { query: { type: 'string' as const } } } }],
    });

    expect(lastRequest.body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    });
    expect(res.toolCalls).toEqual([{ id: 'web_search-0', name: 'web_search', args: { query: 'laundromats miami' } }]);
  });

  it('round-trips a tool result back into the conversation', async () => {
    stubFetch({ message: { content: 'done' } });
    await provider.generate({
      ...base,
      messages: [
        { role: 'user', text: 'find listings' },
        { role: 'model', text: '', toolCalls: [{ id: 't0', name: 'web_search', args: { query: 'x' } }] },
        { role: 'tool', toolResult: { name: 'web_search', response: [{ url: 'https://example.com' }] } },
      ],
    });

    const [, user, assistant, tool] = lastRequest.body.messages;
    expect(user.role).toBe('user');
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls[0].function.name).toBe('web_search');
    expect(tool).toEqual({ role: 'tool', content: '[{"url":"https://example.com"}]' });
  });

  it('throws on an HTTP error and on a body-level error, so callers can fail soft deliberately', async () => {
    stubFetch({ error: 'model not found' }, false);
    await expect(provider.generate(base)).rejects.toThrow(/Ollama 500/);

    stubFetch({ error: 'model "qwen2.5:3b" not found' });
    await expect(provider.generate(base)).rejects.toThrow(/not found/);
  });
});
