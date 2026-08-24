import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA (Firebase Hosting, no server). Talks to the API via VITE_API_BASE_URL.
export default defineConfig(({ command }) => {
  // A bundle with no Turnstile site key renders no widget and sends no token, and
  // the API enforces the check whenever its SECRET is set — so that bundle is a site
  // where register, sign-in, password reset and contact all refuse, with nothing in
  // the build saying why. Louder here than in each workflow: this covers a hand-run
  // `npm run build` too, and there is one place to read the rule.
  //
  // Local `npm run dev` is unaffected: it is only the produced artifact that must
  // not be shipped half-configured. Copy `.env.example` to build locally.
  if (command === 'build' && !process.env.VITE_TURNSTILE_SITE_KEY) {
    throw new Error(
      'VITE_TURNSTILE_SITE_KEY is empty. The SPA would ship with no captcha widget while the API ' +
        'enforces one, so nobody could sign in. In CI set the repo variable ' +
        '(FBIZLAB_DEV_TURNSTILE_SITE_KEY / FBIZLAB_PROD_TURNSTILE_SITE_KEY); locally copy apps/fbizlab/.env.example.',
    );
  }
  return {
    plugins: [react()],
    build: { outDir: 'dist', sourcemap: true },
  };
});
