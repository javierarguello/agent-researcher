/**
 * Central runtime configuration, read once from the environment.
 *
 * The same object is shared by the API service and the worker job; every value
 * has a sensible default so `import { config }` never throws at module load.
 */

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Deployment environment. Names every stateful resource (dev vs prod). */
const ENV = str('ENV', 'dev');

export const config = {
  /** "dev" | "prod" — isolates all resources between environments. */
  env: ENV,
  gcp: {
    projectId: str('GCP_PROJECT_ID', 'sinuous-canto-497518-h7'),
    location: str('GCP_LOCATION', 'us-central1'),
    /** Named Firestore database, one per environment. */
    databaseId: str('FIRESTORE_DATABASE', `agent-researcher-${ENV}`),
  },
  storage: {
    bucket: str('RESEARCH_BUCKET', `agent-researcher-${ENV}-reports`),
    /** Root prefix inside the bucket for all jobs: researchs/{jobId}/**. */
    rootPrefix: 'researchs',
    signedUrlTtlMinutes: int('SIGNED_URL_TTL_MINUTES', 60),
  },
  jobs: {
    collection: str('JOBS_COLLECTION', 'jobs'),
  },
  apps: {
    collection: str('APPS_COLLECTION', 'apps'),
  },
  rateLimits: {
    collection: str('RATE_LIMITS_COLLECTION', 'rate-limits'),
  },
  settings: {
    collection: str('SETTINGS_COLLECTION', 'settings'),
    /** Doc id holding the general/default settings. */
    generalDoc: 'general',
  },
  credits: {
    ledgerCollection: str('CREDITS_LEDGER_COLLECTION', 'credit-ledger'),
    balancesCollection: str('CREDITS_BALANCES_COLLECTION', 'credit-balances'),
    // Per-model credit pricing overrides (doc id = templateId). Code holds the
    // defaults; a doc here overrides them without a deploy. Purchasable packs
    // still live entirely in Stripe.
    pricingCollection: str('MODEL_PRICING_COLLECTION', 'model-pricing'),
  },
  stats: {
    /** All-time per-app aggregates; daily buckets in a `daily` subcollection. */
    appStatsCollection: str('APP_STATS_COLLECTION', 'app-stats'),
    dailySubcollection: 'daily',
    /** Per-(app,user) records (distinct-user counting + per-user detail). */
    appUsersCollection: str('APP_USERS_COLLECTION', 'app-users'),
    /** Daily buckets auto-expire after N days (Firestore TTL on `expireAt`). */
    retentionDays: int('STATS_RETENTION_DAYS', 60),
  },
  stripe: {
    secretKey: str('STRIPE_SECRET_KEY'),
    webhookSecret: str('STRIPE_WEBHOOK_SECRET'),
  },
  auth: {
    /** HS256 secret the API signs/verifies its own session JWTs with. */
    jwtSecret: str('AUTH_JWT_SECRET'),
    jwtIssuer: str('AUTH_JWT_ISSUER', 'agent-researcher'),
    /** Session token lifetime (default 7 days). */
    jwtTtlSeconds: int('AUTH_JWT_TTL_SECONDS', 604800),
    /** Password-based user credentials (email verification, reset). */
    credentialsCollection: str('CREDENTIALS_COLLECTION', 'user-credentials'),
    /** Email-verification link lifetime (default 24h). */
    verifyTtlSeconds: int('AUTH_VERIFY_TTL_SECONDS', 86400),
    /** Password-reset link lifetime (default 1h). */
    resetTtlSeconds: int('AUTH_RESET_TTL_SECONDS', 3600),
  },
  email: {
    /** Shared Postmark server token — every app sends through the same account. */
    postmarkToken: str('POSTMARK_SERVER_TOKEN'),
    /** Postmark message stream (transactional). */
    messageStream: str('POSTMARK_MESSAGE_STREAM', 'outbound'),
    /** Internal inbox that contact-form / API-access requests are delivered to.
     *  Never exposed to the frontend. Shared across all apps. */
    contactInbox: str('CONTACT_INBOX', 'management@specialtyperks.com'),
  },
  moderation: {
    /** Run the LLM classifier on research params (in addition to the free
     *  deterministic pre-screen). Disable in tests to avoid live LLM calls. */
    llm: str('MODERATION_LLM', 'true') !== 'false',
  },
  cors: {
    /** Comma-separated allowed origins for the static web frontends; "*" for dev. */
    origins: str('CORS_ORIGINS', '*'),
  },
  llm: {
    /** Default provider (used by legacy helpers / as a fallback). */
    provider: str('LLM_PROVIDER', 'gemini-vertex'),
    /**
     * Named model registry. Agents reference these ALIASES, never a concrete
     * model id — so swapping the model (or provider) behind an alias never
     * touches a template or agent. Add a new provider here + one alias to make
     * it available; existing aliases are unaffected. Keys are stable aliases.
     */
    models: {
      /** Cheap tier for the tool-calling research loop (planning + search). */
      gather: { provider: 'gemini-vertex', model: str('LLM_MODEL_FLASH', 'gemini-2.5-flash'), inPerM: 0.3, outPerM: 2.5 },
      /** Same as gather; a distinct alias so intent reads clearly at call sites. */
      flash: { provider: 'gemini-vertex', model: str('LLM_MODEL_FLASH', 'gemini-2.5-flash'), inPerM: 0.3, outPerM: 2.5 },
      /** Strong tier for structured section synthesis. */
      pro: { provider: 'gemini-vertex', model: str('LLM_MODEL_PRO', 'gemini-2.5-pro'), inPerM: 1.25, outPerM: 10 },
      // Later (no breaking change): add Claude and reference it per-agent.
      // 'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-5', inPerM: 3, outPerM: 15 },
    } as Record<string, { provider: string; model: string; inPerM: number; outPerM: number }>,
    /** Default alias for an agent's tool-calling / gathering loop. */
    defaultGatherModel: str('LLM_DEFAULT_GATHER', 'gather'),
    /** Default alias for an agent's structured synthesis. */
    defaultSynthModel: str('LLM_DEFAULT_SYNTH', 'pro'),
    /** Upper bound for structured JSON output (avoids mid-JSON truncation).
     *  Long-form sections (deep dives, financials) need generous headroom. */
    maxOutputTokens: int('LLM_MAX_OUTPUT_TOKENS', 32768),
    /** Max agents synthesizing/gathering concurrently (Vertex quota guard). */
    maxConcurrentAgents: int('LLM_MAX_CONCURRENT_AGENTS', 2),
  },
  workflow: {
    /** In-run retries per agent (each retries the whole gather+synthesis). */
    agentMaxAttempts: int('AGENT_MAX_ATTEMPTS', 3),
    /** Backoff between agent retries (exponential from base, capped, + jitter). */
    agentRetryBaseMs: int('AGENT_RETRY_BASE_MS', 2000),
    agentRetryMaxMs: int('AGENT_RETRY_MAX_MS', 30000),
    /** Job re-dispatches (Cloud Tasks) before finalizing with degraded sections. */
    maxJobAttempts: int('MAX_JOB_ATTEMPTS', 8),
  },
  search: {
    braveApiKey: str('BRAVE_API_KEY'),
    tavilyApiKey: str('TAVILY_API_KEY'),
    maxTurns: int('RESEARCH_MAX_TURNS', 16),
    /** Estimated USD per web_search/fetch_page call (Tavily: ~2 credits × $0.008).
     *  Only applied when a Tavily key is set; Brave/DDG are treated as free. */
    costPerCallUsd: Number(process.env.SEARCH_COST_PER_CALL_USD ?? '0.016'),
  },
  worker: {
    /** Worker Cloud Run Service name (processes one job per request). */
    serviceName: str('WORKER_SERVICE_NAME', `agent-researcher-${ENV}-worker`),
    region: str('WORKER_REGION', 'us-central1'),
    /** Full https URL of the worker service (set by deploy after the worker deploys). */
    serviceUrl: str('WORKER_SERVICE_URL', ''),
    /** Endpoint the queue POSTs a job to. */
    runPath: '/run',
    /** Endpoint the queue POSTs an on-demand PDF render to. */
    pdfPath: '/render-pdf',
  },
  tasks: {
    /** Cloud Tasks queue that gates job execution concurrency. */
    queue: str('TASKS_QUEUE', `agent-researcher-${ENV}-jobs`),
    region: str('TASKS_REGION', 'us-central1'),
    /** SA email Cloud Tasks mints an OIDC token as (must have run.invoker on the worker). */
    invokerServiceAccount: str('TASKS_INVOKER_SA', ''),
    /** Per-task dispatch deadline; must be >= worker timeout (Cloud Tasks max 1800s). */
    dispatchDeadlineSeconds: int('TASKS_DISPATCH_DEADLINE', 1800),
    /** Max jobs running at once — enforced on the queue (maxConcurrentDispatches). */
    maxConcurrency: int('JOB_MAX_CONCURRENCY', 4),
  },
  server: {
    port: int('PORT', 8080),
    logLevel: str('LOG_LEVEL', 'info'),
    /** Environment: "local" disables API-key auth. Anything else enforces it. */
    appEnv: str('APP_ENV', 'production'),
  },
} as const;

export type Config = typeof config;
