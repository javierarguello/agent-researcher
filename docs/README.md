# agent-researcher — documentation

Deep-research API on GCP. A client submits a request against a **research model**
(a template); a **workflow of specialized agents** performs web-search research
in parallel and produces a single **typed JSON report** (`report.json`) stored in
Cloud Storage, with the job tracked in Firestore.

## Read in this order

1. [architecture.md](architecture.md) — how the whole system fits together:
   the agent workflow executor, the shared evidence store, the model registry,
   structured output, and the API → worker → GCS/Firestore flow.
2. [research-models.md](research-models.md) — what a "research model" is: typed
   sections, the incremental report schema, versioning, and the non-breaking
   evolution rules.
3. [agents.md](agents.md) — the agent model: roles, `AgentSpec`, dependencies,
   waves, concurrency, and per-agent model selection.
4. [models/florida-business-for-sale.md](models/florida-business-for-sale.md) —
   the concrete research model: every section, every agent, the DAG, and an
   example `report.json`.
5. [api.md](api.md) — using the HTTP API: auth, endpoints, polling, the report
   shape, and rate limits.
6. [extending.md](extending.md) — how to add a section, an agent, a research
   model, or an LLM model/provider **without breaking** anything that exists.

## The 30-second mental model

- **Add a research model** = one new template file (typed sections + an agent
  workflow + a version). It self-validates on registration.
- **Add an LLM model** = one alias in the model registry (plus a provider
  implementation if it's a new provider like Claude).
- Neither touches existing templates, agents, or the engine.
