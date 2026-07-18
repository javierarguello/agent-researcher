/**
 * End-to-end job execution: run the research engine (resumable), persist outputs
 * to Cloud Storage, keep the Firestore job in sync, emit a diagnosable trace, and
 * log every step to Cloud Logging bound to jobId/appId/userId. Called by the worker.
 *
 * Resilience: each agent retries with backoff in-run; if steps still can't finish,
 * the run returns 'incomplete' and the worker returns a retryable status so Cloud
 * Tasks re-dispatches with backoff. A checkpoint persists completed steps, so a
 * re-dispatch RESUMES (runs only the missing steps) rather than restarting. After
 * `config.workflow.maxJobAttempts` dispatches it finalizes, degrading whatever
 * still failed (logged + flagged as a WARNING on the job) and delivering the rest.
 */
import { config } from '../config.js';
import { getTemplate } from '../templates/registry.js';
import {
  getJob, markCompleted, markFailed, markRunning, setJobAttempts, setJobCost, setJobHeadline, setJobSummary, setProgress,
} from '../jobs/firestore.js';
import { deleteObject, downloadObject, uploadObject } from '../storage/gcs.js';
import type { JobFile, JobSummary } from '../jobs/types.js';
import { generateHeadline } from '../jobs/headline.js';
import { emptyCost } from '../cost.js';
import { resolveMode } from '../mode.js';
import { refundForJob } from '../credits/store.js';
import { recordReportStats } from '../stats/store.js';
import { jobLogger } from '../obs/log.js';
import { runResearch, type Checkpoint, type JobTrace } from './research-engine.js';

const CHECKPOINT = 'checkpoint.json';

export interface RunJobInput {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  params: Record<string, unknown>;
}

export interface RunJobResult {
  files: JobFile[];
  reportBytes: number;
  sourcesFound: number;
  /** 'incomplete' → the worker should return a retryable status so the queue resumes it. */
  status: 'completed' | 'failed' | 'incomplete';
}

export async function runJob(input: RunJobInput): Promise<RunJobResult> {
  const log = jobLogger({ jobId: input.jobId, appId: input.appId, userId: input.userId, template: input.template });

  const template = getTemplate(input.template);
  if (!template) {
    log.error('job.error', { message: `Unknown template: ${input.template}` });
    throw new Error(`Unknown template: ${input.template}`);
  }

  // Dispatch/attempt bookkeeping + resume state.
  const existing = await getJob(input.jobId);
  const attempts = (existing?.attempts ?? 0) + 1;
  const finalize = attempts >= config.workflow.maxJobAttempts;
  await markRunning(input.jobId);
  await setJobAttempts(input.jobId, attempts);
  log.info('job.start', { params: input.params, attempts, finalize });

  // Headline once (first dispatch only).
  let headlineCost = emptyCost();
  if (!existing?.title) {
    try {
      const mode = resolveMode(template.modes, (input.params as Record<string, unknown>).mode).key;
      const language = String((input.params as Record<string, unknown>).language ?? 'en');
      const { headline, cost } = await generateHeadline({ templateName: template.name, params: input.params, mode, language });
      headlineCost = cost;
      await setJobHeadline(input.jobId, headline);
      log.info('job.headline', { title: headline.title, costUsd: cost.usd });
    } catch (err) {
      log.warn('headline.failed', { message: (err as Error).message });
    }
  }

  // Load a prior checkpoint (resume) if any.
  let resume: Checkpoint | undefined;
  try {
    const raw = await downloadObject(input.jobId, CHECKPOINT);
    if (raw) {
      resume = JSON.parse(raw) as Checkpoint;
      log.info('job.resume', { doneAgents: resume.doneAgentIds.length });
    }
  } catch (err) {
    log.warn('checkpoint.load_failed', { message: (err as Error).message });
  }

  const uploadJson = (name: string, data: unknown) =>
    uploadObject({ jobId: input.jobId, name, data: JSON.stringify(data, null, 2), contentType: 'application/json; charset=utf-8' });
  const uploadTrace = async (trace: JobTrace): Promise<JobFile | undefined> => {
    try {
      return await uploadJson('trace.json', trace);
    } catch (err) {
      log.warn('trace.upload_failed', { message: (err as Error).message });
      return undefined;
    }
  };

  try {
    const generatedAt = existing?.createdAt ?? new Date().toISOString();
    const seenAgents = new Set<string>();

    const output = await runResearch({
      template,
      params: input.params,
      jobId: input.jobId,
      generatedAt,
      resume,
      finalize,
      // Fold headline cost into the trace so it's checkpointed and survives resumes
      // (nonzero only on the first dispatch; already carried in `resume.cost` after).
      baseCost: headlineCost,
      onCheckpoint: async (cp) => {
        try {
          await uploadJson(CHECKPOINT, cp);
        } catch (err) {
          log.warn('checkpoint.save_failed', { message: (err as Error).message });
        }
      },
      onProgress: async (p) => {
        log.info('step', { phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound });
        await setProgress(input.jobId, {
          phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound,
          updatedAt: new Date().toISOString(),
        });
      },
      onTrace: async (trace) => {
        await uploadTrace(trace);
        await setJobCost(input.jobId, trace.cost);
        for (const a of trace.agents) {
          if (a.status === 'running' || a.status === 'pending' || seenAgents.has(a.id)) continue;
          seenAgents.add(a.id);
          if (a.status === 'failed') {
            log.error('agent.failed', { agentId: a.id, wave: a.wave, model: a.model, attempts: a.attempts, durationMs: a.durationMs, message: a.error });
          } else {
            log.info('agent.ok', {
              agentId: a.id, wave: a.wave, model: a.model, attempts: a.attempts, durationMs: a.durationMs,
              turnsUsed: a.turnsUsed, produced: a.produces, costUsd: a.cost.usd, runningTotalUsd: trace.cost.usd,
            });
          }
        }
      },
    });

    // headlineCost is folded into the trace via `baseCost`, so meta.cost already includes it.
    await setJobCost(input.jobId, output.meta.cost);

    // --- Incomplete: some steps still pending → resume on the next dispatch. ---
    if (output.trace.status === 'incomplete') {
      log.warn('job.incomplete', {
        attempts,
        pending: output.trace.agents.filter((a) => a.status !== 'ok').map((a) => a.id),
        message: 'Some steps failed; will retry on re-dispatch.',
      });
      await setProgress(input.jobId, {
        phase: 'incomplete', message: `Partial (attempt ${attempts}); retrying pending steps.`,
        turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, updatedAt: new Date().toISOString(),
      });
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'incomplete' };
    }

    // --- Finished (completed or failed): persist outputs. ---
    const report = await uploadJson('report.json', { meta: output.meta, report: output.report });
    const sources = await uploadJson('sources.json', output.sources);
    const meta = await uploadJson('metadata.json', {
      jobId: input.jobId, appId: input.appId, userId: input.userId, template: input.template,
      version: output.meta.templateVersion, schemaVersion: output.meta.schemaVersion, params: input.params,
      language: output.language, mode: output.meta.mode, depth: output.meta.depth, generatedAt,
      turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, cost: output.meta.cost,
      status: output.trace.status, attempts,
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
    });
    const traceFile = await uploadTrace(output.trace);
    const files = [report, sources, meta, ...(traceFile ? [traceFile] : [])];

    // Denormalized summary: metrics + per-agent timing/retries + warnings.
    const durationMs = output.trace.durationMs ?? 0;
    const agents = output.trace.agents.map((a) => ({
      id: a.id, wave: a.wave, status: a.status, durationMs: a.durationMs ?? null, attempts: a.attempts, costUsd: a.cost.usd,
    }));
    const agentErrors = output.trace.agents
      .filter((a) => a.status === 'failed')
      .map((a) => ({ agentId: a.id, error: ((a.error ?? '').split('\n')[0] ?? '').slice(0, 500) }));
    const summary: JobSummary = {
      schemaVersion: output.meta.schemaVersion, language: output.language, mode: output.meta.mode, depth: output.meta.depth,
      turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, reportBytes: report.size ?? 0,
      durationMs, attempts, agents,
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
      ...(agentErrors.length ? { agentErrors } : {}),
    };
    await setJobSummary(input.jobId, summary);

    // WARNING for degraded sections, so it's easy to find later.
    if (output.trace.warnings?.length) {
      log.warn('job.degraded', { degradedSections: output.meta.degradedSections, warnings: output.trace.warnings, attempts });
    }

    // Per-app analytics (best-effort).
    try {
      await recordReportStats({
        appId: input.appId, userId: input.userId, template: input.template,
        status: output.trace.status === 'failed' ? 'failed' : 'completed',
        costUsd: output.meta.cost.usd, durationMs, degraded: !!output.meta.degradedSections,
      });
    } catch (err) {
      log.warn('stats.report_failed', { message: (err as Error).message });
    }

    await deleteObject(input.jobId, CHECKPOINT).catch(() => {}); // clean up

    if (output.trace.status === 'failed') {
      log.error('job.failed', { message: output.trace.error, attempts });
      await refundOnFailure(input, log);
      await markFailed(input.jobId, output.trace.error ?? 'Report failed validation.', files);
      return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'failed' };
    }

    log.info('job.completed', {
      sourcesFound: output.sources.length, turnsUsed: output.turnsUsed, durationMs, attempts,
      costUsd: output.meta.cost.usd, tokensIn: output.meta.cost.inputTokens, tokensOut: output.meta.cost.outputTokens,
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
    });
    await markCompleted(input.jobId, files);
    return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'completed' };
  } catch (error) {
    log.error('job.error', { message: (error as Error).stack ?? (error as Error).message ?? String(error) });
    await refundOnFailure(input, log);
    await markFailed(input.jobId, (error as Error).message ?? String(error));
    throw error;
  }
}

/** Refund any credits consumed for a failed job (idempotent; no-op if none were). */
async function refundOnFailure(input: RunJobInput, log: ReturnType<typeof jobLogger>): Promise<void> {
  try {
    const refunded = await refundForJob(input.appId, input.userId, input.jobId, 'job failed');
    if (refunded) log.info('credits.refunded', { jobId: input.jobId });
  } catch (err) {
    log.warn('credits.refund_failed', { message: (err as Error).message });
  }
}
