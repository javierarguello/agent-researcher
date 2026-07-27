import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `TEST_LLM=ollama` points every model alias at the local server (see
 * docker-compose.local.yml) and enables the end-to-end report test. The default
 * run needs nothing installed: `test/mocks/llm.ts` answers instead.
 */
const live = process.env.TEST_LLM === 'ollama';
const localModel = process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:3b';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // A local model on CPU is orders of magnitude slower than the mock; the
    // report tests set their own longer per-test timeouts on top of this.
    ...(live ? { testTimeout: 300_000, hookTimeout: 300_000 } : {}),
    // Config values that config.ts reads at import time.
    env: {
      ENV: 'dev',
      APP_ENV: 'local',
      GCP_PROJECT_ID: 'test-project',
      AUTH_JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      RESEARCH_MAX_TURNS: '4',
      // Fast, deterministic retries in tests.
      AGENT_RETRY_BASE_MS: '1',
      AGENT_RETRY_MAX_MS: '1',
      AGENT_MAX_ATTEMPTS: '2',
      MAX_JOB_ATTEMPTS: '2',
      TEST_LLM: process.env.TEST_LLM ?? 'mock',
      ...(live
        ? {
            // Every alias on the local server — a small model is the only tier there.
            LLM_PROVIDER: 'ollama',
            LLM_MODEL_FLASH: localModel,
            LLM_MODEL_GATHER: localModel,
            LLM_MODEL_PRO: process.env.LLM_MODEL_PRO ?? localModel,
            OLLAMA_HOST: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
            // One agent at a time, and a smaller JSON ceiling: a 3B model on CPU
            // is slow, and long structured output is where it derails.
            LLM_MAX_CONCURRENT_AGENTS: '1',
            LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS ?? '4096',
          }
        : {}),
    },
  },
  resolve: {
    alias: {
      // All Firestore access hits the in-memory fake — no network/emulator.
      '@google-cloud/firestore': fileURLToPath(new URL('./test/mocks/firestore.ts', import.meta.url)),
    },
  },
});
