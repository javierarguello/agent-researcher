/**
 * The research engine = a generic executor for a template's agent workflow.
 *
 * A template declares typed sections + an agent DAG. This runs the DAG wave by
 * wave (parallel within a wave, capped for Vertex quota), sharing one evidence
 * store, and merges each agent's validated JSON slice into the report — an
 * incremental, typed object. `sources` and other `derived` sections are filled
 * deterministically at the end.
 */
import { z } from 'zod';
import { config } from '../config.js';
import { BudgetExceededError, addCost, createCostSink, emptyCost, type Cost, type CostSink } from '../cost.js';
import { resolveDepthProfile, type DepthProfile } from '../depth.js';
import { maxCostForMode, resolveMode } from '../mode.js';
import { resolveModel, type ResolvedModel } from '../llm/index.js';
import type { ExtractedPage, SearchResult } from '../tools/web-search.js';
import {
  reportSchemaOf,
  sectionByKey,
  sectionSubsetSchema,
  type AgentSpec,
  type ReportSection,
  type ResearchTemplate,
} from '../templates/types.js';
import { degradedSectionNote } from '../jobs/report-copy.js';
import { normalizeSectionStatuses, type SectionStatus } from './section-status.js';
import { createEvidence, gather, gatherCompleted, type Evidence } from './gather.js';
import { synthesizeStructured } from './synthesize.js';
import {
  buildAgentKickoff,
  buildEnricherSynthPrompt,
  buildProducerSynthPrompt,
  buildSynthesizerPrompt,
  buildSystemPrompt,
  isLanguage,
  MAX_HANDOFF_CHARS,
  type Language,
} from './prompt.js';

/**
 * The key an agent writes its handoff under, alongside its sections.
 *
 * Underscored and stripped before the slice is merged: it is a message between
 * steps, not part of the report, and a report that suddenly grew a `_handoff`
 * section would break every consumer of the schema contract.
 */
const HANDOFF_KEY = '_handoff';

export interface ResearchProgress {
  /** Agent id, or a lifecycle phase ('planning' | 'assembling' | 'done'). */
  phase: string;
  message: string;
  turnsUsed: number;
  sourcesFound: number;
}

export interface ReportMeta {
  title: string;
  template: string;
  templateVersion: number;
  /** `${templateId}@${version}` — the consumer-facing schema contract id. */
  schemaVersion: string;
  jobId: string;
  language: Language;
  /** Public mode used ('essential' | 'comprehensive'). */
  mode: string;
  /** Internal prose depth the mode mapped to ('light' | 'standard' | 'deep'). */
  depth: string;
  generatedAt: string;
  contentFormat: 'markdown';
  /** Total cost of the report (LLM exact + search estimate). */
  cost: Cost;
  /**
   * Sections with something to report, by SECTION KEY (not agent id).
   *
   *   - `lost` — nothing wrote it, so it holds a localized placeholder. Both
   *     renderers key on this to SUPPRESS the body; that is load-bearing.
   *   - `unenriched` — a producer wrote it and a refiner meant to deepen it never
   *     finished. The content is real and MUST still be rendered; what the buyer
   *     got is less depth than the tier they paid for.
   *
   * This replaced `degradedSections`, a list of strings that could only say "lost"
   * — so `unenriched` was invisible: an admin warning and nothing else, and a
   * comprehensive report whose four enrich passes all failed shipped as complete,
   * at full price, with the buyer never told.
   *
   * NOT the manifest's `sections` (key + title, every section, for rendering).
   * This one carries only what went wrong, and `status` leaves room for a third
   * state without another parallel list to keep in step.
   */
  sections?: SectionStatus[];
}

export type { SectionStatus };

/** Per-agent execution record — what it did, produced, and any error. */
export interface AgentTrace {
  id: string;
  role: AgentSpec['role'];
  /** 1-based wave the agent ran in. */
  wave: number;
  produces: string[];
  enriches: string[];
  /** Resolved model aliases (not concrete ids). */
  model: string;
  gatherModel?: string;
  status: 'running' | 'ok' | 'failed' | 'pending';
  turnsUsed: number;
  /** How many times this agent was attempted this run (in-run retries). */
  attempts: number;
  /** Wall-clock time the agent took (ms), when finished. */
  durationMs?: number;
  /** LLM + search cost incurred by this agent. */
  cost: Cost;
  /** Chronological progress notes (searches, fetches, retry reasons) — capped. */
  notes: string[];
  /** The agent's validated JSON slice (on success). */
  output?: unknown;
  /** Last error message/stack (on failure) — the reason it couldn't complete. */
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** Full, diagnosable trace of a job — persisted to `trace.json` (also on failure). */
export interface JobTrace {
  jobId: string;
  template: string;
  templateVersion: number;
  language: Language;
  brief: string;
  waves: string[][];
  agents: AgentTrace[];
  /** Running total cost across all agents (LLM exact + search estimate). */
  cost: Cost;
  /**
   * 'incomplete' = some steps still failing; the job will be re-dispatched to resume.
   * 'held'       = parked for an admin decision; the checkpoint is intact and an
   *                approval resumes it. Never reached by retrying.
   */
  status: 'running' | 'completed' | 'failed' | 'incomplete' | 'held';
  /** Job-level fatal error (e.g. final schema validation), if any. */
  error?: string;
  /** Warnings worth reviewing later (e.g. sections degraded after exhausting retries). */
  warnings?: string[];
  /** Set when the job hit its USD ceiling and stopped spending. */
  budgetExceeded?: boolean;
  /**
   * The ceiling this run actually enforced, in USD — `null` when uncapped (an
   * approved job).
   *
   * Carried because the deployment default is NOT the number: the ceiling comes
   * from the MODEL's mode (`maxCostForMode`), falling back to
   * `config.workflow.maxJobCostUsd`. `run-job` reported the fallback to the admin
   * regardless, so a catalog model declaring `maxCostUsd: 0.002` produced "passed
   * the per-job ceiling of $20.00" on a job stopped at half a cent.
   */
  costCeilingUsd?: number | null;
  /** Total wall-clock time so far (ms). */
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
}

/** Resumable checkpoint of a run (persisted so a re-dispatch continues, not restarts). */
export interface Checkpoint {
  report: Record<string, unknown>;
  /** Evidence sources gathered so far (for the derived `sources` section). */
  sources: SearchResult[];
  /**
   * Page bodies already fetched. Carried so a re-dispatch does not BUY THEM AGAIN:
   * `sources` alone survived, so every resumed dispatch re-fetched every page — the
   * most expensive call in the loop, for text we already had (C2).
   *
   * Capped: a long job can fetch far more pages than any prompt renders, and the
   * checkpoint is written after every agent. Oldest are dropped, so a re-dispatch
   * may still re-fetch an old page — a cache miss, not a correctness problem.
   */
  extracted?: ExtractedPage[];
  /** Agent ids already completed — skipped on resume. */
  doneAgentIds: string[];
  /** What each finished agent reported to the steps after it, by agent id. */
  handoffs?: Record<string, string>;
  /** Section statuses so far — see `ReportMeta.sections`. */
  degraded: SectionStatus[];
  /** Traces of agents already completed on prior dispatches — restored so the final
   *  trace/summary reflects the WHOLE run, not just the last resumed dispatch. */
  agentTraces?: AgentTrace[];
  /** Accumulated cost across prior dispatches (agents + headline) — restored so the
   *  final job cost isn't undercounted to just the last dispatch's steps. */
  cost?: Cost;
}

export interface ResearchOutput {
  /** The typed report, keyed by section key. */
  report: Record<string, unknown>;
  meta: ReportMeta;
  sources: SearchResult[];
  language: Language;
  turnsUsed: number;
  /** Diagnosable per-agent trace (output + errors + timing + attempts). */
  trace: JobTrace;
  /** Current resumable state (persist when status is 'incomplete'). */
  checkpoint: Checkpoint;
}

export interface RunResearchInput {
  template: ResearchTemplate<any>;
  params: Record<string, unknown>;
  jobId: string;
  generatedAt: string;
  onProgress?: (p: ResearchProgress) => void | Promise<void>;
  /** Called with a trace snapshot after each wave + at the end (persist it). */
  onTrace?: (trace: JobTrace) => void | Promise<void>;
  /** Prior checkpoint to resume from (skip done agents, keep their output). */
  resume?: Checkpoint;
  /** When true, degrade any still-failing steps and finalize; else return 'incomplete'. Default true. */
  finalize?: boolean;
  /** Called after each agent completes, to persist the resumable checkpoint. */
  onCheckpoint?: (cp: Checkpoint) => void | Promise<void>;
  /** Cost incurred outside the engine (e.g. headline) folded into the trace on the
   *  first dispatch, so it's carried in the checkpoint and not lost across resumes. */
  baseCost?: Cost;
  /**
   * Per-job USD ceiling override. `undefined` = derive it from the model's mode
   * (`maxCostForMode`), which is the normal path. `null` = uncapped, which is what
   * an admin approval means: this specific job was judged worth finishing.
   */
  costCeilingUsd?: number | null;
}

/** Max notes kept per agent (bounds trace size). */
const MAX_NOTES = 300;

/**
 * Page bodies carried in the checkpoint. Generous next to what any prompt renders
 * (14), because the point is to avoid re-buying them, and mean next to what a long
 * job can fetch — the checkpoint is re-uploaded after every agent.
 */
const CHECKPOINT_MAX_PAGES = 60;


export async function runResearch(input: RunResearchInput): Promise<ResearchOutput> {
  const { template, params, jobId, generatedAt, onProgress, onTrace } = input;

  const langRaw = (params as Record<string, unknown>).language;
  const language: Language = isLanguage(langRaw) ? langRaw : 'en';

  // Resolve the public mode → internal budget/section/depth config, then derive
  // the effective (mode-filtered) template + params used for the rest of the run.
  const mode = resolveMode(template.modes, (params as Record<string, unknown>).mode);
  const effParams: Record<string, unknown> = { ...params, ...(mode.config.params ?? {}) };
  const exclude = new Set(mode.config.exclude ?? []);
  const effTemplate: ResearchTemplate<any> = {
    ...template,
    sections: template.sections.filter((s) => !exclude.has(s.key)),
    agents: template.agents
      .map((a) => ({
        ...a,
        produces: (a.produces ?? []).filter((k) => !exclude.has(k)),
        enriches: (a.enriches ?? []).filter((k) => !exclude.has(k)),
      }))
      .filter((a) => a.produces.length + a.enriches.length > 0),
  };
  const depth: DepthProfile = { ...resolveDepthProfile(mode.config.depth), budgetScale: mode.config.budgetScale };

  const system = buildSystemPrompt(effTemplate, effParams);
  const brief = effTemplate.buildBrief(effParams as never);

  const evidence = createEvidence();
  const report: Record<string, unknown> = { ...(input.resume?.report ?? {}) };
  // Coerced, not spread: a job HELD before the `degraded: string[]` -> `SectionStatus[]`
  // rename keeps its checkpoint on purpose, and resumes here after it. Spreading
  // carried the old strings straight into `meta.sections`, where nothing matched
  // `'lost'` and the fabricated placeholder shipped in both renderers with no
  // notice. See `section-status.ts`.
  const degraded: SectionStatus[] = normalizeSectionStatuses(input.resume?.degraded);
  // What each finished agent told the ones after it. Carried in the checkpoint, so
  // a resumed dispatch does not hand later steps an empty summary of the work its
  // predecessors already did.
  const handoffs: Record<string, string> = { ...(input.resume?.handoffs ?? {}) };
  const done = new Set<string>(input.resume?.doneAgentIds ?? []);
  const warnings: string[] = [];
  const counter = { turns: 0 };
  const finalize = input.finalize ?? true;

  // Seed evidence sources from the checkpoint (feeds the derived `sources` section).
  for (const s of input.resume?.sources ?? []) {
    if (s.url && !evidence.seenUrls.has(s.url)) {
      evidence.seenUrls.add(s.url);
      evidence.sources.push(s);
    }
  }
  // …and the page bodies, so `fetch_page` hits the shared cache instead of paying
  // again for text this job already downloaded.
  for (const p of input.resume?.extracted ?? []) {
    if (p.url && p.ok && p.content && !evidence.extractedUrls.has(p.url)) {
      evidence.extractedUrls.add(p.url);
      evidence.extracted.push(p);
    }
  }

  const waves = topoSortAgents(effTemplate);
  const producers = producerOf(effTemplate);
  const byId = new Map(effTemplate.agents.map((a) => [a.id, a]));

  // The job's one accumulator, and the thing the ceiling is checked against. Seeded
  // with what earlier dispatches spent (carried in the checkpoint) — a per-dispatch
  // ceiling would be no ceiling at all, since a job gets re-dispatched 8 times.
  // Per-attempt sinks are `child()`ren of this: they scope an attempt's slice for
  // the agent trace while the job total stays in a single place.
  // Per MODEL and mode, not per deployment: this is a catalog, and a cheap scan
  // and a deep multi-agent report cannot share one number. An explicit override
  // (an admin approval) wins over both.
  const ceilingUsd =
    input.costCeilingUsd === undefined
      ? maxCostForMode(mode.config, config.workflow.maxJobCostUsd)
      : input.costCeilingUsd;
  const jobSpend = createCostSink({
    maxUsd: ceilingUsd,
    seed: addCost(input.resume?.cost ?? emptyCost(), input.baseCost ?? emptyCost()),
  });

  const trace: JobTrace = {
    jobId,
    template: template.id,
    templateVersion: template.version,
    language,
    brief,
    waves: waves.map((w) => w.map((a) => a.id)),
    // Restore prior dispatches' agent traces + accumulated cost so the final trace,
    // summary, and job cost reflect the WHOLE run — not just this resumed dispatch.
    agents: [...(input.resume?.agentTraces ?? [])],
    cost: jobSpend.total(),
    // Recorded even on a run that never approaches it: whoever reads this trace —
    // an admin deciding on a hold — needs the number the engine actually enforced,
    // not the one the deployment happens to default to.
    costCeilingUsd: ceilingUsd,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  let fatalError: string | undefined;

  const emit = async (phase: string, message: string) =>
    onProgress?.({ phase, message, turnsUsed: counter.turns, sourcesFound: evidence.sources.length });
  const persistTrace = async () => onTrace?.(trace);
  // Slim agent traces for the checkpoint: drop `output` (already in `report`) and
  // `notes` to keep checkpoint.json small; keep status/cost/timing for the summary.
  const slimAgents = (): AgentTrace[] => trace.agents.map((a) => ({ ...a, output: undefined, notes: [] }));
  const snapshot = (): Checkpoint => ({
    report,
    sources: evidence.sources,
    extracted: evidence.extracted.slice(-CHECKPOINT_MAX_PAGES),
    doneAgentIds: [...done],
    handoffs,
    degraded,
    agentTraces: slimAgents(),
    cost: trace.cost,
  });

  // Checkpoint writes are last-writer-wins in storage, and a wave finishes several
  // agents concurrently — so two overlapping saves can land in the wrong order and
  // the older snapshot wins, dropping a finished agent (it re-runs, and its spend is
  // lost) on the next dispatch. Serialize them, and coalesce: a snapshot is
  // cumulative, so when one is already queued a second is pure duplication.
  let chain: Promise<unknown> = Promise.resolve();
  let queued: Promise<void> | undefined;
  const saveCheckpoint = (): Promise<void> => {
    const write = input.onCheckpoint;
    if (!write) return Promise.resolve();
    if (queued) return queued;
    const next = chain.then(() => {
      queued = undefined; // built when it RUNS, so it carries the newest state
      return write(snapshot());
    });
    queued = next.then(() => undefined);
    chain = next.catch(() => undefined); // a failed save must not stop later ones
    return queued;
  };

  await emit('planning', `Starting workflow [${mode.key}]: ${effTemplate.agents.length} agents (${done.size} already done).`);

  for (const [w, wave] of waves.entries()) {
    const todo = wave.filter((a) => !done.has(a.id));
    if (!todo.length) continue;
    await emit('planning', `Wave ${w + 1}/${waves.length}: ${todo.map((a) => a.id).join(', ')}.`);
    await runPool(todo, config.llm.maxConcurrentAgents, async (agent) => {
      const at: AgentTrace = {
        id: agent.id,
        role: agent.role,
        wave: w + 1,
        produces: agent.produces ?? [],
        enriches: agent.enriches ?? [],
        model: agent.model ?? config.llm.defaultSynthModel,
        ...(agent.role === 'producer' ? { gatherModel: agent.gatherModel ?? config.llm.defaultGatherModel } : {}),
        status: 'running',
        turnsUsed: 0,
        attempts: 0,
        cost: emptyCost(),
        notes: [],
        startedAt: new Date().toISOString(),
      };
      // An agent running now SUPERSEDES whatever the checkpoint said about it —
      // it was `failed` or `pending` last dispatch, which is why it is running
      // again. Replacing in place (rather than appending) keeps the trace one
      // entry per agent, in DAG order: a resumed job must not show an agent twice,
      // once failed and once ok.
      const prior = trace.agents.findIndex((a) => a.id === agent.id);
      if (prior >= 0) {
        // Carry the replaced row's spend forward. `trace.cost` already includes it
        // (via `resume.cost`), so dropping it here would leave the job total larger
        // than the sum of its agents, with the difference attributed to nobody —
        // and the money in question is a failed agent's, the interesting kind.
        at.cost = trace.agents[prior]!.cost ?? emptyCost();
        trace.agents[prior] = at;
      } else trace.agents.push(at);

      // While retries remain, defer an agent whose dependency hasn't completed —
      // it runs once its deps succeed (a later re-dispatch), never on stale context.
      // On the finalize pass there's no future retry, so run it best-effort with
      // whatever context exists (a failed dep just means missing context).
      const deps = depsOf(agent, producers);
      const depsReady = [...deps].every((d) => done.has(d) || !byId.has(d));
      if (!finalize && !depsReady) {
        at.status = 'pending';
        at.finishedAt = new Date().toISOString();
        return;
      }

      // Whether THIS agent has already bought its evidence in this dispatch.
      //
      // The retry loop wraps both halves of an agent — the research loop and the
      // structured write — so a write that failed used to re-buy the whole loop:
      // fresh searches, fresh page fetches, fresh tokens, for evidence that was
      // already paid for and still sitting in the shared store. Set only when
      // `gather` RETURNS with turns, so a failure inside the loop still re-runs it
      // and an empty pass gets one more go (C2).
      const research = { done: false };

      // In-run retries with exponential backoff — keep trying the step.
      for (let attempt = 1; attempt <= config.workflow.agentMaxAttempts; attempt++) {
        // Checked before every attempt, including the first: once the job has spent
        // its ceiling there is nothing to retry INTO. This is the guard that makes
        // 3 attempts × 8 dispatches a bounded number of dollars rather than a
        // bounded number of tries.
        const budget = jobSpend.budget();
        if (budget.exceeded) {
          const err = new BudgetExceededError(budget.spentUsd, budget.limitUsd ?? 0);
          at.status = 'failed';
          // `message` here, `detail` in the note. Not because of degraded sections —
          // those carry our localized note, never this — but because `emit` below
          // lands in `job.progress.message`, which the API hands to the buyer raw.
          // The figures stay in the note, which is admin-side.
          at.error = err.message;
          at.notes.push(`${new Date().toISOString()} ${err.detail}`);
          trace.budgetExceeded = true;
          await emit(agent.id, err.message);
          break;
        }
        at.attempts = attempt;
        // One sink per attempt, read on BOTH the success and the failure path: a
        // failed attempt still ran its whole research loop and its synthesis calls,
        // and a job that retries to exhaustion is the most expensive kind there is.
        const spend = jobSpend.child();
        let ok = false;
        let failure: Error | undefined;
        try {
          const { slice, handoff } = await runAgent({ template: effTemplate, agent, brief, language, depth, system, evidence, report, counter, emit, trace: at, spend, research, handoffs });
          Object.assign(report, slice);
          if (handoff) handoffs[agent.id] = handoff;
          at.status = 'ok';
          at.output = slice;
          done.add(agent.id);
          ok = true;
        } catch (err) {
          at.status = 'failed';
          at.error = (err as Error).stack ?? (err as Error).message ?? String(err);
          failure = err as Error;
        } finally {
          // In `finally`, not duplicated across try/catch: the invariant is "an
          // attempt is charged, whatever became of it" — a later early return or
          // `continue` cannot silently stop charging.
          at.cost = addCost(at.cost, spend.total());
          // Read, not accumulated: `spend` is a child of `jobSpend`, so every call
          // it recorded is already in the job total. Adding it again here is exactly
          // the double-count the single-accumulator rule exists to prevent.
          trace.cost = jobSpend.total();
        }
        if (ok) break;
        // A ceiling reached mid-attempt ends the agent now. Retrying would just
        // re-enter the guard above, after another backoff.
        if (failure instanceof BudgetExceededError) {
          trace.budgetExceeded = true;
          break;
        }

        // Backoff happens AFTER the charge is booked, not inside the catch. Siblings
        // run concurrently and checkpoint while this agent sleeps; a save during the
        // backoff would otherwise persist a total missing this attempt's spend, and
        // a process that dies in that window loses it for good.
        if (attempt < config.workflow.agentMaxAttempts) {
          const backoff = backoffMs(attempt);
          at.notes.push(`${new Date().toISOString()} retry ${attempt} after: ${failure?.message}`);
          await emit(agent.id, `Retry ${attempt}/${config.workflow.agentMaxAttempts - 1} after error; backing off ${Math.round(backoff)}ms.`);
          await sleep(backoff);
        } else {
          await emit(agent.id, `Failed after ${attempt} attempts: ${failure?.message}`);
        }
      }
      at.durationMs = Date.now() - Date.parse(at.startedAt);
      at.finishedAt = new Date().toISOString();
      // Save after every outcome, not only on success: the checkpoint is the only
      // carrier of cost across dispatches, so a dispatch where nothing succeeds must
      // still persist what it spent. Everything in the snapshot is idempotent.
      await saveCheckpoint();
    });
    await persistTrace();
  }

  const pending = effTemplate.agents.filter((a) => !done.has(a.id));

  const makeMeta = (): ReportMeta => ({
    title: template.name,
    template: template.id,
    templateVersion: template.version,
    schemaVersion: `${template.id}@${template.version}`,
    jobId,
    language,
    mode: mode.key,
    depth: depth.key,
    generatedAt,
    contentFormat: 'markdown',
    cost: trace.cost,
    ...(degraded.length ? { sections: degraded } : {}),
  });
  const checkpoint: Checkpoint = snapshot();

  const budgetStopped = jobSpend.budget().exceeded;

  // A job that stopped on its ceiling is HELD, not incomplete and not degraded.
  //
  // Not incomplete: the checkpoint carries the spend forward, so every remaining
  // dispatch would wake up already over the ceiling and re-dispatch again.
  //
  // Not degraded either — and this is the part that makes an approval worth
  // anything. Degrading writes placeholders into the report, and the placeholders
  // would be what an approved job resumed from. Returning here leaves the
  // checkpoint holding real work and nothing else, so continuing means finishing
  // the sections that never ran, not un-doing filler first.
  if (budgetStopped && pending.length) {
    trace.status = 'held';
    trace.durationMs = Date.now() - Date.parse(trace.startedAt);
    trace.finishedAt = new Date().toISOString();
    await persistTrace();
    await emit('held', `Held at the cost ceiling with ${pending.length} step(s) unfinished — awaiting review.`);
    return { report, meta: makeMeta(), sources: evidence.sources, language, turnsUsed: counter.turns, trace, checkpoint };
  }

  // Not finalizing yet → return 'incomplete' so a re-dispatch resumes the rest.
  if (pending.length && !finalize) {
    trace.status = 'incomplete';
    trace.durationMs = Date.now() - Date.parse(trace.startedAt);
    trace.finishedAt = new Date().toISOString();
    await persistTrace();
    await emit('incomplete', `Incomplete: ${pending.length} step(s) still pending — will resume.`);
    return { report, meta: makeMeta(), sources: evidence.sources, language, turnsUsed: counter.turns, trace, checkpoint };
  }

  // Reaching here with the ceiling crossed means every step finished anyway — the
  // last one simply took the total past it. There is a whole report; deliver it.
  // Worth a warning, because a job landing exactly on its ceiling is a ceiling set
  // too close to what this model actually costs.
  if (budgetStopped) {
    warnings.push('This report finished right at the per-job cost ceiling.');
  }

  // Finalizing with unfinished steps → degrade them (WARNING) and deliver the rest.
  //
  // A key is only degraded when NOTHING succeeded on it. `ownedKeys` is
  // produces + enriches, and those overlap between agents: a producer writes a
  // section and a refiner improves it, so an unfinished refiner used to replace a
  // section its producer had already written and the buyer had already paid for —
  // and, the other way round, a still-pending producer overwrote the real content a
  // refiner had just delivered. Either way the job completed green with a
  // placeholder where the work had been.
  const delivered = new Set<string>();
  for (const agent of effTemplate.agents) {
    if (done.has(agent.id)) for (const key of ownedKeys(agent)) delivered.add(key);
  }

  for (const agent of pending) {
    const reason = agentReason(trace, agent.id);
    // The placeholder the BUYER reads is ours and localized; the internal reason
    // goes to `warnings` (admin-side) on the next line, never into the report.
    const lost = ownedKeys(agent).filter((key) => !delivered.has(key));
    for (const key of lost) {
      report[key] = degradedValue(effTemplate, key, degradedSectionNote(language));
      const at = degraded.findIndex((d) => d.key === key);
      // `lost` wins over `unenriched`: a section nobody wrote is not merely shallow.
      if (at === -1) degraded.push({ key, status: 'lost' });
      else degraded[at]!.status = 'lost';
    }
    // Still worth a warning even when nothing was lost: a step that never finished
    // is a step the admin should see, and "kept" says the section survived it.
    const kept = ownedKeys(agent).filter((key) => delivered.has(key));
    // …and now it says it to the BUYER too. A kept key means the section exists and
    // this step did not run on it — for a refiner, exactly the depth the tier was
    // sold on. The body stays; only the label is added.
    for (const key of kept) {
      if (!degraded.some((d) => d.key === key)) degraded.push({ key, status: 'unenriched' });
    }
    warnings.push(
      `Degraded [${lost.join(', ') || 'none'}] from agent "${agent.id}" after exhausting retries/re-dispatches: ${reason}` +
        (kept.length ? ` (kept, already written: ${kept.join(', ')})` : ''),
    );
  }

  // Derived sections (e.g. sources) — deterministic, filled last.
  await emit('assembling', 'Assembling report.');
  for (const section of effTemplate.sections) {
    if (section.derived && section.derive) {
      try {
        report[section.key] = section.derive({ sources: evidence.sources, report });
      } catch (err) {
        fatalError = `Derived section "${section.key}" failed: ${(err as Error).message}`;
      }
    }
  }

  const parsed = reportSchemaOf(effTemplate).safeParse(report);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    fatalError = `Assembled report failed schema validation: ${issues}`;
  }

  const reason = fatalError ?? '';
  const failed = !!reason;
  trace.status = failed ? 'failed' : 'completed';
  if (reason) trace.error = reason;
  if (warnings.length) trace.warnings = warnings;
  trace.durationMs = Date.now() - Date.parse(trace.startedAt);
  trace.finishedAt = new Date().toISOString();
  await persistTrace();

  await emit(failed ? 'failed' : 'done', failed ? `Report failed: ${reason}` : 'Report complete.');
  return {
    report: parsed.success ? parsed.data : report,
    meta: makeMeta(),
    sources: evidence.sources,
    language,
    turnsUsed: counter.turns,
    trace,
    checkpoint: snapshot(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff (from base, capped) with jitter (up to min(1s, base)). */
function backoffMs(attempt: number): number {
  const base = Math.min(config.workflow.agentRetryMaxMs, config.workflow.agentRetryBaseMs * 2 ** (attempt - 1));
  return base + Math.random() * Math.min(1000, base);
}

/** Why an agent didn't complete — its last error, or a pending dependency. */
function agentReason(trace: JobTrace, agentId: string): string {
  const at = trace.agents.find((a) => a.id === agentId);
  if (at?.error) return (at.error.split('\n')[0] ?? '').slice(0, 300);
  return 'a dependency did not complete';
}

// --- Single agent ------------------------------------------------------------

async function runAgent(ctx: {
  template: ResearchTemplate<any>;
  agent: AgentSpec;
  brief: string;
  language: Language;
  depth: DepthProfile;
  system: string;
  evidence: Evidence;
  report: Record<string, unknown>;
  counter: { turns: number };
  emit: (phase: string, message: string) => Promise<void> | undefined;
  trace: AgentTrace;
  /** Every paid call inside this agent writes here as it happens, so a failed
   *  attempt's spend is still known to the caller. */
  spend: CostSink;
  /** Cross-attempt state for THIS agent: has its research loop already run? */
  research: { done: boolean };
  /** What every finished agent reported, keyed by agent id. */
  handoffs: Record<string, string>;
  // Returns the slice only. Cost lives in the sink, read by the caller on BOTH
  // paths — returning it as well would invite someone tidying this signature to
  // add it back, doubling every agent's cost with the suite still green.
}): Promise<{ slice: Record<string, unknown>; handoff: string }> {
  const { template, agent, brief, language, depth, system, evidence, report, counter, trace } = ctx;
  const depthDirective = depth.directive;
  const owned = ownedKeys(agent);
  const sections = owned.map((k) => sectionByKey(template, k)).filter(Boolean) as ReportSection[];
  // The agent writes its own handoff in the SAME call that writes its sections:
  // no extra model call, and the summary is written by whoever did the work rather
  // than by something reading its output afterwards.
  const schema = sectionSubsetSchema(template, owned).extend({
    // No `.max()` here on purpose. A length limit in the SCHEMA makes the model's
    // verbosity a failure mode for the whole write: one over-long briefing and the
    // agent's sections fail validation, retry, and eventually degrade. The limit is
    // enforced where it belongs — on the way in, by cutting it (see splitHandoff).
    [HANDOFF_KEY]: z
      .string()
      .describe(
        'A short briefing for the LATER steps that build on your work: what you found, the figures and ' +
          'names that matter, and anything they should not repeat or contradict. Written for a colleague ' +
          'who will not read your sections in full. Full sentences — not a list of links, not citations, ' +
          'not headings. A briefing made of bare URLs tells the next step nothing.',
      ),
  });
  const synthModel = resolveModel(agent.model ?? config.llm.defaultSynthModel);
  const context = contextFor(template, agent, report, ctx.handoffs);

  const note = (m: string) => {
    if (trace.notes.length < MAX_NOTES) trace.notes.push(`${new Date().toISOString()} ${m}`);
    return ctx.emit(agent.id, m);
  };

  if (agent.role === 'producer') {
    const gatherModel: ResolvedModel = resolveModel(agent.gatherModel ?? config.llm.defaultGatherModel);
    const budget = Math.max(2, Math.round((agent.researchBudget ?? config.search.maxTurns) * depth.budgetScale));
    const sites = effectiveSites(template, agent);
    if (sites.length) await note(`Suggested sources (additive): ${sites.join(', ')}.`);
    // A retry after a failed WRITE reuses what the last attempt bought. The
    // evidence store is shared and still holds it; re-running the loop would not
    // recover anything, it would go and buy more of the same.
    if (ctx.research.done) {
      await note(`Reusing evidence already gathered (${evidence.sources.length} sources, ${evidence.extracted.length} pages).`);
    } else {
      await note(`Researching (${owned.join(', ')}).`);
      const gres = await gather({
        spend: ctx.spend,
        model: gatherModel,
        system,
        messages: [{ role: 'user', text: buildAgentKickoff({ agent, brief, sections, maxTurns: budget, handoffs: context.handoffs, current: context.current, sites }) }],
        maxTurns: budget,
        evidence,
        onNote: (m) => note(m),
      });
      counter.turns += gres.turns;
      trace.turnsUsed = gres.turns;
      // Only a FINISHED pass may be reused (Javier, 2026-07-31: a retry takes what
      // is finished, never something half-done). `gatherCompleted` is the whole
      // rule: the agent stopped asking for tools, or spent its full allowance, and
      // it actually bought something. A loop cut off by the cost ceiling or by
      // running out of iterations is unfinished work, and a throw never reaches
      // this line at all.
      ctx.research.done = gatherCompleted(gres);
    }

    // `gather` stops at the ceiling rather than throwing, so the evidence it did
    // buy is kept in the shared store for whoever runs next. Synthesis is the next
    // paid call, so the ceiling is enforced here, before it.
    const costBudget = ctx.spend.budget();
    if (costBudget.exceeded) throw new BudgetExceededError(costBudget.spentUsd, costBudget.limitUsd ?? 0);

    await note(`Writing (${owned.join(', ')}).`);
    const enrichesOnly = (agent.enriches ?? []).filter((k) => k in report);
    const text =
      enrichesOnly.length === owned.length && enrichesOnly.length > 0
        ? buildEnricherSynthPrompt({
            agent,
            brief,
            sections,
            current: pick(report, owned),
            evidence: evidence.sources,
            extracted: evidence.extracted,
            lang: language,
            depthDirective,
          })
        : buildProducerSynthPrompt({
            agent,
            brief,
            sections,
            evidence: evidence.sources,
            extracted: evidence.extracted,
            context: context.sections,
            handoffs: context.handoffs,
            current: context.current,
            lang: language,
            depthDirective,
          });
    const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema, spend: ctx.spend });
    return splitHandoff(sres.value as Record<string, unknown>);
  }

  // synthesizer — compose from upstream only.
  await note(`Composing (${owned.join(', ')}).`);
  const text = buildSynthesizerPrompt({ agent, brief, sections, context: context.sections, handoffs: context.handoffs, current: context.current, lang: language, depthDirective });
  const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema, spend: ctx.spend });
  return splitHandoff(sres.value as Record<string, unknown>);
}

/**
 * Separate the between-steps message from the report sections, and bound it here.
 *
 * Cutting rather than rejecting: a briefing that ran long is still a useful
 * briefing, and it must never be the reason an agent's sections are thrown away.
 */
function splitHandoff(value: Record<string, unknown>): { slice: Record<string, unknown>; handoff: string } {
  const { [HANDOFF_KEY]: handoff, ...slice } = value;
  const text = typeof handoff === 'string' ? handoff.trim() : '';
  return { slice, handoff: text.length > MAX_HANDOFF_CHARS ? `${text.slice(0, MAX_HANDOFF_CHARS)}…` : text };
}

// --- DAG ---------------------------------------------------------------------

/** All section keys an agent is responsible for (authors or enriches). */
function ownedKeys(agent: AgentSpec): string[] {
  return [...new Set([...(agent.produces ?? []), ...(agent.enriches ?? [])])];
}

/** Union of the template-level and agent-level `sites` — the domains suggested (additively) to this producer. */
export function effectiveSites(template: ResearchTemplate<any>, agent: AgentSpec): string[] {
  return [...new Set([...(template.sites ?? []), ...(agent.sites ?? [])])];
}

/** Map a section key to the id of the agent that produces it. */
function producerOf(template: ResearchTemplate<any>): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of template.agents) for (const k of a.produces ?? []) m.set(k, a.id);
  return m;
}

/** Full dependency set of an agent: explicit deps + producers of enriched sections. */
function depsOf(agent: AgentSpec, producers: Map<string, string>): Set<string> {
  const deps = new Set(agent.dependsOn ?? []);
  for (const k of agent.enriches ?? []) {
    const p = producers.get(k);
    if (p && p !== agent.id) deps.add(p);
  }
  return deps;
}

/** The execution waves (agent ids), for docs / inspection / tests. */
export function planWaves(template: ResearchTemplate<any>): string[][] {
  return topoSortAgents(template).map((wave) => wave.map((a) => a.id));
}

/** Kahn layering: returns agents grouped into waves; throws on a cycle. */
function topoSortAgents(template: ResearchTemplate<any>): AgentSpec[][] {
  const producers = producerOf(template);
  const byId = new Map(template.agents.map((a) => [a.id, a]));
  const remaining = new Set(template.agents.map((a) => a.id));
  const done = new Set<string>();
  const waves: AgentSpec[][] = [];

  while (remaining.size) {
    const wave: AgentSpec[] = [];
    for (const id of remaining) {
      const deps = depsOf(byId.get(id)!, producers);
      if ([...deps].every((d) => done.has(d) || !byId.has(d))) wave.push(byId.get(id)!);
    }
    if (!wave.length) throw new Error(`Cyclic agent dependency in template "${template.id}".`);
    for (const a of wave) {
      remaining.delete(a.id);
      done.add(a.id);
    }
    waves.push(wave);
  }
  return waves;
}

/** Read-only context for an agent: the current values of its dependency sections. */
function contextFor(
  template: ResearchTemplate<any>,
  agent: AgentSpec,
  report: Record<string, unknown>,
  handoffs: Record<string, string>,
): { sections: Record<string, unknown>; handoffs: Record<string, string>; current: Record<string, unknown> } {
  const producers = producerOf(template);
  const byId = new Map(template.agents.map((a) => [a.id, a]));
  const keys = new Set<string>();
  const notes: Record<string, string> = {};
  for (const depId of depsOf(agent, producers)) {
    for (const k of ownedKeys(byId.get(depId) ?? ({} as AgentSpec))) keys.add(k);
    const note = handoffs[depId];
    if (note) notes[byId.get(depId)?.label ?? depId] = note;
  }
  // What this agent OWNS is carried separately and never trimmed: its output
  // replaces those sections, so a trimmed copy deletes whatever fell past the cut.
  // Removing them from the budgeted set also stops them being sent twice.
  const own = new Set(ownedKeys(agent));
  for (const k of own) keys.delete(k);
  return { sections: pick(report, [...keys]), handoffs: notes, current: pick(report, [...own]) };
}

// --- utils -------------------------------------------------------------------

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** Run tasks with a bounded concurrency pool (Vertex quota guard). */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** A schema-valid placeholder for a failed section, from its JSON Schema shape. */
function degradedValue(template: ResearchTemplate<any>, key: string, note: string): unknown {
  const section = sectionByKey(template, key);
  if (!section) return null;
  return emptyFromJsonSchema(z.toJSONSchema(section.schema) as Record<string, unknown>, note);
}

/** Build a minimal schema-valid value; put the note into the first string field. */
function emptyFromJsonSchema(node: Record<string, unknown>, note: string): unknown {
  const root = node;
  const resolve = (n: Record<string, unknown>): Record<string, unknown> => {
    if (typeof n.$ref === 'string') {
      const name = (n.$ref as string).replace(/^#\/(?:\$defs|definitions)\//, '');
      const defs = (root.$defs ?? root.definitions ?? {}) as Record<string, Record<string, unknown>>;
      return defs[name] ?? n;
    }
    const union = (n.anyOf ?? n.oneOf) as Array<Record<string, unknown>> | undefined;
    // Prefer the NULL branch when the schema offers one. The opposite choice is
    // what manufactures data: picking the non-null branch turns "we have no
    // figure" into a concrete 0, and "we reached no verdict" into the first enum
    // value — which for a buy/hold/avoid field reads as a recommendation.
    if (Array.isArray(union)) return union.find((b) => b.type === 'null') ?? union.find((b) => b.type !== 'null') ?? n;
    return n;
  };
  const build = (n0: Record<string, unknown>): unknown => {
    const n = resolve(n0);
    if (n.type === 'null') return null;
    // Same reason as the union above: a nullable field says nothing rather than
    // asserting the first thing its type allows.
    if (Array.isArray(n.type) && (n.type as string[]).includes('null')) return null;
    const type = Array.isArray(n.type) ? (n.type as string[]).find((t) => t !== 'null') : n.type;
    if (Array.isArray(n.enum)) return (n.enum as unknown[])[0];
    switch (type) {
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((n.properties ?? {}) as Record<string, Record<string, unknown>>)) {
          out[k] = build(v);
        }
        return out;
      }
      case 'array': {
        // Respect minItems so a degraded placeholder still satisfies `.min(N)`.
        const min = typeof n.minItems === 'number' ? n.minItems : 0;
        const items = (n.items ?? {}) as Record<string, unknown>;
        return Array.from({ length: min }, () => build(items));
      }
      case 'number':
      case 'integer':
        return 0;
      case 'boolean':
        return false;
      case 'string':
      default:
        // The note goes in EVERY string, not just the first. One apology plus a
        // dozen empty strings reads as a section that was written and came back
        // blank; the same sentence in each field reads as what it is.
        return note;
    }
  };
  return build(root);
}
