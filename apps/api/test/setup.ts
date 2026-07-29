/** Reset the in-memory Firestore + per-instance limiter state between API tests. */
import { beforeEach, vi } from 'vitest';
import { __resetDb } from '../../../packages/core/test/mocks/firestore.js';
import { __setProviderForTests, type GenerateResult } from '@agent-researcher/core';
import { __resetBurst } from '../src/public-limit.js';
import { clearPublicCache } from '../src/cache.js';
import { isLive } from './llm-mode.js';

/**
 * Stand-in for the cheap model, so the assisted pre-flight pass can be exercised
 * without a network call. Tests that care about its answer set `fakeLlm.reply`.
 * Not installed in live mode (`TEST_LLM=ollama`), where the real local model answers.
 */
export const fakeLlm = {
  reply: '{"quality":"ok"}',
  calls: 0,
  provider: {
    name: 'gemini-vertex',
    async generate(): Promise<GenerateResult> {
      fakeLlm.calls++;
      return { text: fakeLlm.reply, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
    },
  },
};
if (!isLive) __setProviderForTests('gemini-vertex', fakeLlm.provider);

beforeEach(() => {
  __resetDb();
  __resetBurst();
  // The public cache is a module-level Map that outlives __resetDb(), so without
  // this a test can be served a catalog for an app that no longer exists — which
  // makes tests pass more easily, the wrong direction for a cache to help in.
  clearPublicCache();
  fakeLlm.reply = '{"quality":"ok"}';
  fakeLlm.calls = 0;
  vi.useRealTimers();
});
