# Module reference

A map of every module in `packages/core/src` (the shared library) plus the two
apps, with its purpose and key exports. Public exports are re-exported from
`packages/core/src/index.ts` as `@agent-researcher/core`.

## Top-level core

| Module | Purpose | Key exports |
|---|---|---|
| `config.ts` | Central runtime config read once from env; safe defaults so import never throws. | `config`, `Config` |
| `cost.ts` | Cost accounting type + arithmetic. Exact LLM cost (tokens × price) + estimated search cost. | `Cost`, `emptyCost`, `addCost`, `llmCost`, `searchCost` |
| `mode.ts` | The public `mode` knob → internal `ModeConfig` (budget/exclude/depth/credits/params). | `ReportMode`, `REPORT_MODES`, `modeParamSchema`, `ModeConfig`, `DEFAULT_MODES`, `resolveMode`, `creditsForMode`, `isReportMode` |
| `depth.ts` | Framework-level prose-depth knob (light/standard/deep): directive + budget multiplier. | `Depth`, `DepthProfile`, `DEPTH_PROFILES`, `depthParamSchema`, `resolveDepthProfile` |
| `index.ts` | Public API surface + `validateRequest(body)` (validates `{ template, params }`). | `validateRequest`, `ValidatedRequest`, all re-exports |

## `engine/` — the workflow executor

| Module | Purpose | Key exports |
|---|---|---|
| `research-engine.ts` | Generic executor: resolve mode → effective template, topo-sort agents into waves, run each wave (bounded concurrency), merge validated slices, fill derived sections, validate, emit trace. Failure isolation + degraded sections. | `runResearch`, `planWaves`, `ResearchOutput`, `ReportMeta`, `JobTrace`, `AgentTrace`, `ResearchProgress` |
| `gather.ts` | The budgeted producer research loop (`update_plan`/`web_search`/`fetch_page`) over a shared, deduped `Evidence` store. | `gather`, `createEvidence`, `Evidence`, `RESEARCH_TOOLS` |
| `synthesize.ts` | Structured JSON synthesis: Zod → JSON Schema → model → parse + validate, with one repair round. | `synthesizeStructured` |
| `prompt.ts` | Prompt composition: system prompt (base + fenced client instructions), producer/enricher/synthesizer prompts, evidence dossier, language directive. | `buildSystemPrompt`, `buildAgentKickoff`, `buildProducerSynthPrompt`, `buildEnricherSynthPrompt`, `buildSynthesizerPrompt`, `Language`, `LANGUAGES`, `isLanguage` |
| `run-job.ts` | End-to-end job execution called by the worker: run engine, upload GCS outputs, sync Firestore, headline, refund-on-failure, stats, structured logging. | `runJob`, `RunJobInput`, `RunJobResult` |

## `templates/` — research models

| Module | Purpose | Key exports |
|---|---|---|
| `types.ts` | The `ResearchTemplate` / `ReportSection` / `AgentSpec` shapes + schema helpers. | `ResearchTemplate`, `ReportSection`, `AgentSpec`, `AgentRole`, `TemplateManifest`, `reportSchemaOf`, `sectionSubsetSchema`, `sectionByKey` |
| `florida-business-for-sale.ts` | The one concrete research model (params, 17 sections, 13 agents, modes). | `floridaBusinessForSale`, `FloridaBusinessParams` |
| `registry.ts` | The `TEMPLATES` map + lookup + client-safe manifest. Asserts all templates valid at load. | `getTemplate`, `listTemplates`, `toManifest`, `TEMPLATES` |
| `validate.ts` | Template well-formedness checks (unique keys, single producer, valid refs/aliases, acyclic DAG, valid `exclude`). | `validateTemplate`, `assertTemplatesValid` |

## `llm/` — model registry & providers

| Module | Purpose | Key exports |
|---|---|---|
| `provider.ts` | Provider-agnostic `LlmProvider` interface + message/tool/generate types. | `LlmProvider`, `GenerateOptions`, `GenerateResult`, `LlmMessage`, `ToolSchema`, `ToolCall`, `TokenUsage`, `JsonSchema` |
| `models.ts` | Alias → concrete `{ provider, model, price }` resolver; memoized provider instances. | `resolveModel`, `getProviderFor`, `modelAliases`, `ResolvedModel` |
| `gemini-vertex.ts` | Gemini via Vertex AI (`@google/genai`, ADC): tool-calling, structured output (JSON-Schema→Gemini normalization), retry w/ backoff, token usage. | `GeminiVertexProvider`, `jsonSchemaToGemini` |
| `index.ts` | LLM entry point; default provider helper. | `getProvider`, plus re-exports of the above |

## `credits/` — billing

| Module | Purpose | Key exports |
|---|---|---|
| `types.ts` | Ledger/balance types + `InsufficientCreditsError`. | `CreditLedgerEntry`, `CreditBalance`, `LedgerEntryType`, `InsufficientCreditsError` |
| `store.ts` | Transactional, idempotent Firestore credits store (balance + append-only ledger). | `getBalance`, `listTransactions`, `grantCredits`, `recordPurchase`, `consumeCredits`, `refundForJob` |

## `stats/` — analytics

| Module | Purpose | Key exports |
|---|---|---|
| `store.ts` | Per-app write-only analytics (app-stats + daily buckets + app-users) via `FieldValue.increment`; TTL on daily. | `recordReportStats`, `recordPurchaseStats`, `getAppStats`, `getDailyStats`, `ReportStatsInput`, `PurchaseStatsInput` |

## `auth/` — session tokens

| Module | Purpose | Key exports |
|---|---|---|
| `tokens.ts` | Sign/verify HS256 session JWTs; verify Google id_tokens; provider-agnostic `Identity`. | `signSession`, `verifySession`, `verifyGoogleIdToken`, `SessionClaims`, `SessionRole`, `Identity`, `IdentityProvider` |

## `jobs/` — job store

| Module | Purpose | Key exports |
|---|---|---|
| `types.ts` | `ResearchJob` doc shape + status/progress/summary/file types. | `ResearchJob`, `JobStatus`, `JobFile`, `JobProgress`, `JobSummary` |
| `firestore.ts` | One doc per job; create/get/list + status/progress/cost/summary/headline setters. | `createJob`, `getJob`, `listJobs`, `markRunning`, `markCompleted`, `markFailed`, `setProgress`, `setJobCost`, `setJobSummary`, `setJobHeadline`, `setJobStatus` |
| `headline.ts` | Cheap (flash) auto title + one-line description for a job. | `generateHeadline`, `Headline` |

## `apps/` — app registry & rate limiting

| Module | Purpose | Key exports |
|---|---|---|
| `types.ts` | `AppRecord` (appId, apiKey, role, googleClientId, adminEmails, …) + client-safe view. | `AppRecord`, `AppPublic`, `AppRole`, `toPublicApp` |
| `store.ts` | Firestore app CRUD + atomic multi-dimension hourly rate limiting. | `createApp`, `getApp`, `getAppByApiKey`, `listApps`, `updateApp`, `generateApiKey`, `checkRateLimits`, `RateLimitEntry`, `RateLimitResult`, `RateLimitViolation`, `CreateAppInput`, `UpdateAppInput` |

## `settings/` — general settings

| Module | Purpose | Key exports |
|---|---|---|
| `store.ts` | `settings/general` doc: default per-app / per-user reports/hour caps (null = unlimited). | `getSettings`, `updateSettings`, `ensureDefaultSettings`, `DEFAULT_SETTINGS`, `GeneralSettings`, `UpdateSettingsInput` |

## `storage/` — Cloud Storage

| Module | Purpose | Key exports |
|---|---|---|
| `gcs.ts` | Upload job objects under `researchs/{jobId}/`; list; mint V4 signed read URLs (IAM signBlob on Cloud Run). | `uploadObject`, `listJobFiles`, `signRead`, `signJobFiles`, `SignedFile` |

## `tools/` — web search

| Module | Purpose | Key exports |
|---|---|---|
| `web-search.ts` | Provider-agnostic search (Brave > Tavily > DuckDuckGo) + Tavily page extraction (capped 6000 chars). Plain `fetch`. | `searchWeb`, `extractPages`, `SearchResult`, `ExtractedPage` |

## `obs/` — observability

| Module | Purpose | Key exports |
|---|---|---|
| `log.ts` | Structured Cloud Logging: one JSON line per event, bound to jobId/appId/userId (+ indexed labels). | `logEvent`, `jobLogger`, `LogContext`, `JobLogger`, `Severity` |

## `cli/` — operator scripts (run via npm scripts)

| Module | npm script | Purpose |
|---|---|---|
| `run-local.ts` | `research:local` | Run the engine locally (no GCP writes); writes `out/<jobId>/report.json`. Requires ADC for Vertex. |
| `apps.ts` | `apps` | App registry admin: `seed-admin`, `create`, `list`, `update`, `get`, `settings`. |
| `reset-dev.ts` | `reset:dev` | DEV-ONLY: wipe all Firestore test data + reseed admin + `fbizlab`. Refuses unless `ENV=dev` + `--confirm`. |
| `validate-templates.ts` | `templates:check` | Validate every template + print sections/agents/waves. Non-zero exit on any error. |

## Apps

| Module | Purpose |
|---|---|
| `apps/api/src/index.ts` | Fastify API: all endpoints (auth, templates, research, credits, admin), Swagger, CORS, raw-body for Stripe. |
| `apps/api/src/auth.ts` | `jwtAuth` onRequest hook (public paths, local bypass, JWT verify) + `requireAdmin`. |
| `apps/api/src/stripe.ts` | Stripe client + plan resolution from Prices (`lookup_key`/metadata). |
| `apps/api/src/enqueue.ts` | Enqueue a job onto the Cloud Tasks queue (OIDC token, dedup by jobId). |
| `apps/worker/src/index.ts` | Fastify worker: `POST /run` → `runJob`; idempotent, acks finished jobs. |
