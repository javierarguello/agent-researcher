# Authentication & authorization

The API is a **backend-for-frontend (BFF) authority**. Static web frontends never
hold a long-lived secret; instead each user proves their identity to an external
provider (Google) client-side, exchanges that proof for one of **our** session
JWTs, and sends that JWT on every request.

- **Source:** `packages/core/src/auth/tokens.ts` (signing/verification),
  `apps/api/src/auth.ts` (request hook), `apps/api/src/index.ts` (`/auth/session`).
- **Key property:** `appId` and `userId` (the user's email) always come from the
  **verified token**, never from the request body or query. There are no
  per-user API keys.

## The session JWT

Signed with **HS256** using `AUTH_JWT_SECRET`. Claims (`SessionClaims`):

| Claim | JWT field | Meaning |
|---|---|---|
| `email` | `sub` | Authenticated user email (lowercased). The `userId`. |
| `appId` | `appId` | The app the user logged into. |
| `role` | `role` | `'user'` or `'admin'`. |
| `name` | `name` (optional) | Display name from the provider. |

Also set: `iss` = `AUTH_JWT_ISSUER` (default `agent-researcher`), `iat`, and `exp`
= now + `AUTH_JWT_TTL_SECONDS` (default 604800 = 7 days). `verifySession` checks
the signature, issuer, and expiry, and normalizes any non-`admin` role to `user`.

## `POST /auth/session` — login / signup

```jsonc
// request
{
  "appId": "fbizlab",         // which app the user is logging into
  "provider": "google",       // 'google' (or 'password', reserved / 501 for now)
  "idToken": "<google id_token>"  // required for provider 'google'
}
```

Flow (`apps/api/src/index.ts`):

1. Load the app doc by `appId`. Unknown/inactive → `404`.
2. Dispatch on `provider`:
   - **`google`** — the app must have `googleClientId` (else `400`). Verify the
     `idToken` against that client id with `verifyGoogleIdToken` (uses
     `google-auth-library`, checks `aud` == client id, extracts a verified email).
     Failure → `401`.
   - Any other provider → `501` (not enabled yet).
3. **Authorization:** if the app's `role` is `admin`, the email must be in the
   app's `adminEmails[]` whitelist (case-insensitive) → session `role: admin`,
   else `403`. For a normal (`app`) app, any verified Google user gets
   `role: user`.
4. Sign a session JWT and return it.

```jsonc
// response
{
  "token": "<session JWT>",
  "user": { "email": "a@b.com", "name": "Ada", "role": "user", "appId": "fbizlab" },
  "expiresInSeconds": 604800
}
```

The frontend stores `token` and sends `Authorization: Bearer <token>` on every
subsequent call.

## Request authentication (the `jwtAuth` hook)

Runs as a Fastify `onRequest` hook on **every** route (registered after Swagger so
`/docs` stays public):

1. **Public paths** (returned without a token): `/health`, `/docs`, `/auth/*`,
   `/credits/webhook` (Stripe-signed instead), and `/`. Matched by exact path or
   `<prefix>/…`.
2. **`APP_ENV=local`** — auth is bypassed. Identity is read from dev headers:
   `x-app-id` (default `fbizlab`), `x-user-id` (default `local@dev`), `x-role`
   (`admin` if literally `admin`, else `user`). The app record is still loaded.
3. **Otherwise** — require a `Bearer` token, `verifySession` it (invalid/expired →
   `401`), load the app doc for `claims.appId` (missing/inactive → `401`), and
   attach `req.auth` (claims) + `req.appRecord` (the app doc) to the request.

`requireAdmin` is a per-route `preHandler` guarding `/admin/*`: it passes in local
mode, otherwise requires `req.auth.role === 'admin'` (else `403`).

### How identity is used downstream

Handlers read `req.auth.appId` and `req.auth.email` for the caller's identity.
An **admin** token may additionally target other users/apps via query params
(`?appId=…&userId=…` on `/research`, `/credits/*`); a regular user's params are
ignored and their own token identity is used. `/research/:jobId` lets an admin
read any job; a regular user only their own (`job.appId === appId &&
job.userId === email`).

## The app document (`apps/{appId}`)

Source of truth for who may log in. Fields (`AppRecord`,
`packages/core/src/apps/types.ts`):

| Field | Type | Purpose |
|---|---|---|
| `appId` | string | Doc id. |
| `name` | string | Human name. |
| `apiKey` | string | Legacy secret (still generated; **not** used by the session-JWT flow). |
| `active` | boolean | Inactive apps can't log in or be used. |
| `role` | `'admin' \| 'app'` | `admin` app = backoffice (whitelist login, admin tokens); `app` = normal client. |
| `rateLimitPerHour` | number? | Optional per-app reports/hour cap (overrides the settings default). |
| `googleClientId` | string? | The frontend's Google OAuth client id; validates the `id_token` `aud`. |
| `adminEmails` | string[]? | Admin app only: emails allowed to log in (→ admin tokens). |
| `allowedTemplates` | string[]? | If set, the **only** research models (template ids) this app may submit. Admin apps are exempt. Omit/empty ⇒ any model. |
| `createdAt` / `updatedAt` | string | ISO timestamps. |

### Well-known apps use a slug doc id (never a UUID)

`createApp` defaults `appId` to a random UUID, but **well-known apps pin a
human slug as their doc id** — `admin`, `fbizlab`, … — so code, config, and
Firestore reads reference a stable, readable key instead of `98ce1627-…`. Always
pass `--appId <slug>` when creating one; `reset-dev` seeds them this way. To
re-key an existing app, create the new slug doc and `delete` the old one:

```bash
npm run apps -- create --name "Backoffice Admin" --role admin --appId admin
npm run apps -- delete --appId 98ce1627-4ea5-4d69-9f63-28d85e2a2b40   # old UUID doc
```

### Restricting an app to specific models (`allowedTemplates`)

A non-admin app is confined to a fixed set of research models; a request for any
other model is rejected `403` **before** rate-limit or credit checks (enforced in
`POST /research`, `apps/api/src/index.ts`). Admin apps bypass the check entirely.

```bash
# fbizlab may ONLY run the Florida business-for-sale model
npm run apps -- update --appId fbizlab --allowed-templates florida-business-for-sale
npm run apps -- create --name "Multi" --appId multi --allowed-templates "model-a,model-b"
```

Manage apps with the CLI (`npm run apps -- …`) or the admin endpoints. Set the
Google client id and admin whitelist with, e.g.:

```bash
npm run apps -- update --appId fbizlab --google-client-id 123.apps.googleusercontent.com
npm run apps -- update --appId <adminAppId> --admin-emails "you@co.com,ops@co.com"
```

## Roles

| Role | Who | Can do |
|---|---|---|
| `user` | Any Google user of a normal app | Own research + credits (their `appId`/email only). |
| `admin` | Whitelisted emails of the admin app | Everything a user can, plus `/admin/*` (grant credits, manage apps, settings) and reading/targeting any app/user. |

## Adding an identity provider (e.g. password)

The design already anticipates this — the verified-identity shape is
provider-agnostic (`Identity { provider, email, name?, emailVerified, sub? }`).

1. Implement a verifier in `auth/tokens.ts` returning an `Identity`, e.g.
   `verifyPassword(email, password): Promise<Identity>` with `provider: 'password'`.
2. Add a branch in `/auth/session`'s dispatch (`if (b.provider === 'password') …`).
   `'password'` is already in the request enum and the `IdentityProvider` type; it
   currently returns `501`.
3. The rest is unchanged — you still `signSession({ email, appId, role, name })`
   and the same whitelist/role logic applies.

No template, engine, or downstream change is needed: everything past login only
sees the session claims.

## Notes & gotchas

- **`AUTH_JWT_SECRET` must be set** in any non-local deploy; `signSession` /
  `verifySession` throw if it's missing.
- Tokens are **stateless** — there's no server-side session store or revocation
  list. Rotating `AUTH_JWT_SECRET` invalidates all outstanding tokens.
- The `apiKey` field on apps is legacy; the live auth path is the session JWT.
- CORS is enabled for the static frontends (`CORS_ORIGINS`, `*` in dev).
