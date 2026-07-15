---
name: agent-researcher-frontend
description: >-
  Build a frontend (web app or agent client) against the agent-researcher API.
  Use when creating any UI that logs users in, lists research models, renders
  their input forms from the model manifest, shows credit costs/balances, submits
  a research job, and polls it to download the report. Covers auth, the
  self-describing model manifest (paramsSchema + paramsUi + modes + i18n),
  credits, and the job lifecycle. Trigger on: "build a frontend/app for the
  research API", "render the model form", "consume /templates", "agent-researcher
  client".
---

# Building a frontend for the agent-researcher API

The API is **self-describing**: a model's manifest carries everything needed to
render its input form, all display texts, the report structure, and the per-tier
credit cost — so you never hardcode model knowledge in the client. Adding a param
to a model requires **zero** frontend changes.

## Base URLs & environments

| Env | API base URL |
|---|---|
| dev | `https://agent-researcher-dev-api-b74fjmzlha-uc.a.run.app` |
| prod | _(after prod deploy)_ |

Interactive OpenAPI docs live at **`<base>/docs`** — the single source of truth
for request/response shapes. Fetch `<base>/docs/json` for the raw OpenAPI spec.

## Auth (session JWT)

1. In the browser, obtain a **Google id_token** via Google Identity Services,
   using the app's OAuth **client id** (configured per app).
2. `POST /auth/session` with `{ "appId": "<slug>", "provider": "google", "idToken": "<id_token>" }`
   → `{ token, user: { email, name, role, appId }, expiresInSeconds }`.
3. Send `Authorization: Bearer <token>` on **every** other request. Identity
   (appId + userId) always comes from the token — never send it in the body.
4. On any `401`, the token is invalid/expired → send the user back to login.

Admin apps only admit whitelisted emails; regular apps admit any Google account.

## List models — the manifest

`GET /templates?lang=<en|es|fr|pt>` → `{ templates: Manifest[] }`. Returns only the
models the app is allowed to use. `GET /templates/:id?lang=…` returns one (403 if
the app isn't allowed to use it). `lang` defaults to `en`; texts without a
translation fall back to English. `manifest.lang` echoes the resolved language.

```jsonc
{
  "id": "florida-business-for-sale",
  "name": "…", "description": "…", "version": 1, "lang": "es",
  "sections": [{ "key": "shortlist", "title": "Lista de Negocios…" }],   // report structure
  "paramsSchema": { /* JSON Schema (2020-12): types, defaults, enum, minimum, maxLength, maxItems */ },
  "paramsUi": {
    "rows": [["industry","location"], ["askingPriceMin","askingPriceMax"]],  // side-by-side layout
    "fields": {
      "industry": { "help": "…", "placeholder": "…", "suggestions": ["Laundromats", …] },
      "language": { "help": "…", "optionLabels": { "en": "English", "es": "Español", … } }
    },
    "ranges":   [{ "label": "Asking price", "minKey": "askingPriceMin", "maxKey": "askingPriceMax",
                   "min": 0, "max": 5000000, "step": 25000, "prefix": "$" }],  // render one slider
    "advanced": ["keywords", "preferredSources", "instructions"],             // collapse these
    "hidden":   []
  },
  "modes": [ { "key": "essential", "label": "Esencial", "credits": 1 },        // report tiers + price
             { "key": "comprehensive", "label": "Completo", "credits": 2 } ],
  "reportSchema": { /* JSON Schema of the report envelope's `report` object */ }
}
```

### Generating the input form

Walk `paramsSchema.properties`; pick a control per property (an `enum` wins):

| JSON Schema | Control |
|---|---|
| `enum` | Select — label options via `paramsUi.fields[k].optionLabels[value]`, else the raw value |
| `type: boolean` | Switch |
| `type: integer`/`number` | Number input (respect `minimum`/`maximum`) |
| `type: array` (string items) | Tags input, free entry + `suggestions`, cap at `maxItems` / item `maxLength` |
| `type: string` with `suggestions` | Autocomplete (type **or** pick) |
| long `string` (e.g. `instructions`) | Textarea |
| `type: string` | Text input (respect `maxLength`) |

- **Seed** values from each property's `default`.
- **Layout**: render `paramsUi.rows` (fields side by side); a row that is exactly a
  `ranges[]` min/max pair renders as **one range slider** (dragging a thumb to an
  extreme = no bound → send that param as absent). Put `advanced` fields in a
  collapsed section; skip `hidden`.
- **Mode picker**: build from `manifest.modes` — show `label` + `credits` (e.g.
  "Completo · 2 credits"). Bind to the `mode` param.
- **Limits are the server's** — mirror `maxLength`/`maximum`/`maxItems` in inputs
  for UX, but the API re-validates against `paramsSchema` and rejects anything out
  of bounds (`400`), so the client can be lenient.

Reference implementation: `apps/admin/src/components/JsonSchemaForm.tsx` in the repo.

## Credits

- `GET /credits/balance` → `{ balance }` for the current user.
- `GET /credits/plans` → purchasable packs (Stripe). `POST /credits/checkout`
  `{ planId, successUrl, cancelUrl }` → `{ url }` (redirect to Stripe Checkout);
  credits are granted by the webhook on success.
- `GET /credits/transactions?type=` → the ledger (audit): purchases carry
  `paymentId`, grants carry `grantedBy`+`reason`.
- A report consumes `modes[chosen].credits`. Running with too few → `402`.

## Run & poll a job

1. `POST /research { template, params }` → `202 { jobId, status:"queued" }`.
   (`402` if not enough credits; `403` if the model isn't allowed; `400` on invalid
   params.)
2. `GET /research/:jobId` → `{ status, progress, cost, summary, error, … }`. Poll
   while `status` is `queued`/`running`/`incomplete` (~3s). `progress` (`phase`,
   `message`, `sourcesFound`, `turnsUsed`) drives a live view.
3. On `status:"completed"` the response adds `files[]` = `{ name, contentType,
   size, url, expiresAt }` with short-lived signed download URLs. `summary` has
   per-agent timing + any `warnings`/`degradedSections`.
4. `status:"failed"` → show `error`. (Admins can re-run via `POST
   /admin/jobs/:jobId/retry`.)

List a user's jobs (report inbox) with `GET /research`.

## Conventions

- All errors: `{ "error": "<message>" }` + a 4xx/5xx status. Global body limit 512 KB.
- Always attach the Bearer token; treat `401`→re-login, `402`→buy credits,
  `403`→not allowed, `404`→missing, `409`→conflict.
- CORS: the app origin must be in the API's allowed origins (dev allows all).
- i18n: pass `lang` to `/templates` to localize all manifest texts at once.

Deeper docs in the repo: `docs/model-ui.md` (form pattern), `docs/api-reference.md`
(every endpoint), `docs/credits.md`, `docs/auth.md`.
