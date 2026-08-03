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
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getTemplate } from '../templates/registry.js';
import {
  getJob, isCurrentDispatch, markCompleted, markFailed, markHeld, markRunning, setJobAttempts, setJobCost, setJobHeadline, setJobSummary, setProgress,
} from '../jobs/firestore.js';
import { retryAsync } from '../util/retry.js';
import { releaseJobSlot } from '../jobs/slots.js';
import { degradedNotice, heldNotice } from '../jobs/report-copy.js';
import { deleteObject, downloadObject, uploadObject } from '../storage/gcs.js';
import type { JobFile, JobSummary } from '../jobs/types.js';
import { generateHeadline } from '../jobs/headline.js';
import { createCostSink, emptyCost } from '../cost.js';
import { resolveMode } from '../mode.js';
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
  status: 'completed' | 'failed' | 'incomplete' | 'held';
}

export async function runJob(input: RunJobInput): Promise<RunJobResult> {
  const log = jobLogger({ jobId: input.jobId, appId: input.appId, userId: input.userId, template: input.template });
  // Identifies THIS dispatch, so a duplicate delivery cannot overwrite our
  // checkpoint with its own older view of the run. See `markRunning`.
  const dispatchId = randomUUID();

  /**
   * The only outcome an unexpected throw may have: the job is parked for a person,
   * the slot goes back, and the error propagates.
   */
  const parkAndRethrow = async (error: unknown): Promise<never> => {
    log.error('job.error', { message: (error as Error).stack ?? (error as Error).message ?? String(error) });
    await markHeld(input.jobId, {
      reason: 'run_failed',
      heldAt: new Date().toISOString(),
      spentUsd: 0,
      detail: ((error as Error).message ?? String(error)).slice(0, 500),
    }).catch(() => {});
    await releaseJobSlot(input.jobId).catch(() => {});
    throw error;
  };

  // Dispatch/attempt bookkeeping + resume state.
  //
  // Inside the guard, not before it. `getTemplate` throws on a template retired by
  // a deploy while jobs were queued, and the three Firestore calls throw on any
  // transient blip — all of them ran BEFORE the try whose catch parks the job, so
  // the worker's catch acked a 200 believing an outcome had been recorded while the
  // document still read `queued` with the buyer's only slot held. Nothing then
  // touched it again.
  const prologue = await (async () => {
    const template = getTemplate(input.template);
    if (!template) throw new Error(`Unknown template: ${input.template}`);
    const existing = await getJob(input.jobId);
    const attempts = (existing?.attempts ?? 0) + 1;
    await markRunning(input.jobId, dispatchId);
    await setJobAttempts(input.jobId, attempts);
    return { template, existing, attempts };
  })().catch(parkAndRethrow);

  const { template, existing, attempts } = prologue;
  const finalize = attempts >= config.workflow.maxJobAttempts;
  log.info('job.start', { params: input.params, attempts, finalize });

  // Headline once (first dispatch only).
  let headlineCost = emptyCost();
  if (!existing?.title) {
    // Read outside the try, so a failed headline still reports what it spent.
    const spend = createCostSink();
    try {
      const mode = resolveMode(template.modes, (input.params as Record<string, unknown>).mode).key;
      const language = String((input.params as Record<string, unknown>).language ?? 'en');
      const { headline } = await generateHeadline({ templateName: template.name, params: input.params, mode, language, spend });
      await setJobHeadline(input.jobId, headline);
      log.info('job.headline', { title: headline.title, costUsd: spend.total().usd });
    } catch (err) {
      log.warn('headline.failed', { message: (err as Error).message, costUsd: spend.total().usd });
    }
    headlineCost = spend.total();
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

  // Retried: storage blips are transient, and losing the upload of a report that
  // already ran is the most expensive way to fail — the work is done and paid for.
  const uploadJson = (name: string, data: unknown) =>
    retryAsync(() =>
      uploadObject({ jobId: input.jobId, name, data: JSON.stringify(data, null, 2), contentType: 'application/json; charset=utf-8' }),
    );
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
      // An admin approved this specific job to run past its ceiling. `null` is
      // uncapped; `undefined` (the normal case) lets the engine derive the ceiling
      // from the model's mode.
      ...(existing?.budgetOverride ? { costCeilingUsd: null } : {}),
      onCheckpoint: async (cp) => {
        try {
          // If another dispatch has claimed the job, ours is the stale one: saving
          // would throw away whatever it has finished since.
          if (!(await isCurrentDispatch(input.jobId, dispatchId))) {
            log.warn('checkpoint.skipped', { reason: 'another dispatch owns this job' });
            return;
          }
          await uploadJson(CHECKPOINT, cp);
        } catch (err) {
          log.warn('checkpoint.save_failed', { message: (err as Error).message });
        }
      },
      onProgress: async (p) => {
        log.info('step', { phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound });
        // Best-effort. A rejection here propagates through `emit` into the middle of
        // the research loop, failing the attempt as `stalled` — which by the reuse
        // rule makes the retry re-buy the whole loop. A dashboard line the buyer
        // may never look at must not cost a second round of searches.
        await setProgress(input.jobId, {
          phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound,
          updatedAt: new Date().toISOString(),
        }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
      },
      onTrace: async (trace) => {
        await uploadTrace(trace);
        // Same reason, one wave further out: this is awaited at every wave boundary,
        // so one failed write threw out of the engine and parked a HEALTHY job as
        // `run_failed` — an admin incident where a queue retry would have done.
        await setJobCost(input.jobId, trace.cost).catch((err) =>
          log.warn('cost.save_failed', { message: (err as Error).message }),
        );
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

    // headlineCost is folded into the trace via `baseCost`, so meta.cost already
    // includes it. Best-effort, like every other bookkeeping write here: the figure
    // is also in the trace and the checkpoint, and losing it must not park a job
    // whose research finished.
    await setJobCost(input.jobId, output.meta.cost).catch((err) =>
      log.warn('cost.save_failed', { message: (err as Error).message }),
    );

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
      }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'incomplete' };
    }

    // --- Held: parked for an admin decision. Not finished, not failed. ---
    if (output.trace.status === 'held') {
      const traceFile = await uploadTrace(output.trace);
      const hold = {
        reason: 'budget_exceeded' as const,
        heldAt: new Date().toISOString(),
        spentUsd: output.meta.cost.usd,
        detail: `Passed the per-job ceiling of $${config.workflow.maxJobCostUsd.toFixed(2)}.`,
      };
      // No refund and no checkpoint deletion, both on purpose: the credits are what
      // an approval spends, and the checkpoint is what it resumes from. Nor any
      // report stats — this job has not finished, and booking it now would count it
      // twice when it does.
      await markHeld(input.jobId, hold, traceFile ? [traceFile] : undefined, dispatchId);
      // A parked job is not in flight — it is waiting on us, and holding the
      // buyer's only slot while it waits would lock them out of the product for as
      // long as nobody looks. Idempotent, so a re-dispatch cannot double-release.
      await releaseJobSlot(input.jobId).catch(() => {});
      await setProgress(input.jobId, {
        phase: 'held', message: heldNotice(output.language),
        turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, updatedAt: new Date().toISOString(),
      }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
      log.error('job.held', {
        reason: hold.reason, costUsd: output.meta.cost.usd, limitUsd: config.workflow.maxJobCostUsd, attempts,
      });
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'held' };
    }

    // --- Finished (completed or failed): persist outputs. ---
    // A storage failure here is NOT a failed report: the work ran, it cost what it
    // cost, and the result is still in the checkpoint. Refunding and discarding it
    // (what the outer catch used to do) throws away a report we already paid for.
    // Hold it instead — an admin retry re-uploads it without re-running anything.
    const metadataDoc = {
      jobId: input.jobId, appId: input.appId, userId: input.userId, template: input.template,
      version: output.meta.templateVersion, schemaVersion: output.meta.schemaVersion, params: input.params,
      language: output.language, mode: output.meta.mode, depth: output.meta.depth, generatedAt,
      turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, cost: output.meta.cost,
      status: output.trace.status, attempts,
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
    };
    let report: JobFile;
    let sources: JobFile;
    let meta: JobFile;
    try {
      report = await uploadJson('report.json', { meta: output.meta, report: output.report });
      sources = await uploadJson('sources.json', output.sources);
      meta = await uploadJson('metadata.json', metadataDoc);
    } catch (err) {
      const hold = {
        reason: 'upload_failed' as const,
        heldAt: new Date().toISOString(),
        spentUsd: output.meta.cost.usd,
        detail: `Could not store the report: ${(err as Error).message}`.slice(0, 500),
      };
      await markHeld(input.jobId, hold, undefined, dispatchId);
      await releaseJobSlot(input.jobId).catch(() => {});
      log.error('job.held', {
        reason: hold.reason, costUsd: output.meta.cost.usd, attempts, message: (err as Error).message,
      });
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'held' };
    }

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
    const notice = degradedNotice(output.language, output.meta.degradedSections?.length ?? 0);
    const summary: JobSummary = {
      schemaVersion: output.meta.schemaVersion, language: output.language, mode: output.meta.mode, depth: output.meta.depth,
      turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, reportBytes: report.size ?? 0,
      durationMs, attempts, agents,
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
      ...(agentErrors.length ? { agentErrors } : {}),
      // What the buyer is shown instead of the warnings above.
      ...(notice ? { notice } : {}),
    };
    await setJobSummary(input.jobId, summary).catch((err) => log.warn('summary.save_failed', { message: (err as Error).message }));

    // WARNING for degraded sections, so it's easy to find later.
    if (output.trace.warnings?.length) {
      log.warn('job.degraded', { degradedSections: output.meta.degradedSections, warnings: output.trace.warnings, attempts });
    }
    // Its own ERROR, not folded into the warning above: a job that hit the spend
    // ceiling is an incident (a runaway, or a ceiling set too low), not the ordinary
    // "one agent couldn't finish" degradation.
    if (output.trace.budgetExceeded) {
      log.error('job.budget_exceeded', {
        costUsd: output.meta.cost.usd, limitUsd: config.workflow.maxJobCostUsd,
        degradedSections: output.meta.degradedSections, attempts,
      });
    }

    // A job that could not be assembled does NOT fail and does NOT refund. It goes
    // to the alert state with everything it produced already uploaded, and an admin
    // decides: continue it, refund, top the buyer up, or close it. Every refund in
    // this system is a decision someone made (Javier, 2026-07-31).
    if (output.trace.status === 'failed') {
      const hold = {
        reason: 'run_failed' as const,
        heldAt: new Date().toISOString(),
        spentUsd: output.meta.cost.usd,
        detail: (output.trace.error ?? 'The report could not be assembled.').slice(0, 500),
      };
      await markHeld(input.jobId, hold, files, dispatchId);
      await releaseJobSlot(input.jobId).catch(() => {});
      log.error('job.held', { reason: hold.reason, costUsd: output.meta.cost.usd, attempts, message: output.trace.error });
      return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'held' };
    }

    log.info('job.completed', {
      sourcesFound: output.sources.length, turnsUsed: output.turnsUsed, durationMs, attempts,
      costUsd: output.meta.cost.usd, tokensIn: output.meta.cost.inputTokens, tokensOut: output.meta.cost.outputTokens,
      ...(output.meta.degradedSections ? { degradedSections: output.meta.degradedSections } : {}),
    });
    // If something ended this job while we were running it — the enqueue-failure
    // cleanup is the one that does — the delivery is refused and the work is lost.
    // Losing work we already paid for is the correct outcome next to handing out a
    // report whose credits were refunded.
    if (!(await markCompleted(input.jobId, files, dispatchId))) {
      log.warn('job.completion_refused', { reason: 'the job was already resolved while it was running', attempts });
      await releaseJobSlot(input.jobId).catch(() => {});
      return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'failed' };
    }

    // Only now, and in this order. Booking the stats and deleting the checkpoint
    // BEFORE the delivery check meant a refused delivery still counted a completed
    // report — which the resolution path then counted again as a failure, one job
    // in two rows — and threw away the only copy of work an admin could have
    // resurrected.
    //
    // Stats are booked when a job FINISHES. A held job has not: booking it now and
    // again when it resolves would count one report twice. The resolution path
    // books the ones that end badly (see `/admin/jobs/:id/resolve`).
    try {
      await recordReportStats({
        appId: input.appId, userId: input.userId, template: input.template,
        status: 'completed',
        costUsd: output.meta.cost.usd, durationMs, degraded: !!output.meta.degradedSections,
      });
    } catch (err) {
      log.warn('stats.report_failed', { message: (err as Error).message });
    }
    await deleteObject(input.jobId, CHECKPOINT).catch(() => {}); // the work is delivered

    await releaseJobSlot(input.jobId).catch(() => {});
    return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'completed' };
  } catch (error) {
    // Same rule as the prologue: an unexpected throw parks the job for a person.
    // Nothing here refunds, and the checkpoint is left alone so an approval can
    // resume from it.
    return parkAndRethrow(error);
  }
}
