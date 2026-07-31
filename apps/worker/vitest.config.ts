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
      '@google-cloud/firestore': fileURLToPath(new URL('../../packages/core/test/mocks/firestore.ts', import.meta.url)),
      '@google-cloud/storage': fileURLToPath(new URL('../../packages/core/test/mocks/storage.ts', import.meta.url)),
    },
  },
});
