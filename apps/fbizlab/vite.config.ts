import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA (Firebase Hosting, no server). Talks to the API via VITE_API_BASE_URL.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
});
