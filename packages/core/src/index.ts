/** Public API of the research core, consumed by apps/api and apps/worker. */
export { config } from './config.js';

// Templates
export { getTemplate, listTemplates, toManifest, TEMPLATES } from './templates/registry.js';
export { reportSchemaOf, sectionSubsetSchema, sectionByKey } from './templates/types.js';
export type {
  ResearchTemplate,
  ReportSection,
  AgentSpec,
  AgentRole,
  TemplateManifest,
} from './templates/types.js';
export { validateTemplate, assertTemplatesValid } from './templates/validate.js';

// Jobs
export {
  createJob,
  getJob,
  markRunning,
  markCompleted,
  markFailed,
  setProgress,
  setJobStatus,
} from './jobs/firestore.js';
export type { ResearchJob, JobStatus, JobFile, JobProgress } from './jobs/types.js';

// Storage
export { uploadObject, listJobFiles, signRead, signJobFiles } from './storage/gcs.js';
export type { SignedFile } from './storage/gcs.js';

// Apps (registry + rate limiting)
export {
  createApp,
  getApp,
  getAppByApiKey,
  listApps,
  updateApp,
  generateApiKey,
  checkRateLimits,
} from './apps/store.js';
export { toPublicApp } from './apps/types.js';
export type { AppRecord, AppPublic, AppRole } from './apps/types.js';
export type {
  CreateAppInput,
  UpdateAppInput,
  RateLimitEntry,
  RateLimitResult,
  RateLimitViolation,
} from './apps/store.js';

// Settings (general/default rate limits)
export { getSettings, updateSettings, ensureDefaultSettings, DEFAULT_SETTINGS } from './settings/store.js';
export type { GeneralSettings, UpdateSettingsInput } from './settings/store.js';

// Engine
export { runResearch, planWaves } from './engine/research-engine.js';
export type {
  ResearchProgress,
  ResearchOutput,
  ReportMeta,
  JobTrace,
  AgentTrace,
} from './engine/research-engine.js';

// Observability
export { logEvent, jobLogger } from './obs/log.js';
export type { LogContext, JobLogger, Severity } from './obs/log.js';

// Depth (optional analysis-depth knob any template can accept)
export { DEPTH_PROFILES, depthParamSchema, resolveDepthProfile } from './depth.js';
export type { Depth, DepthProfile } from './depth.js';
export { runJob } from './engine/run-job.js';
export type { RunJobInput, RunJobResult } from './engine/run-job.js';

// LLM
export { getProvider, resolveModel, getProviderFor, modelAliases } from './llm/index.js';
export type { LlmProvider, ResolvedModel } from './llm/index.js';

import { z } from 'zod';
import { getTemplate } from './templates/registry.js';

export interface ValidatedRequest {
  appId: string;
  userId: string;
  template: string;
  params: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Caller identity: which app and which user a job belongs to (rate-limit keys). */
const identitySchema = z.object({
  appId: z.string().trim().min(1, 'appId is required').max(128),
  userId: z
    .string()
    .trim()
    .min(1, 'userId is required')
    .max(320)
    .refine((v) => UUID_RE.test(v) || EMAIL_RE.test(v), 'userId must be a UUID or an email'),
});

/**
 * Validates a full incoming research request:
 *   { appId, userId, template, params }
 * Throws a descriptive Error if identity, template, or params are invalid.
 */
export function validateRequest(body: unknown): ValidatedRequest {
  const raw = (body ?? {}) as Record<string, unknown>;

  const identity = identitySchema.safeParse({ appId: raw.appId, userId: raw.userId });
  if (!identity.success) {
    const issues = identity.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid request: ${issues}`);
  }

  const templateId = typeof raw.template === 'string' ? raw.template : '';
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId || '(missing)'}`);

  const parsed = template.paramsSchema.safeParse(raw.params ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid params: ${issues}`);
  }

  return {
    appId: identity.data.appId,
    userId: identity.data.userId,
    template: templateId,
    params: parsed.data as Record<string, unknown>,
  };
}
