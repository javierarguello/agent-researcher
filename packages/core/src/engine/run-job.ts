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
 * still failed (logged + flagged as a WARNING on the job) and delivering the rest
 * — or earlier, when the engine finds nothing left that a re-dispatch could still
 * finish (every unfinished step failed the same way on two dispatches, or waits on
 * one that did): then it finalizes on its own and returns 'completed', so this
 * file never sees an 'incomplete' that would only be re-dispatched into the same
 * failure (M-D1).
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getTemplate } from '../templates/registry.js';
import {
  getJob, isCurrentDispatch, markCompleted, markFailed, markHeld, markRunning, setJobAttempts, setJobCost, setJobHeadline, setJobSummary, setProgress,
} from '../jobs/firestore.js';
import { retryAsync } from '../util/retry.js';
import { releaseJobSlot } from '../jobs/slots.js';
import { sectionsNotice } from '../jobs/report-copy.js';
import { deleteObject, downloadObject, uploadObject } from '../storage/gcs.js';
import { hasResearchLoop } from '../templates/types.js';
import type { JobFile, JobHold, JobSummary } from '../jobs/types.js';
import { generateHeadline } from '../jobs/headline.js';
import { createCostSink, emptyCost } from '../cost.js';
import { resolveMode } from '../mode.js';
import { getModelPricing, resolveModeCeiling } from '../credits/pricing.js';
import { recordPromptEcho, recordReportStats } from '../stats/store.js';
import { jobLogger } from '../obs/log.js';
import { runResearch, type Checkpoint, type JobTrace } from './research-engine.js';

const CHECKPOINT = 'checkpoint.json';

/**
 * The ceiling as an admin should read it.
 *
 * The `null` branch is DEFENSIVE, not a scenario. `null` means an approved,
 * uncapped job — and `createCostSink` reports `exceeded: false` when there is no
 * maximum, so an uncapped job can never take the budget-hold path this string is
 * written for. It stays because `.toFixed()` on `null` is a TypeError, and because
 * a future caller could reach here with one; it has no test on purpose, since a
 * test would have to invent a state the engine cannot produce.
 */
function ceilingText(ceilingUsd: number | null | undefined): string {
  if (ceilingUsd == null) return 'Passed the per-job cost ceiling.';
  // Two decimals replaced a WRONG number with a meaningless one: the catalog case
  // this whole fix exists for is a mode declaring `maxCostUsd: 0.002`, which
  // printed "$0.00" next to a spend figure the admin then could not reconcile.
  const shown = ceilingUsd < 0.01 ? ceilingUsd.toPrecision(2) : ceilingUsd.toFixed(2);
  return `Passed the per-job ceiling of $${shown}.`;
}

export interface RunJobInput {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  params: Record<string, unknown>;
  /**
   * The instant (epoch ms) after which this dispatch stops STARTING agents,
   * checkpoints, and returns `incomplete` for the queue to resume.
   *
   * The worker passes `requestStart + config.workflow.dispatchBudgetSeconds`,
   * because the clock that matters starts when the REQUEST arrives, not when the
   * engine does — the headline call and the checkpoint download happen in between.
   * Omitted (the CLI, the tests that do not care) = no deadline, i.e. what every
   * dispatch did until now: run to the end and let Cloud Run kill it mid-agent.
   */
  deadlineAt?: number;
}

export interface RunJobResult {
  files: JobFile[];
  reportBytes: number;
  sourcesFound: number;
  /**
   * 'incomplete'  → the worker returns a retryable status so the queue resumes it.
   * 'superseded'  → this run's outcome was REFUSED: another dispatch owns the job,
   *                 or someone already resolved it. Either way nothing this run
   *                 decided was recorded, and the worker must ACK it. Returning
   *                 'incomplete' here made the queue re-dispatch the stale task,
   *                 which then took ownership from the live run — and the cycle
   *                 repeats, each turn of it a paid pass over whatever the
   *                 checkpoint had not finished.
   */
  status: 'completed' | 'failed' | 'incomplete' | 'held' | 'superseded';
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
    // The FIFTH park, and it was left behind when the other four were routed
    // through `park()`. Same defect: it discarded `markHeld`'s answer and released
    // the slot regardless, so a run whose park was REFUSED — because the job had
    // already been resolved, or belongs to a newer dispatch — handed back a slot
    // that was not its own, and the buyer could start a second report while the
    // first was still running.
    //
    // `markHeld` refuses a resolved job even with no `dispatchId` (the status check
    // is unconditional), so the refusal this catches is reachable from the outer
    // catch, which is where a straggler's throw lands.
    const parked = await markHeld(input.jobId, {
      reason: 'run_failed',
      heldAt: new Date().toISOString(),
      spentUsd: 0,
      detail: ((error as Error).message ?? String(error)).slice(0, 500),
    }).catch(() => false);
    if (parked) await releaseJobSlot(input.jobId).catch(() => {});
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
  //
  // A failure here used to be a warning and nothing else, which meant `resume`
  // stayed undefined and the engine started from zero — RE-BUYING the whole
  // report. On a corrupted checkpoint that repeats on every dispatch, so one bad
  // object costs up to `maxJobAttempts` full reports and only ever logs a warn.
  //
  // A MISSING object is not a failure and never means corruption: it is what a
  // first dispatch looks like, and also what a second one looks like when no agent
  // finished on the first (nothing was saved because nothing was done — and
  // restarting from zero costs nothing extra, because zero is where it was).
  //
  // An object that is THERE and cannot be read is the corruption case, and the
  // expensive one: it repeats on every dispatch, so the job silently re-buys the
  // whole report up to `maxJobAttempts` times.
  let resume: Checkpoint | undefined;
  try {
    const raw = await downloadObject(input.jobId, CHECKPOINT);
    if (raw) {
      try {
        resume = JSON.parse(raw) as Checkpoint;
      } catch (err) {
        log.error('checkpoint.unreadable', { message: (err as Error).message, attempts });
        // Park it. Someone can approve it — which re-runs from zero deliberately —
        // or close it. Either is a decision, and both beat paying for the report
        // again, seven more times, behind a warn line.
        return parkAndRethrow(
          new Error(`Could not resume: the checkpoint is unreadable (${(err as Error).message}).`),
        );
      }
      log.info('job.resume', { doneAgents: resume.doneAgentIds.length });
    }
  } catch (err) {
    // A download that THREW is transient (storage blipped), not corruption: the
    // object may well be fine next dispatch, and parking on it would turn a blip
    // into a job that waits for a human.
    log.warn('checkpoint.load_failed', { message: (err as Error).message });
  }

  // Retried: storage blips are transient, and losing the upload of a report that
  // already ran is the most expensive way to fail — the work is done and paid for.
  /**
   * Is this dispatch still the one the job belongs to?
   *
   * Latched: a dispatch that has lost the job never regains it, so once the answer
   * is no it is no forever and costs nothing to ask again. That is what lets the
   * chatty callers consult it without a Firestore read each.
   */
  // Did this dispatch manage to WRITE a checkpoint?
  //
  // The load path treats a missing object as normal, and its comment says so. What
  // that reasoning does not cover is a dispatch where saves were ATTEMPTED and
  // every one failed: the next dispatch finds no object, starts from zero, and
  // re-buys everything this one paid for — behind a `warn`, repeating per agent
  // per dispatch, up to `maxJobAttempts` times.
  //
  // Measured, not assumed: the engine checkpoints at every wave boundary, so an
  // incomplete dispatch has always attempted at least one save (even one where no
  // agent succeeded — it saves the empty state). `checkpointsSaved === 0` at that
  // point therefore already means "every attempt failed". `checkpointsFailed > 0`
  // is kept as the statement of what is actually wrong, and so this stays correct
  // if a future path ever reaches the branch having attempted nothing — but no
  // test can separate the two clauses today, and none pretends to.
  let checkpointsSaved = 0;
  let checkpointsFailed = 0;

  let knownStale = false;
  const stillOurs = async (): Promise<boolean> => {
    if (knownStale) return false;
    const ours = await isCurrentDispatch(input.jobId, dispatchId).catch(() => true);
    if (!ours) knownStale = true;
    return ours;
  };

  /**
   * Park the job and hand the buyer's slot back — but only if the park STUCK.
   *
   * `markHeld` refuses a dispatch that no longer owns the job, and refuses one
   * whose job somebody already resolved. Its answer was discarded at all four call
   * sites, and what follows a park is not bookkeeping: `releaseJobSlot` keys on the
   * job's `slotHeld` flag and not on the dispatch, so a REFUSED park still freed
   * the live run's slot and the buyer could start a second report while the first
   * was going. The callers then wrote a `held` progress line over a job that was
   * still running, and told the worker `held` about an outcome nobody recorded.
   *
   * The `stillOurs()` gates above make this a race rather than the common case —
   * they are checked before the engine's uploads, and a re-dispatch can land in the
   * window between. Returns false when the caller must report `superseded` instead.
   */
  const park = async (hold: JobHold, files?: JobFile[]): Promise<boolean> => {
    if (await markHeld(input.jobId, hold, files, dispatchId)) {
      // A parked job is not in flight — it is waiting on us, and holding the
      // buyer's only slot while it waits would lock them out of the product for as
      // long as nobody looks. Idempotent, so a re-dispatch cannot double-release.
      await releaseJobSlot(input.jobId).catch(() => {});
      return true;
    }
    knownStale = true; // nothing else this run writes speaks for the job either
    log.warn('hold.refused', {
      reason: 'another dispatch owns this job, or it was already resolved',
      wouldHaveBeen: hold.reason,
    });
    return false;
  };

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

    // Resolved HERE, not in the engine, because this is the only place that knows
    // the model's live pricing: the per-mode credits, the credit floor read off
    // Stripe, and the expected profit. Read per job on purpose — a price change has
    // to reach the next job, not the next deploy. A Firestore blip falls back to the
    // engine's own derivation rather than failing the job.
    const jobMode = resolveMode(template.modes, (input.params as Record<string, unknown>).mode);
    const modelPricing = await getModelPricing(input.template).catch(() => null);
    const ceilingUsd = resolveModeCeiling(modelPricing, jobMode.config, jobMode.key, config.workflow.maxJobCostUsd);
    log.info('job.ceiling', { mode: jobMode.key, ceilingUsd });

    const output = await runResearch({
      template,
      params: input.params,
      jobId: input.jobId,
      generatedAt,
      resume,
      finalize,
      ...(input.deadlineAt != null ? { deadlineAt: input.deadlineAt } : {}),
      // Fold headline cost into the trace so it's checkpointed and survives resumes
      // (nonzero only on the first dispatch; already carried in `resume.cost` after).
      baseCost: headlineCost,
      // The ceiling this job runs under, resolved HERE because this is the only
      // place that knows all three inputs: the Firestore per-model credit override,
      // the credit floor the live Stripe packs imply, and the expected profit. The
      // engine's own fallback is the deployment-wide number, which is right for a
      // direct caller (a test, the CLI) and wrong for a paid job — the ceiling has
      // to follow the PRICE, or a re-priced model stays guarded by its old one.
      //
      // An admin approval still wins: `null` is uncapped, and it is what "continue
      // this job past its ceiling" means.
      ...(existing?.budgetOverride ? { costCeilingUsd: null } : { costCeilingUsd: ceilingUsd }),
      onCheckpoint: async (cp) => {
        try {
          // If another dispatch has claimed the job, ours is the stale one: saving
          // would throw away whatever it has finished since.
          if (!(await stillOurs())) {
            log.warn('checkpoint.skipped', { reason: 'another dispatch owns this job' });


    // The guard removed our own prompt from a write. Booked as an INCIDENT and
    // never as a strike: the buyer's own text is refused and struck by the
    // moderation path before a job exists, so a leak reaching a model here came from
    // a page, and they are the person it happened to. Best-effort — a stats blip
    // must not fail a report the buyer paid for.
    for (const echo of output.promptEchoes ?? []) {
      await recordPromptEcho({ appId: input.appId, userId: input.userId, agentId: echo.agentId, fields: echo.fields })
        .catch((err) => log.warn('stats.prompt_echo_failed', { message: (err as Error).message }));
      log.warn('report.prompt_echo', { agentId: echo.agentId, fields: echo.fields });
    }            return;
          }
          await uploadJson(CHECKPOINT, cp);
          checkpointsSaved += 1;
        } catch (err) {
          checkpointsFailed += 1;
          // ERROR once nothing at all has landed: at that point every agent this
          // dispatch finishes is work the next one will pay for again.
          const at = checkpointsSaved === 0 && checkpointsFailed > 1 ? 'error' : 'warn';
          log[at]('checkpoint.save_failed', {
            message: (err as Error).message, saved: checkpointsSaved, failed: checkpointsFailed,
          });
        }
      },
      onProgress: async (p) => {
        log.info('step', { phase: p.phase, message: p.message, turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound });
        // No read of its own: progress fires constantly and a Firestore read per
        // line would cost more than the field is worth. It rides the latch the
        // wave-boundary checks set — once a dispatch is stale it stays stale.
        if (knownStale) return;
        // Best-effort. A rejection here propagates through `emit` into the middle of
        // the research loop, failing the attempt as `stalled` — which by the reuse
        // rule makes the retry re-buy the whole loop. A dashboard line the buyer
        // may never look at must not cost a second round of searches.
        await setProgress(input.jobId, {
          phase: p.phase, message: p.message, kind: p.kind, ...(p.detail ? { detail: p.detail } : {}),
          turnsUsed: p.turnsUsed, sourcesFound: p.sourcesFound,
          updatedAt: new Date().toISOString(),
        }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
      },
      onTrace: async (trace) => {
        // The trace and the cost are the job's DASHBOARD. A stale dispatch used to
        // overwrite both with its own older numbers while the live one was running,
        // so an admin read a cost and a per-agent history that belonged to a run
        // that had already been superseded. Checked here rather than per progress
        // line: this fires at wave boundaries, so it is a handful of reads.
        if (!(await stillOurs())) return;
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

    // Everything from here writes the job's OUTCOME, and a dispatch that no longer
    // owns the job has no business writing one. The delivery path was guarded and
    // the other three exits were not: the final `setJobCost` — the authoritative
    // write of the field the admin reads as the job's cost — the `incomplete`
    // progress line, and the entire `held` branch, which uploads a trace, parks the
    // job, and releases the buyer's concurrency slot.
    //
    // `releaseJobSlot` is the expensive one. It keys on the job's `slotHeld` flag,
    // not on the dispatch, so a stale run hitting its ceiling freed the LIVE run's
    // slot and the buyer could start a second report while the first was still
    // going. Idempotent, so no negative counter — the cap is simply gone for the
    // rest of the run.
    if (!(await stillOurs())) {
      log.warn('outcome.skipped', { reason: 'another dispatch owns this job', traceStatus: output.trace.status });
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
    }

    // headlineCost is folded into the trace via `baseCost`, so meta.cost already
    // includes it. Best-effort, like every other bookkeeping write here: the figure
    // is also in the trace and the checkpoint, and losing it must not park a job
    // whose research finished.
    await setJobCost(input.jobId, output.meta.cost).catch((err) =>
      log.warn('cost.save_failed', { message: (err as Error).message }),
    );

    // --- Incomplete: some steps still pending → resume on the next dispatch. ---
    if (output.trace.status === 'incomplete') {
      // …except there is nothing to resume FROM. Every save was attempted and every
      // one failed, so the next dispatch starts from zero and re-buys the agents
      // this one already paid for — and so does the one after that, up to
      // `maxJobAttempts`. This is the same money `checkpoint.unreadable` parks for,
      // reached from the write side instead of the read side.
      //
      // An approval re-runs from zero deliberately, which is the right call to
      // make once, by a person who can also look at why storage is refusing us.
      if (checkpointsSaved === 0 && checkpointsFailed > 0) {
        const hold = {
          reason: 'run_failed' as const,
          heldAt: new Date().toISOString(),
          // The real figure, not a zero. This job spent money and an admin decides
          // what to do about it; `parkAndRethrow` reports 0 because the paths it
          // serves park before anything has run.
          spentUsd: output.meta.cost.usd,
          detail:
            `Could not save a checkpoint (${checkpointsFailed} attempt(s) failed), so there is nothing to ` +
            `resume from. Approving re-runs the whole report from zero.`,
        };
        if (!(await park(hold))) {
          return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
        }
        await setProgress(input.jobId, {
          // English and internal, like every other `message`: the buyer reads the
          // KIND, localized by their client.
          phase: 'held', message: 'Held for review; nothing more is being spent.', kind: 'held',
          turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, updatedAt: new Date().toISOString(),
        }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
        log.error('job.held', {
          reason: hold.reason, costUsd: output.meta.cost.usd, attempts,
          message: 'every checkpoint save failed; a re-dispatch would restart from zero',
        });
        return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'held' };
      }
      log.warn('job.incomplete', {
        attempts,
        pending: output.trace.agents.filter((a) => a.status !== 'ok').map((a) => a.id),
        message: 'Some steps failed; will retry on re-dispatch.',
      });
      await setProgress(input.jobId, {
        phase: 'incomplete', message: `Partial (attempt ${attempts}); retrying pending steps.`, kind: 'incomplete',
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
        // The ceiling THIS run enforced — the model's mode ceiling, or the
        // deployment default only when the mode declares none. Reporting the
        // default regardless told an admin "$20.00" about a catalog model stopped
        // at half a cent.
        detail: ceilingText(output.trace.costCeilingUsd),
      };
      // No refund and no checkpoint deletion, both on purpose: the credits are what
      // an approval spends, and the checkpoint is what it resumes from. Nor any
      // report stats — this job has not finished, and booking it now would count it
      // twice when it does.
      if (!(await park(hold, traceFile ? [traceFile] : undefined))) {
        return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
      }
      await setProgress(input.jobId, {
        phase: 'held', message: 'Held for review; nothing more is being spent.', kind: 'held',
        turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, updatedAt: new Date().toISOString(),
      }).catch((err) => log.warn('progress.save_failed', { message: (err as Error).message }));
      log.error('job.held', {
        reason: hold.reason, costUsd: output.meta.cost.usd, limitUsd: output.trace.costCeilingUsd, attempts,
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
      ...(output.meta.sections ? { sections: output.meta.sections } : {}),
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
    };
    // Nothing is DELIVERED by a dispatch that no longer owns the job.
    //
    // `markCompleted` refuses one, which is what stops the job document going
    // backwards — but the artifacts are written before that call, so a stale run
    // still overwrote `report.json` with its older report and then deleted the
    // checkpoint the live run was resuming from. The refusal came too late to
    // matter.
    // Re-read, not a re-use of the check above: the uploads and the engine's
    // finalize sit between them, and that window is exactly when a re-dispatch
    // happens.
    if (!(await stillOurs())) {
      log.warn('delivery.skipped', { reason: 'another dispatch owns this job' });
      return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
    }

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
      if (!(await park(hold))) {
        return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
      }
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
      // What the loop actually did. Six fields went out and neither of these was
      // among them, so `ok · 1 try · $0.38` was all an admin could see of an agent
      // that searched nothing (R7-30). Written only when there was a loop —
      // a synthesizer has none, and `0 · —` would read as a failure.
      ...(a.turnsUsed ? { turnsUsed: a.turnsUsed } : {}),
      ...(a.gatherStop ? { gatherStop: a.gatherStop } : {}),
      // …and WHAT it is, which is the reason `AgentTrace.kind` was added — "so an
      // admin can see why an agent has no turns: it is a writer". It reached the
      // trace and no screen (round 8, R8-27): without it the Agents table prints the
      // same `—` for a synthesizer that has no loop and a producer whose loop never
      // ran, and those are different conversations.
      ...(a.kind ? { kind: a.kind } : {}),
      // …and whether it had a loop at all, which `kind` cannot say for a refiner.
      ...(a.kind ? { hadLoop: hasResearchLoop({ role: a.role }) } : {}),
    }));
    const agentErrors = output.trace.agents
      .filter((a) => a.status === 'failed')
      .map((a) => ({ agentId: a.id, error: ((a.error ?? '').split('\n')[0] ?? '').slice(0, 500) }));
    const notice = sectionsNotice(output.language, output.meta.sections ?? []);
    const summary: JobSummary = {
      schemaVersion: output.meta.schemaVersion, language: output.language, mode: output.meta.mode, depth: output.meta.depth,
      turnsUsed: output.turnsUsed, sourcesFound: output.sources.length, reportBytes: report.size ?? 0,
      durationMs, attempts, agents,
      ...(output.trace.warnings ? { warnings: output.trace.warnings } : {}),
      ...(output.meta.sections ? { sections: output.meta.sections } : {}),
      ...(agentErrors.length ? { agentErrors } : {}),
      // What the buyer is shown instead of the warnings above.
      ...(notice ? { notice } : {}),
    };
    await setJobSummary(input.jobId, summary).catch((err) => log.warn('summary.save_failed', { message: (err as Error).message }));

    // WARNING for degraded sections, so it's easy to find later.
    if (output.trace.warnings?.length) {
      log.warn('job.degraded', { sections: output.meta.sections, warnings: output.trace.warnings, attempts });
    }
    // Its own ERROR, not folded into the warning above: a job that hit the spend
    // ceiling is an incident (a runaway, or a ceiling set too low), not the ordinary
    // "one agent couldn't finish" degradation.
    if (output.trace.budgetExceeded) {
      log.error('job.budget_exceeded', {
        costUsd: output.meta.cost.usd, limitUsd: output.trace.costCeilingUsd,
        sections: output.meta.sections, attempts,
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
      if (!(await park(hold, files))) {
        return { files: [], reportBytes: 0, sourcesFound: output.sources.length, status: 'superseded' };
      }
      log.error('job.held', { reason: hold.reason, costUsd: output.meta.cost.usd, attempts, message: output.trace.error });
      return { files, reportBytes: report.size ?? 0, sourcesFound: output.sources.length, status: 'held' };
    }

    log.info('job.completed', {
      sourcesFound: output.sources.length, turnsUsed: output.turnsUsed, durationMs, attempts,
      costUsd: output.meta.cost.usd, tokensIn: output.meta.cost.inputTokens, tokensOut: output.meta.cost.outputTokens,
      ...(output.meta.sections ? { sections: output.meta.sections } : {}),
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
        costUsd: output.meta.cost.usd, durationMs,
        // `lost` only. This feeds the admin's "Degraded / partial delivery" KPI —
        // the number someone acts on — and `!!output.meta.sections` counted a
        // report that lost nothing and had one shallow refiner as a partial
        // delivery. The whole point of the two statuses is that they are not the
        // same event; this was the one place left collapsing them.
        degraded: !!output.meta.sections?.some((s) => s.status === 'lost'),
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
