import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `TEST_LLM=ollama` swaps the stub provider for the local model server (see
 * docker-compose.local.yml). Everything else about the run is unchanged, so the
 * default `npm test` needs nothing installed. The moderation classifier stays
 * off even then, so one sloppy verdict can't make unrelated suites flaky — run
 * it deliberately with TEST_MODERATION_LLM=1.
 */
const live = process.env.TEST_LLM === 'ollama';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // A local model on CPU is far slower than a stub.
    ...(live ? { testTimeout: 120_000, hookTimeout: 120_000 } : {}),
    // APP_ENV=production so auth + the credits gate are ACTIVE (security tests).
    env: {
      ENV: 'dev',
      APP_ENV: 'production',
      GCP_PROJECT_ID: 'test-project',
      AUTH_JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      POSTMARK_SERVER_TOKEN: 'test-postmark-token',
      // In mock mode both model-backed passes are ON against the stub (which always
      // allows), so the real code path is exercised. In live mode the classifier
      // stays off unless asked for: one sloppy verdict would make unrelated suites
      // flaky, while the deterministic pre-screen still guards every test.
      MODERATION_LLM: !live || process.env.TEST_MODERATION_LLM === '1' ? 'true' : 'false',
      VALIDATION_LLM: 'true',
      TEST_LLM: process.env.TEST_LLM ?? 'mock',
      ...(live
        ? {
            // EVERY alias on the local server, not just `flash`. The API's own
            // model use is the classifier (flash), but an end-to-end test also
            // runs the engine — and an alias left pointing at Vertex would send a
            // "local" test run to a paid hosted model.
            LLM_PROVIDER: 'ollama',
            LLM_PROVIDER_FLASH: 'ollama',
            LLM_MODEL_FLASH: process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:3b',
            LLM_MODEL_GATHER: process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:3b',
            LLM_MODEL_PRO: process.env.LLM_MODEL_PRO ?? process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:3b',
            OLLAMA_HOST: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
            // A 3B model on CPU: one agent at a time, and a smaller JSON ceiling,
            // which is where long structured output derails.
            LLM_MAX_CONCURRENT_AGENTS: '1',
            LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS ?? '4096',
          }
        : {}),
      // Fast, deterministic retries: an end-to-end test that holds a job should
      // spend its time on the model, not on backoff.
      AGENT_RETRY_BASE_MS: '1',
      AGENT_RETRY_MAX_MS: '1',
      RESEARCH_MAX_TURNS: '4',
      PREFLIGHT_ASSIST_ATTEMPTS: '2',
      PREFLIGHT_COOLDOWN_HOURS: '1,4',
      // Public-endpoint limits: high enough for the existing auth flows, low
      // enough for test/public-limits.test.ts to reach them in a few calls.
      PUBLIC_BURST_PER_MINUTE: '500',
      PUBLIC_REGISTER_PER_HOUR_IP: '5',
      PUBLIC_REGISTER_PER_HOUR_EMAIL: '3',
      PUBLIC_LOGIN_PER_HOUR_IP: '8',
      PUBLIC_LOGIN_PER_HOUR_EMAIL: '5',
      PUBLIC_RESET_PER_HOUR_IP: '5',
      PUBLIC_RESET_PER_HOUR_EMAIL: '3',
      PUBLIC_CONTACT_PER_HOUR_IP: '3',
      LOG_LEVEL: 'silent',
    },
  },
  resolve: {
    alias: {
      // Workspace packages resolved RELATIVE TO THIS FILE, not by walking up
      // node_modules. A git worktree has no `node_modules` of its own, so the bare
      // specifier escapes the worktree and resolves to the MAIN checkout — meaning a
      // review agent could mutate `packages/core` in its worktree, watch every test
      // stay green, and report the test as unable to fail. That happened, and it
      // silently invalidated part of a review round. `test/resolution.test.ts` is
      // the guard that this stays true.
      '@agent-researcher/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@google-cloud/firestore': fileURLToPath(new URL('../../packages/core/test/mocks/firestore.ts', import.meta.url)),
      // Without this, a test that runs a job uploads report.json to the REAL dev
      // bucket with whatever credentials the developer has — or fails slowly on a
      // machine with none. Same treatment as Firestore, for the same reason.
      '@google-cloud/storage': fileURLToPath(new URL('../../packages/core/test/mocks/storage.ts', import.meta.url)),
    },
  },
});
