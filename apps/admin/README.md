# @agent-researcher/admin

Static admin backoffice SPA (Vite + React + TypeScript + Mantine). No server —
it talks to the API directly and is hosted on Firebase Hosting. Auth is Google
Sign-In → `POST /auth/session` (admin app whitelist) → session JWT.

## Develop

```bash
cp .env.example .env.local   # set VITE_API_BASE_URL + VITE_ADMIN_GOOGLE_CLIENT_ID
npm run dev -w @agent-researcher/admin
```

The dev origin (e.g. `http://localhost:5173`) must be in the API's `CORS_ORIGINS`,
and the admin app doc must have `googleClientId` set (matching
`VITE_ADMIN_GOOGLE_CLIENT_ID`) and the login email in its `adminEmails` whitelist.

## Build

```bash
npm run build -w @agent-researcher/admin   # → apps/admin/dist (static)
```

## Structure

- `src/api/` — central fetch client (Bearer + 401 handling) + response types.
- `src/auth/` — Google Identity Services wrapper + `AuthProvider`/`useAuth`.
- `src/components/` — `RequireAuth` route guard, `Layout` (Mantine AppShell).
- `src/pages/` — Dashboard (live `/admin/stats`), Jobs (list + live-polling
  detail), Users (search + credit audit + grant), Apps (CRUD).
- `src/components/NewJobModal.tsx` + `JsonSchemaForm.tsx` — the "new job" dialog:
  a params form generated from the model's manifest (`paramsSchema` + `paramsUi`).
  See [../../docs/model-ui.md](../../docs/model-ui.md) — the pattern to reuse when
  building a model-specific web app.

Config is build-time via `VITE_*` env vars (see `.env.example`). Live URLs +
resource names are in the root [README](../../README.md#environments).
