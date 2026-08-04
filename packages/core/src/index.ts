/** Public API of the research core, consumed by apps/api and apps/worker. */
export { config } from './config.js';

// Templates
export { getTemplate, listTemplates, toManifest, modeLabel, TEMPLATES, SUPPORTED_LANGS, DEFAULT_LANG, __registerTemplateForTests, __clearTestTemplates } from './templates/registry.js';
export { reportSchemaOf, sectionSubsetSchema, sectionByKey } from './templates/types.js';
export { chartSchema } from './templates/chart.js';
export type { ChartSpec } from './templates/chart.js';
export type {
  ResearchTemplate,
  ReportSection,
  AgentSpec,
  AgentRole,
  TemplateManifest,
  ParamsUi,
  ParamFieldUi,
  ParamRangeUi,
  TemplateI18n,
  StepInfo,
  AddonSpec,
} from './templates/types.js';
export { validateTemplate, assertTemplatesValid } from './templates/validate.js';

// Jobs
export {
  createJob,
  getJob,
  listJobs,
  queryJobs,
  getUserJobStats,
  requeueJob,
  addJobFiles,
  setJobAttempts,
  markRunning,
  markCompleted,
  markFailed,
  setProgress,
  setJobCost,
  setJobSummary,
  setJobHeadline,
  setJobStatus,
  markHeld,
  parkJob,
  approveHold,
  rejectHold,
  noteJobResolution,
} from './jobs/firestore.js';
export type { ResearchJob, JobStatus, JobFailureKind, JobHold, JobFile, JobProgress, JobSummary } from './jobs/types.js';
export { sectionsNotice, degradedSectionNote, heldNotice, closedNotice } from './jobs/report-copy.js';
export { claimJobSlot, releaseJobSlot, releaseUnclaimedSlot, inFlightSlots, setJobSlotHeld } from './jobs/slots.js';
export type { SlotClaim } from './jobs/slots.js';
export { generateHeadline } from './jobs/headline.js';
export type { Headline } from './jobs/headline.js';

// Storage
export { uploadObject, downloadObject, downloadObjectBytes, listJobFiles, signRead, signJobFiles } from './storage/gcs.js';
export type { SignedFile } from './storage/gcs.js';

// PDF report generation (shared HTML/layout + per-app theme; rendered by the worker)
export { pdfFooterNote, buildReportHtml } from './pdf/report-html.js';
export type { BuildReportHtmlInput } from './pdf/report-html.js';
export { getPdfTheme } from './pdf/theme.js';
export type { PdfTheme } from './pdf/theme.js';

// Apps (registry + rate limiting)
export {
  createApp,
  getApp,
  getAppByApiKey,
  listApps,
  updateApp,
  deleteApp,
  generateApiKey,
  checkRateLimits,
  peekRateLimits,
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

// Report modes (public cost/scope knob) + internal depth
export { REPORT_MODES, modeParamSchema, resolveMode, isReportMode, DEFAULT_MODES, creditsForMode, maxCostForMode } from './mode.js';
export type { ReportMode, ModeConfig } from './mode.js';
export { LANGUAGE_LABELS } from './languages.js';
export { dedupeSources, normalizeUrl } from './tools/sources.js';

// Credits / billing (shared across all models + webs)
export {
  getBalance,
  listTransactions,
  grantCredits,
  recordPurchase,
  consumeCredits,
  refundForJob,
  wasJobRefunded,
  wasJobConsumed,
} from './credits/store.js';
export { InsufficientCreditsError } from './credits/types.js';
export type { CreditLedgerEntry, CreditBalance, LedgerEntryType } from './credits/types.js';
export { getModelPricing, setModelPricing, resolveModeCredits } from './credits/pricing.js';
export type { ModelPricing } from './credits/pricing.js';

// Per-app analytics (write-only for now; read helpers for later)
export {
  recordReportStats,
  recordPurchaseStats,
  recordRequestLlmCost,
  recordLogin,
  getAppStats,
  getDailyStats,
  listAllAppStats,
  getAdminStats,
  queryUsers,
  getUserFlags,
  recordModerationStrike,
  setUserBlocked,
  MODERATION_STRIKE_LIMIT,
  reserveAssistedReview,
  resetAssistAllowance,
  ASSIST_FREE_ATTEMPTS,
} from './stats/store.js';
export type { ReportStatsInput, PurchaseStatsInput, AdminStats, AppStatsRollup, UserRecord } from './stats/store.js';
export { DEPTH_PROFILES, depthParamSchema, resolveDepthProfile } from './depth.js';
export type { Depth, DepthProfile } from './depth.js';

// Cost accounting
export { emptyCost, addCost, llmCost, searchCost } from './cost.js';
export type { Cost } from './cost.js';
export { runJob } from './engine/run-job.js';
export type { RunJobInput, RunJobResult } from './engine/run-job.js';

// LLM
export { getProvider, resolveModel, getProviderFor, modelAliases } from './llm/index.js';
export type { LlmProvider, ResolvedModel, GenerateOptions, GenerateResult } from './llm/index.js';
/** Test seams: swap a provider for a stub so a suite never hits the network. */
export { __setProviderForTests, __clearProvidersForTests } from './llm/models.js';

// Auth (session JWTs + Google id_token verification)
export { signSession, signReadToken, signActionToken, verifySession, verifyGoogleIdToken } from './auth/tokens.js';
export type { SessionClaims, SessionRole, Identity, IdentityProvider } from './auth/tokens.js';

// Auth (password credentials + email verification / reset)
export { hashPassword, verifyPassword, passwordProblem, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN } from './auth/passwords.js';
export {
  consumeActionToken,
  credentialsStillValid,
  getCredential,
  createPasswordUser,
  setEmailVerified,
  setPassword,
  upsertGoogleUser,
  normalizeEmail,
  isSingleEmail,
  UserExistsError,
} from './auth/users.js';
export type { UserCredential, AuthProvider } from './auth/users.js';
export { isDisposableEmail, DISPOSABLE_EMAIL_DOMAINS } from './auth/disposable-email.js';
// Cloudflare Turnstile verification (off until TURNSTILE_SECRET is set)
export { verifyCaptcha, captchaEnabled, TURNSTILE_TOKEN_FIELD } from './auth/captcha.js';
export type { CaptchaResult } from './auth/captcha.js';

// Transactional email (shared Postmark, per-app From)
export { sendAppEmail, EmailNotConfiguredError } from './email/postmark.js';
export type { SendEmailInput } from './email/postmark.js';
export { verifyEmailTemplate, resetPasswordTemplate, reportReadyTemplate } from './email/templates.js';

// Pre-submission moderation of research params (prompt-injection + profanity gate)
export { moderateResearchParams, preScreen, collectFreeText } from './moderation/moderate.js';
export type { ModerationVerdict } from './moderation/moderate.js';
// Fixed, localized copy for everything moderation / pre-flight shows or stores.
// (No LLM-authored string is ever rendered or persisted — see moderation/copy.ts.)
export {
  moderationMessage,
  blockReasonFor,
  blockedMessage,
  asModerationCategory,
  assistMessage,
  asLang,
  MODERATION_CATEGORIES,
} from './moderation/copy.js';
export type { ModerationCategory, AssistState, Lang, IssueSeverity } from './moderation/copy.js';
// Pre-flight review: deterministic summary + rules, plus an optional constrained
// assisted pass (typo corrections + finding codes) on the cheapest model.
export { runPreflight } from './moderation/preflight.js';
export type { PreflightOutcome, PreflightQuality } from './moderation/preflight.js';
export { deterministicIssues, renderPlan, issueMessage, allowedIssueCodes } from './moderation/deterministic.js';
export type { PreflightIssue } from './moderation/deterministic.js';
export { enrichRequest, acceptCorrections, applyCorrections } from './moderation/enrich.js';
export type { Correction, EnrichResult } from './moderation/enrich.js';
// Text hardening (unicode normalization for screening, similarity for corrections)
export { screeningForms, similarity, sanitizeProposal, hasControlChars } from './util/text.js';

import { z } from 'zod';
import { getTemplate } from './templates/registry.js';

export interface ValidatedRequest {
  template: string;
  params: Record<string, unknown>;
}

/**
 * Validates a research request body `{ template, params }`. The caller identity
 * (appId + userId) is NOT in the body — it comes from the session token.
 * Throws a descriptive Error if the template or params are invalid.
 */
export function validateRequest(body: unknown): ValidatedRequest {
  const raw = (body ?? {}) as Record<string, unknown>;

  const templateId = typeof raw.template === 'string' ? raw.template : '';
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId || '(missing)'}`);

  const parsed = template.paramsSchema.safeParse(raw.params ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid params: ${issues}`);
  }

  return { template: templateId, params: parsed.data as Record<string, unknown> };
}
