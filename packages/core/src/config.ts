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

function float(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Comma-separated integers, e.g. "1,6,24,72". Falls back on any malformed entry. */
function ints(name: string, fallback: number[]): number[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = raw.split(',').map((p) => Number.parseInt(p.trim(), 10));
  return parsed.length && parsed.every((n) => Number.isFinite(n) && n > 0) ? parsed : fallback;
}

/** Deployment environment. Names every stateful resource (dev vs prod). */
const ENV = str('ENV', 'dev');

/**
 * Provider backing one model alias. Per-alias override first
 * (`LLM_PROVIDER_FLASH=ollama` points just the cheap calls at a local model),
 * then the global default. Lets a laptop run the whole flow offline without a
 * code change.
 */
function providerFor(alias: string): string {
  return str(`LLM_PROVIDER_${alias}`, str('LLM_PROVIDER', 'gemini-vertex'));
}

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
  validation: {
    /** Run the assisted (LLM) half of the pre-flight review — typo corrections +
     *  extra finding codes. The deterministic half always runs. Disable in tests
     *  to avoid live LLM calls. */
    llm: str('VALIDATION_LLM', 'true') !== 'false',
    /** Assisted reviews for ONE report the user is drafting. They can act on the
     *  suggestions and re-check, but past this the review goes deterministic-only
     *  and generation proceeds — no waiting, no penalty. Editing is normal; paying
     *  a model to re-read the same request a third time is not. */
    assistAttempts: int('PREFLIGHT_ASSIST_ATTEMPTS', 2),
    /**
      * Backstop across ALL drafts, per user, within the window below. The per-draft
      * limit is what shapes normal use; this one exists only to catch a client
      * cycling draft ids to farm assisted reviews, so it is set well clear of real
      * behaviour — 30 is 15 different reports reviewed twice each in 8 hours, and
      * each review is a fraction of a cent. Only this limit triggers a cooldown.
      */
    assistUserAttempts: int('PREFLIGHT_ASSIST_USER_ATTEMPTS', 30),
    /** Escalating pause (hours) applied each time the allowance is exhausted.
     *  Generating a report pays one step back. */
    cooldownHours: ints('PREFLIGHT_COOLDOWN_HOURS', [1, 6, 24, 72]),
    /** Sliding window (hours) for the allowance counter: if the last assisted
     *  review was longer ago than this, the count restarts. */
    windowHours: int('PREFLIGHT_WINDOW_HOURS', 8),
  },
  /**
   * Abuse limits for the UNAUTHENTICATED endpoints (register / login / password
   * reset / contact). These cost real money — Postmark sends, password hashing —
   * and have no session to rate-limit against, so they are limited per client IP
   * and per target email. `0` disables a limit.
   */
  publicLimits: {
    /** In-process burst guard per IP (requests/minute across all public routes). */
    burstPerMinute: int('PUBLIC_BURST_PER_MINUTE', 30),
    registerPerHourPerIp: int('PUBLIC_REGISTER_PER_HOUR_IP', 5),
    /** Per TARGET address. Registration emails a link to an address the caller
     *  chooses, so without this one inbox can be mail-bombed from many IPs — the
     *  same reason the reset route has a per-target cap. */
    registerPerHourPerEmail: int('PUBLIC_REGISTER_PER_HOUR_EMAIL', 3),
    loginPerHourPerIp: int('PUBLIC_LOGIN_PER_HOUR_IP', 30),
    loginPerHourPerEmail: int('PUBLIC_LOGIN_PER_HOUR_EMAIL', 10),
    resetPerHourPerIp: int('PUBLIC_RESET_PER_HOUR_IP', 5),
    resetPerHourPerEmail: int('PUBLIC_RESET_PER_HOUR_EMAIL', 3),
    contactPerHourPerIp: int('PUBLIC_CONTACT_PER_HOUR_IP', 5),
    /** Token-consuming link endpoints (verify-email / reset-password). */
    tokenPerHourPerIp: int('PUBLIC_TOKEN_PER_HOUR_IP', 30),
    /** The public pricing catalog. The landing no longer calls it (the catalog is
     *  baked into the build), so this now only meters direct API consumers. */
    plansPerHourPerIp: int('PUBLIC_PLANS_PER_HOUR_IP', 60),
    /** The authenticated catalog, per user. Opening the buy-credits dialog a few
     *  times a session is normal; it is metered per user so one heavy client
     *  cannot affect anyone else. */
    plansPerHourPerUser: int('PLANS_PER_HOUR_PER_USER', 60),
    /** Checkout is authenticated, but each call makes two Stripe requests, so it
     *  is metered per user rather than per IP. Buying is a deliberate act. */
    checkoutPerHourPerUser: int('CHECKOUT_PER_HOUR_PER_USER', 20),
  },
  /**
   * Cloudflare Turnstile bot check. Disabled entirely when `TURNSTILE_SECRET` is
   * unset, so nothing breaks before it is configured.
   *
   * `flows` is the generic knob: a flow is a named thing a user does that we may
   * want to prove a human is behind. Routes bind themselves to a flow, so
   * protecting a new one — here or in a future app — is a config change, not a
   * code change. Order is irrelevant; unknown names are ignored.
   */
  captcha: {
    secret: str('TURNSTILE_SECRET'),
    /** Public site key. Not a credential — it ships in the HTML. */
    siteKey: str('TURNSTILE_SITE_KEY', '0x4AAAAAAD_OEtqrL5B2NN6f'),
    flows: new Set(
      str('TURNSTILE_FLOWS', 'register,login,password-reset,contact,research,preflight')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    ),
    /**
     * Apps whose clients render the widget, and are therefore expected to send a
     * token. An app not listed here is exempt — which is what keeps a headless or
     * internal client (the admin SPA, a future API consumer) from being locked out
     * by a check its UI never had. Adding an app is a config change.
     */
    apps: new Set(
      str('TURNSTILE_APPS', 'fbizlab')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    ),
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
      gather: { provider: providerFor('GATHER'), model: str('LLM_MODEL_GATHER', str('LLM_MODEL_FLASH', 'gemini-2.5-flash')), inPerM: 0.3, outPerM: 2.5 },
      /** Same as gather; a distinct alias so intent reads clearly at call sites. */
      flash: { provider: providerFor('FLASH'), model: str('LLM_MODEL_FLASH', 'gemini-2.5-flash'), inPerM: 0.3, outPerM: 2.5 },
      /** Strong tier for structured section synthesis. */
      pro: { provider: providerFor('PRO'), model: str('LLM_MODEL_PRO', 'gemini-2.5-pro'), inPerM: 1.25, outPerM: 10 },
      // Later (no breaking change): add Claude and reference it per-agent.
      // 'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-5', inPerM: 3, outPerM: 15 },
    } as Record<string, { provider: string; model: string; inPerM: number; outPerM: number }>,
    /** Base URL of a local Ollama server (provider "ollama" — dev/testing only). */
    ollamaHost: str('OLLAMA_HOST', 'http://localhost:11434'),
    /** Local models are slow on CPU; give a generated answer room to finish. */
    ollamaTimeoutMs: int('OLLAMA_TIMEOUT_MS', 180_000),
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
    /** Estimated USD per Tavily web_search/fetch_page call (~2 credits × $0.008). */
    costPerCallUsd: Number(process.env.SEARCH_COST_PER_CALL_USD ?? '0.016'),
    /** Estimated USD per Brave call. Brave's free tier is $0, but a paid plan is
     *  not — and booking paid searches at zero is how a job's real cost hides. */
    braveCostPerCallUsd: Number(process.env.BRAVE_COST_PER_CALL_USD ?? '0'),
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
    /**
     * How many trailing `X-Forwarded-For` entries were added by infrastructure
     * BEYOND the one that recorded the real peer — i.e. how many to drop before
     * taking the client IP.
     *
     * This is 0 for a service reached directly on its `*.run.app` host, which is
     * this deployment: Cloud Run appends the peer address to whatever the caller
     * sent, so the LAST entry is the real one and everything before it is
     * attacker-written. It becomes 1 behind a global external load balancer,
     * which appends its own address after the client's.
     *
     * Getting this wrong is silent and total: too high and every per-IP limit
     * keys on a header the caller writes. Verified against the deployment in
     * `apps/api/test/public-limits.test.ts`.
     */
    proxyHops: int('TRUSTED_PROXY_HOPS', 0),
  },
} as const;

export type Config = typeof config;
