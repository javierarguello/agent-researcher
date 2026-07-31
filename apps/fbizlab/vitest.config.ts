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
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
