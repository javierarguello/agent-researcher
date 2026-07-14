import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA (Firebase Hosting, no server). Talks to the API directly via
// VITE_API_BASE_URL. In dev, requests can hit the deployed API (CORS must allow
// the dev origin) or be proxied — see README.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
});
