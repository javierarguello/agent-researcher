import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Config values that config.ts reads at import time.
    env: {
      ENV: 'dev',
      APP_ENV: 'local',
      GCP_PROJECT_ID: 'test-project',
      AUTH_JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      RESEARCH_MAX_TURNS: '4',
    },
  },
  resolve: {
    alias: {
      // All Firestore access hits the in-memory fake — no network/emulator.
      '@google-cloud/firestore': fileURLToPath(new URL('./test/mocks/firestore.ts', import.meta.url)),
    },
  },
});
