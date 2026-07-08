/**
 * End-to-end job execution: run the research engine, persist outputs to Cloud
 * Storage, keep the Firestore job in sync, emit a diagnosable trace, and log
 * every step to Cloud Logging bound to jobId/appId/userId. Called by the worker.
 */
import { getTemplate } from '../templates/registry.js';
import {
  markCompleted, markFailed, markRunning, setJobCost, setJobHeadline, setJobSummary, setProgress,
} from '../jobs/firestore.js';
import { uploadObject } from '../storage/gcs.js';
import type { JobFile, JobSummary } from '../jobs/types.js';
import { generateHeadline } from '../jobs/headline.js';
import { addCost, emptyCost } from '../cost.js';
import { resolveMode } from '../mode.js';
import { jobLogger } from '../obs/log.js';
import { runResearch, type JobTrace } from './research-engine.js';

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
  status: 'completed' | 'failed';
}

export async function runJob(input: RunJobInput): Promise<RunJobResult> {
  const log = jobLogger({ jobId: input.jobId, appId: input.appId, userId: input.userId, template: input.template });

  const template = getTemplate(input.template);
  if (!template) {
    log.error('job.error', { message: `Unknown template: ${input.template}` });
    throw new Error(`Unknown template: ${input.template}`);
  }

  await markRunning(input.jobId);
  log.info('job.start', { params: input.params });

  // Cheap auto-generated title + description for dashboards (flash tier).
  // Generated up front so a report list shows it even while the job runs.
  let headlineCost = emptyCost();
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

  // Best-effort upload of the trace so a mid-run crash still leaves a record.
  const uploadTrace = async (trace: JobTrace): Promise<JobFile | undefined> => {
    try {
      return await uploadObject({
        jobId: input.jobId,
        name: 'trace.json',
        data: JSON.stringify(trace, null, 2),
        contentType: 'application/json; charset=utf-8',
      });
    } catch (err) {
      log.warn('trace.upload_failed', { message: (err as Error).message });
      return undefined;
    }
  };

  try {
    const generatedAt = new Date().toISOString();
    const seenAgents = new Set<string>();

    const output = await runResearch({
      template,
      params: input.params,
      jobId: input.jobId,
      generatedAt,
      onProgress: async (p) => {
        // One Cloud Logging line per step, bound to jobId/appId/userId.
        log.info('step', { phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound });
        await setProgress(input.jobId, {
          phase: p.phase,
          message: p.message,
          turnsUsed: p.turnsUsed,
          sourcesFound: p.sourcesFound,
          updatedAt: new Date().toISOString(),
        });
      },
      onTrace: async (trace) => {
        await uploadTrace(trace);
        await setJobCost(input.jobId, trace.cost); // running total on the job doc
        // Log each agent's outcome once (as it finishes), incl. errors.
        for (const a of trace.agents) {
          if (a.status === 'running' || seenAgents.has(a.id)) continue;
          seenAgents.add(a.id);
          if (a.status === 'failed') {
            log.error('agent.failed', { agentId: a.id, wave: a.wave, model: a.model, message: a.error });
          } else {
            log.info('agent.ok', {
              agentId: a.id, wave: a.wave, model: a.model, turnsUsed: a.turnsUsed,
              produced: a.produces, costUsd: a.cost.usd, tokensIn: a.cost.inputTokens, tokensOut: a.cost.outputTokens,
              runningTotalUsd: trace.cost.usd,
            });
          }
        }
      },
    });

    // Fold the headline cost into the report total so meta/summary/doc all agree.
    output.meta.cost = addCost(output.meta.cost, headlineCost);
    await setJobCost(input.jobId, output.meta.cost);

    // Persist outputs: the deliverable + sources + metadata + final trace.
    const report = await uploadObject({
      jobId: input.jobId,
      name: 'report.json',
      data: JSON.stringify({ meta: output.meta, report: output.report }, null, 2),
      contentType: 'application/json; charset=utf-8',
    });
    const sources = await uploadObject({
      jobId: input.jobId,
      name: 'sources.json',
      data: JSON.stringify(output.sources, null, 2),
      contentType: 'application/json; charset=utf-8',
    });
    const meta = await uploadObject({
      jobId: input.jobId,
      name: 'metadata.json',
      data: JSON.stringify(
        {
          jobId: input.jobId,
          appId: input.appId,
          userId: input.userId,
          template: input.template,
          version: output.meta.templateVersion,
          schemaVersion: output.meta.schemaVersion,
          params: input.params,
          language: output.language,
          mode: output.meta.mode,
          depth: output.meta.depth,
          generatedAt,
          turnsUsed: output.turnsUsed,
          sourcesFound: output.sources.length,
          cost: output.meta.cost,
          status: output.trace.status,
          ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
        },
        null,
        2,
      ),
      contentType: 'application/json; charset=utf-8',
    });
    const traceFile = await uploadTrace(output.trace);

    const files = [report, sources, meta, ...(traceFile ? [traceFile] : [])];

    // Denormalized summary on the job doc (metrics + per-agent errors).
    const startedMs = Date.parse(output.trace.startedAt);
    const finishedMs = Date.parse(output.trace.finishedAt ?? output.trace.startedAt);
    const agentErrors = output.trace.agents
      .filter((a) => a.status === 'failed')
      .map((a) => ({ agentId: a.id, error: ((a.error ?? '').split('\n')[0] ?? '').slice(0, 500) }));
    const summary: JobSummary = {
      schemaVersion: output.meta.schemaVersion,
      language: output.language,
      mode: output.meta.mode,
      depth: output.meta.depth,
      turnsUsed: output.turnsUsed,
      sourcesFound: output.sources.length,
      reportBytes: report.size ?? 0,
      durationMs: Math.max(0, finishedMs - startedMs),
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
      ...(agentErrors.length ? { agentErrors } : {}),
    };
    await setJobSummary(input.jobId, summary);

    if (output.trace.status === 'failed') {
      log.error('job.failed', { message: output.trace.error, degradedSections: output.meta.degradedSections });
      await markFailed(input.jobId, output.trace.error ?? 'Report failed validation.', files);
      return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'failed' };
    }

    log.info('job.completed', {
      sourcesFound: output.sources.length,
      turnsUsed: output.turnsUsed,
      costUsd: output.meta.cost.usd,
      llmUsd: output.meta.cost.llmUsd,
      searchUsd: output.meta.cost.searchUsd,
      tokensIn: output.meta.cost.inputTokens,
      tokensOut: output.meta.cost.outputTokens,
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
    });
    await markCompleted(input.jobId, files);
    return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'completed' };
  } catch (error) {
    // Unexpected/engine error — the trace (if any) was already persisted incrementally.
    log.error('job.error', { message: (error as Error).stack ?? (error as Error).message ?? String(error) });
    await markFailed(input.jobId, (error as Error).message ?? String(error));
    throw error;
  }
}
