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
      gather: { provider: 'gemini-vertex', model: str('LLM_MODEL_FLASH', 'gemini-2.5-flash') },
      /** Same as gather; a distinct alias so intent reads clearly at call sites. */
      flash: { provider: 'gemini-vertex', model: str('LLM_MODEL_FLASH', 'gemini-2.5-flash') },
      /** Strong tier for structured section synthesis. */
      pro: { provider: 'gemini-vertex', model: str('LLM_MODEL_PRO', 'gemini-2.5-pro') },
      // Later (no breaking change): add Claude and reference it per-agent.
      // 'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-5' },
    } as Record<string, { provider: string; model: string }>,
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
  search: {
    braveApiKey: str('BRAVE_API_KEY'),
    tavilyApiKey: str('TAVILY_API_KEY'),
    maxTurns: int('RESEARCH_MAX_TURNS', 16),
  },
  worker: {
    jobName: str('WORKER_JOB_NAME', `agent-researcher-${ENV}-worker`),
    jobRegion: str('WORKER_JOB_REGION', 'us-central1'),
  },
  server: {
    port: int('PORT', 8080),
    logLevel: str('LOG_LEVEL', 'info'),
    /** Environment: "local" disables API-key auth. Anything else enforces it. */
    appEnv: str('APP_ENV', 'production'),
  },
} as const;

export type Config = typeof config;
