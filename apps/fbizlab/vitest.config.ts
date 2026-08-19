import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The buyer-facing app's suite.
 *
 * `tsc` and `vite build` only say it compiles. What this covers is the part that
 * can be wrong while compiling perfectly: whether the form the customer fills in
 * actually renders what the API told it to, and whether it sends back what the API
 * expects. Everything below the network is mocked — the hooks are the seam.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    /**
     * The build-time config the app reads, fixed for the suite.
     *
     * Vite loads `.env.local` when it is there, and that file is gitignored — so
     * five `rate-limit-copy` tests passed on the machine that had one and failed
     * on every machine that did not, CI included. CI had been red for that reason
     * alone, which means `verify` gated nothing and the deploy jobs that depend on
     * it never ran. A suite that only passes with an untracked file is not a suite.
     *
     * Values are obvious fakes: nothing here reaches a network (the hooks are
     * mocked), and a real id in a committed file would be a credential in git.
     */
    env: {
      VITE_API_BASE_URL: 'http://api.test',
      VITE_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      VITE_APP_ID: 'fbizlab',
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
