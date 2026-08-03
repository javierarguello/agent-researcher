import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The worker's own suite. It exists because the worker is where a job's OUTCOME
 * becomes a queue decision — ack or retry — and getting that wrong is invisible:
 * a held job that returns a retryable status is re-dispatched forever, and a
 * genuinely incomplete one that acks is silently abandoned.
 *
 * Firestore and Cloud Storage are the same in-memory fakes the other suites use,
 * so nothing here touches a real project.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      ENV: 'dev',
      APP_ENV: 'local',
      GCP_PROJECT_ID: 'test-project',
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
      '@google-cloud/storage': fileURLToPath(new URL('../../packages/core/test/mocks/storage.ts', import.meta.url)),
    },
  },
});
