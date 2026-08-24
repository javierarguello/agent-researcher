# FloridaBizLab (`@agent-researcher/fbizlab`)

Public SPA for **FloridaBizLab** — AI-powered market discovery and investment
intelligence for Florida. Consumer front end for the shared research API: public
landing, Google sign-in, launch/track reports, view generated dossiers, and buy
credits via Stripe.

- **Stack:** Vite + React + TypeScript, plain-CSS design system (no component lib),
  `@tanstack/react-query`, `react-router-dom`, `react-markdown`, `recharts`.
- **Design system:** see [`DESIGN.md`](./DESIGN.md) — tokens, voice, components, motion,
  the 4-language requirement (en/es/fr/pt), and SEO.
- **Manifest-driven:** all forms, modes, add-ons, steps, and report sections come
  from `GET /templates?lang=` — nothing about a specific model is hardcoded here.
- **One exception, deliberately:** the public sample dossier at **`/sample`** —
  linked from the hero and from "Inside a summary" — is anonymous, so it cannot call
  `/templates` (authenticated). It reads a single static file,
  `public/sample-dossier.json`, generated from a REAL paid run by
  `npm run sample:build` (repo root) and committed.
- **It is a PREVIEW, cut in the file.** Every section carries its opening and the
  first entries of each list; the executive summary keeps all its metric badges and
  the snapshot states the whole run's figures (7 targets, $10.1M), not the three
  listings that survived. The cut is in the artifact because the artifact is public:
  a fade drawn in CSS over full text protects nothing a `curl` cannot read. 196 kB →
  42 kB. Nothing is rewritten — every published string is a strict PREFIX of the
  stored one, asserted field by field in `test/sample-dossier.test.ts`. Regenerate it after changing the
  sample or a section title; `test/sample-dossier.test.ts` and
  `packages/core/test/sample-dossier-titles.test.ts` fail while it is stale. The file
  is fetched only when that route is opened — the landing does not carry its 196 kB.
- **Pricing is never hardcoded:** plans come straight from Stripe via the API.
  The public landing calls `GET /plans?appId=fbizlab` (no auth, cached 30 min);
  the in-app Credits page calls `GET /credits/plans`. To change prices, edit the
  Stripe catalog (Price/Product metadata `appId`, `planId`, `credits`, and optional
  marketing metadata `sub`, `popular`, `features`).

## Develop

```bash
npm run dev   -w @agent-researcher/fbizlab   # vite dev server
npm run build -w @agent-researcher/fbizlab   # typecheck + production build
```

Build-time config (`.env` locally, repo variables in CI — all public, no secrets):

| `VITE_*` build var | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | Cloud Run API base URL |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth **client id for this app** (separate from admin) |
| `VITE_APP_ID` | `fbizlab` (default) |

The Google client id must also be stored on the app's Firestore doc
(`apps/fbizlab.googleClientId`) so the API accepts its id tokens.

### Dev vs prod — every key/id/URL differs

There is **no shared value across environments**. CI variables are namespaced per
env; the dev workflow reads `FBIZLAB_DEV_*`, the prod workflow reads `FBIZLAB_PROD_*`:

| Build var | Dev repo variable | Prod repo variable |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `FBIZLAB_DEV_API_BASE_URL` | `FBIZLAB_PROD_API_BASE_URL` |
| `VITE_GOOGLE_CLIENT_ID` | `FBIZLAB_DEV_GOOGLE_CLIENT_ID` | `FBIZLAB_PROD_GOOGLE_CLIENT_ID` |
| deploy SA key (secret) | `GCP_SA_KEY_DEV` | `GCP_SA_KEY_PROD` |

Also per-env, but **not** front-end config (they live on the API / Firestore, each
env has its own): the Stripe secret key and its whole product catalog (test-mode vs
live-mode), the OAuth client, the Firestore database, and the Cloud Run API. The
`appId` (`fbizlab`) is the one constant — it just resolves to different resources
in each env.

## Deploy

Firebase Hosting, per-env sites.

- **Dev** — `.github/workflows/deploy-fbizlab.yml` deploys `fbizlab-dev` on push to
  `main` touching `apps/fbizlab/**`. Site `agent-researcher-dev-fbizlab` →
  https://agent-researcher-dev-fbizlab.web.app
- **Prod** — `.github/workflows/deploy-fbizlab-prod.yml`, manual trigger
  (`workflow_dispatch`). Site `agent-researcher-prod-fbizlab`.

One-time site + config (dev shown; prod mirrors with `FBIZLAB_PROD_*` and the
`agent-researcher-prod-fbizlab` site):

```bash
firebase hosting:sites:create agent-researcher-dev-fbizlab --project sinuous-canto-497518-h7
gh variable set FBIZLAB_DEV_API_BASE_URL     --body "https://<cloud-run-api-url>"
gh variable set FBIZLAB_DEV_GOOGLE_CLIENT_ID --body "<oauth-client-id>.apps.googleusercontent.com"
```
