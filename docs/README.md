# agent-researcher — documentation

Deep-research API on GCP. A client submits a request against a **research model**
(a template); a **workflow of specialized agents** performs web-search research in
parallel and produces a single **typed JSON report** (`report.json`) stored in
Cloud Storage, with the job tracked in Firestore. Auth is a **user session JWT**
(BFF model), billing is **credits** (backed by Stripe), and per-app usage is
tracked as **analytics** in Firestore.

## The 30-second mental model

- **A request** = `{ template, params }`. Who you are (`appId` + `userId`) comes
  from your **session token**, never the body.
- **The API** validates, consumes credits, records the job in Firestore, and
  enqueues a **Cloud Task**. It returns in milliseconds and scales to zero.
- **The worker** (a private Cloud Run service) runs one job: it executes the
  template's **agent DAG** wave by wave, sharing one evidence store, and writes
  `report.json` (`{ meta, report }`) + `sources.json` + `metadata.json` +
  `trace.json` to GCS.
- **`mode`** (`essential` | `comprehensive`) is the only public cost knob. It
  maps to internal budget scale, excluded sections, prose depth, and credit cost.
- **Add a research model** = one template file (typed sections + an agent DAG +
  a version). It self-validates on registration. Nothing else changes.
- **Add an LLM model** = one alias in the model registry (plus a provider class
  if it's a new provider like Claude). Existing agents are untouched.

## Read in this order

### Concepts & system
1. [architecture.md](architecture.md) — the whole system: API → queue → worker →
   GCS/Firestore, the workflow executor, scaling, observability, cost, environments.
2. [flows.md](flows.md) — end-to-end sequence walkthroughs (login, generate a
   report, buy credits, refund on failure).
3. [research-models.md](research-models.md) — what a "research model" is: typed
   sections, the incremental report schema, modes, versioning, non-breaking rules.
4. [agents.md](agents.md) — the agent model: roles, `AgentSpec`, dependencies,
   waves, concurrency, per-agent model selection.
5. [models/florida-business-for-sale.md](models/florida-business-for-sale.md) —
   the one concrete research model: every section, agent, wave, mode, and an
   example `report.json`.

### Platform features
6. [auth.md](auth.md) — the JWT/BFF auth model: `/auth/session`, roles, app-doc
   fields, local bypass, adding providers.
7. [credits.md](credits.md) — the credits ledger/balances, consumption + refund,
   mode weighting, Stripe plans, checkout + webhook, idempotency.
8. [stats.md](stats.md) — the per-app analytics schema and how it is written/read.

### Reference
9.  [api-reference.md](api-reference.md) — every endpoint: method, path, auth,
    request, response, errors (grouped by tag).
10. [modules.md](modules.md) — a reference of every core module + its key exports.
11. [extending.md](extending.md) — add a section / agent / research model / LLM
    provider / auth provider **without breaking** anything.
12. [deployment.md](deployment.md) — infra scripts, CI, every env var, Firestore
    indexes + TTL, the `fbizlab` / admin apps, admin SPA Hosting.
13. [model-ui.md](model-ui.md) — how a client (the admin, or a model-specific web
    app) renders a model's params from its manifest (`paramsSchema` + `paramsUi`).
