import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The admin app's suite — it had none.
 *
 * That gap is why `summary.sections` could be written by the engine, served by the
 * API, typed in `api/types.ts` and rendered by nothing: the one page that exists
 * to decide about a job had no test that could notice.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
