import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // APP_ENV=production so auth + the credits gate are ACTIVE (security tests).
    env: {
      ENV: 'dev',
      APP_ENV: 'production',
      GCP_PROJECT_ID: 'test-project',
      AUTH_JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      POSTMARK_SERVER_TOKEN: 'test-postmark-token',
      MODERATION_LLM: 'false',
      VALIDATION_LLM: 'false',
      PREFLIGHT_BLOCK_LIMIT: '3',
      LOG_LEVEL: 'silent',
    },
  },
  resolve: {
    alias: {
      '@google-cloud/firestore': fileURLToPath(new URL('../../packages/core/test/mocks/firestore.ts', import.meta.url)),
    },
  },
});
