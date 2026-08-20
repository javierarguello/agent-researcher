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
import { agentTurns, effectiveTemplate } from '../mode-shape.js';
import { resolveModel, type ResolvedModel } from '../llm/index.js';
import type { ExtractedPage, SearchResult } from '../tools/web-search.js';
import {
  agentKind,
  hasResearchLoop,
  reportSchemaOf,
  sectionByKey,
  sectionSubsetSchema,
  type AgentKind,
  type AgentSpec,
  type ReportSection,
  type ResearchTemplate,
} from '../templates/types.js';
import { degradedSectionNote } from '../jobs/report-copy.js';
import { redactPromptEcho } from './prompt-echo.js';
import type { ProgressKind } from '../jobs/types.js';
import { normalizeSectionStatuses, type SectionStatus } from './section-status.js';
import { createEvidence, gather, gatherCompleted, type Evidence, type GatherStop } from './gather.js';
import { StructuredOutputError, synthesizeStructured } from './synthesize.js';
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
  /** The engine's English sentence — for the trace and the admin. */
  message: string;
  /** What kind of step this is — what a client localizes. */
  kind: ProgressKind;
  /** The one variable a client may show (a `searched` query). */
  detail?: string;
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
   *   - `reconstructed` — no producer delivered it and an enricher wrote it anyway
   *     on the finalize pass. Also rendered, and also NOT `unenriched`: nothing
   *     researched this section directly (round 7, R7-1).
   *
   * This replaced `degradedSections`, a list of strings that could only say "lost"
   * — so `unenriched` was invisible: an admin warning and nothing else, and a
   * comprehensive report whose four enrich passes all failed shipped as complete,
   * at full price, with the buyer never told.
   *
   * NOT the manifest's `sections` (key + title, every section, for rendering).
   * This one carries only what went wrong, and `status` leaves room for another
   * state without another parallel list to keep in step.
   */
  sections?: SectionStatus[];
}

export type { SectionStatus };

/** Per-agent execution record — what it did, produced, and any error. */
export interface AgentTrace {
  id: string;
  role: AgentSpec['role'];
  /**
   * What it does — `researcher` | `refiner` | `writer`, derived from `role` +
   * `enriches` (see `AgentKind`). Absent on traces written before it existed.
   */
  kind?: AgentKind;
  /** 1-based wave the agent ran in. */
  wave: number;
  produces: string[];
  enriches: string[];
  /** Resolved model aliases (not concrete ids). */
  model: string;
  gatherModel?: string;
  status: 'running' | 'ok' | 'failed' | 'pending';
  turnsUsed: number;
  /**
   * Why the research loop ended (producers only; the last attempt's). `done` and
   * `budget` are finished passes; `ceiling` and `stalled` were cut off. Recorded
   * because two real agent-runs reached the iteration bound with ZERO searches
   * and nothing in the trace said so.
   */
  gatherStop?: GatherStop;
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

/** One agent's last write failure that carried a signature — see `Checkpoint.writeFailures`. */
export interface WriteFailure {
  signature: string;
  /** Consecutive dispatches that ended on this signature (1 = first time seen). */
  dispatches: number;
}

/**
 * Dispatches on which the SAME write failure ends an agent before it is given up
 * on. Two: the first says what the model does with this evidence, the second says
 * it will keep doing it — a third dispatch would buy the same 3 × 2 writes for the
 * same section, and so would the fourth through the eighth.
 */
export const REPEATED_WRITE_FAILURE_DISPATCHES = 2;

/** Whether an agent's write has failed the same way on enough dispatches to stop retrying it. */
export function writeFailureExhausted(failure: WriteFailure | undefined): boolean {
  return (failure?.dispatches ?? 0) >= REPEATED_WRITE_FAILURE_DISPATCHES;
}

/**
 * The record to persist for an agent whose dispatch ended in `err`: the same
 * signature again → one more dispatch on it; a new signature → the count starts
 * over; no validation failure at all (`undefined`: a provider error, a ceiling)
 * → nothing to compare against next time, so the record is dropped. The caller
 * decides what counts as a validation failure — only a `StructuredOutputError`
 * carries a signature; anything else says nothing about the model and the
 * evidence.
 */
export function writeFailureAfter(prior: WriteFailure | undefined, err: StructuredOutputError | undefined): WriteFailure | undefined {
  if (!err) return undefined;
  const dispatches = prior?.signature === err.signature ? prior.dispatches + 1 : 1;
  return { signature: err.signature, dispatches };
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
  /**
   * Producers whose research loop FINISHED (`gatherCompleted`: it stopped asking
   * for tools or spent its allowance, and bought something) — including the ones
   * whose WRITE then failed. Restored so a re-dispatch writes from the evidence
   * carried in `extracted`/`sources` instead of buying the loop again: `research.
   * done` was a per-dispatch local, so a write that failed identically re-bought
   * its loop on every one of the eight dispatches (M-D1). Absent on checkpoints
   * written before it existed — those resume as they always did, loop and all.
   */
  gatheredAgentIds?: string[];
  /**
   * URLs each agent's loop actually fetched, by agent id.
   *
   * Two jobs, both about a `gathered` agent — one that will not run its loop again:
   *
   *   - the page cap below drops the OLDEST pages, which are exactly an early
   *     agent's, so a gathered agent could write from a store its own evidence had
   *     fallen out of and could no longer buy back. The doc for `extracted` called
   *     that "a cache miss, not a correctness problem"; with `gatheredAgentIds` it
   *     stopped being one (round 7, R7-11). `snapshot()` keeps these pages first,
   *     and an agent whose pages could not all be kept is un-gathered so its loop
   *     runs again rather than writing from evidence it never gathered.
   *   - the dossier ranks a writer's OWN pages first, and `research.fetched` was a
   *     per-dispatch local, so a resumed writer's own pages ranked like anyone
   *     else's (R7-31 F9). Restored from here.
   *
   * Absent on checkpoints written before it existed: those resume exactly as they
   * did, keeping the newest pages and no preference.
   */
  fetchedByAgent?: Record<string, string[]>;
  /**
   * URLs each agent's loop was SHOWN — its own search results — by agent id.
   *
   * The sibling of `fetchedByAgent`, and the other half of the same defect: the
   * dossier's second tier is "results this writer's loop saw", so a resumed agent
   * with both sets empty had EVERYTHING in the foreign tier, where the per-host cap
   * applies. Measured on a July-shaped store (190 sources, 90% one marketplace): a
   * resumed deal-scout got 35 of its 48 snippet slots instead of 43, losing eight
   * listings to diversity it never asked for (round 7, R7-12).
   *
   * Bounded per agent, because a 24-turn loop sees ~192 results and this is written
   * after every agent: the newest `MAX_SEEN_PER_AGENT` survive, which are the ones a
   * resumed write is most likely to cite.
   */
  touchedByAgent?: Record<string, string[]>;
  /**
   * The last VALIDATION failure of each agent's write, by agent id: what failed
   * (`StructuredOutputError.signature`) and on how many consecutive dispatches it
   * failed that way. Two is the bound: an agent whose write fails the same way on
   * two dispatches is not retried on a third — its section degrades as if the
   * retries were exhausted, because they are. A provider error (no signature) or a
   * different signature starts the count over. See `writeFailureAfter`.
   */
  writeFailures?: Record<string, WriteFailure>;
  /** What each finished agent reported to the steps after it, by agent id. */
  handoffs?: Record<string, string>;
  /** Section statuses so far — see `ReportMeta.sections`. */
  degraded: SectionStatus[];
  /**
   * Admin-facing warnings raised on EARLIER dispatches, carried so the delivering
   * one still reports them. `slimAgents()` writes `notes: []`, so anything recorded
   * only as an agent note is gone on the next dispatch — which is how a job that
   * shrank a section on dispatch 1 and delivered on dispatch 2 shipped 3 of 6
   * listings with nothing anywhere saying so (round 7, R7-4). Absent on checkpoints
   * written before it existed; those resume with none, as they did.
   */
  warnings?: string[];
  /** Traces of agents already completed on prior dispatches — restored so the final
   *  trace/summary reflects the WHOLE run, not just the last resumed dispatch. */
  agentTraces?: AgentTrace[];
  /** Accumulated cost across prior dispatches (agents + headline) — restored so the
   *  final job cost isn't undercounted to just the last dispatch's steps. */
  cost?: Cost;
  /**
   * Research turns this job has spent, across dispatches.
   *
   * R7-13 seeded this from `cost.searchCalls`, which counts BILLED calls: a turn
   * that reached no backend — an empty url, a fetch with no search key configured,
   * a provider that failed before it charged — was still forgotten on resume, so
   * the per-agent rows an admin reads still did not sum to the figure above them
   * (round 8, R8-16). Absent on a checkpoint written before this field existed, and
   * `searchCalls` remains the fallback there: the old approximation beats a reset.
   */
  turnsUsed?: number;
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
  /**
   * The instant (epoch ms) after which this dispatch stops STARTING agents.
   *
   * Not a timeout on the run: an agent already running is left to finish, and the
   * ones not started stay `pending` for a re-dispatch to pick up, exactly the way a
   * deferred dependency does. That is the whole idea — the process is going to be
   * killed at a fixed wall clock either way (Cloud Run's `--timeout`, and Cloud
   * Tasks caps an HTTP dispatch deadline at 30 minutes, so neither is raisable),
   * and being killed mid-agent loses that agent's spend twice: never added to
   * `trace.cost`, and re-run from zero next dispatch (C5).
   *
   * Ignored on the finalize pass. Finalizing is the dispatch that must not be cut
   * short — stopping there would degrade sections for a reason that is not a
   * failure, and `maxJobAttempts` guarantees it happens eventually.
   */
  deadlineAt?: number;
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

/**
 * URLs remembered per agent for `touchedByAgent`. A 24-turn loop is shown ~192
 * results; the checkpoint is written after every agent, so this is a bound on a
 * per-agent index, not on the evidence itself (which `sources` already carries).
 */
const MAX_SEEN_PER_AGENT = 300;


export async function runResearch(input: RunResearchInput): Promise<ResearchOutput> {
  const { template, params, jobId, generatedAt, onProgress, onTrace } = input;

  const langRaw = (params as Record<string, unknown>).language;
  const language: Language = isLanguage(langRaw) ? langRaw : 'en';

  // Resolve the public mode → internal budget/section/depth config, then derive
  // the effective (mode-filtered) template + params used for the rest of the run.
  const mode = resolveMode(template.modes, (params as Record<string, unknown>).mode);
  const effParams: Record<string, unknown> = { ...params, ...(mode.config.params ?? {}) };
  // Shared with `modeShapes`, which is what tells an admin what a tier buys. Two
  // copies of this filter would be two answers to "how many turns does essential
  // get", and only one of them would be the one that runs.
  const effTemplate: ResearchTemplate<any> = effectiveTemplate(template, mode.config);
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
  // Producers whose loop finished on an earlier dispatch. Their evidence is the
  // `sources`/`extracted` seeded below; a resumed attempt writes from that.
  const gathered = new Set<string>(input.resume?.gatheredAgentIds ?? []);
  /** What each agent's loop fetched / was shown, carried across dispatches (see `Checkpoint`). */
  const fetchedByAgent: Record<string, string[]> = { ...(input.resume?.fetchedByAgent ?? {}) };
  const touchedByAgent: Record<string, string[]> = { ...(input.resume?.touchedByAgent ?? {}) };
  // The last signed write failure per agent, carried across dispatches. An agent
  // whose entry says "exhausted" is not run again on any later dispatch, approved
  // or not: it degrades with the rest of the unfinished steps.
  const writeFailures: Record<string, WriteFailure> = { ...(input.resume?.writeFailures ?? {}) };
  const exhausted = (agentId: string) => writeFailureExhausted(writeFailures[agentId]);
  // Seeded from the checkpoint: a warning is about the JOB, not about the dispatch
  // that happened to notice it.
  const warnings: string[] = [...(input.resume?.warnings ?? [])];
  /**
   * Research turns this JOB has spent, across dispatches.
   *
   * Seeded from the checkpoint like `jobSpend` is, and for the same reason: it is
   * what `output.turnsUsed` reports and what the live line shows. Starting it at 0
   * on every resume made the job summary disagree with its own cost (`searchCalls`
   * counts every dispatch, this counted the last one), made the per-agent rows an
   * admin reads stop summing to the "Search turns" figure above them, and restarted
   * the buyer's turn count at zero mid-job (round 7, R7-13). The checkpoint now
   * carries the count itself — `searchCalls` counts what was BILLED, which is a
   * different number whenever a turn reached no backend (round 8, R8-16).
   */
  const counter = { turns: input.resume?.turnsUsed ?? input.resume?.cost?.searchCalls ?? 0 };
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

  const emit = async (phase: string, message: string, kind: ProgressKind, detail?: string) =>
    onProgress?.({ phase, message, kind, ...(detail ? { detail } : {}), turnsUsed: counter.turns, sourcesFound: evidence.sources.length });
  const persistTrace = async () => onTrace?.(trace);
  // Slim agent traces for the checkpoint: drop `output` (already in `report`) and
  // `notes` to keep checkpoint.json small; keep status/cost/timing for the summary.
  const slimAgents = (): AgentTrace[] => trace.agents.map((a) => ({ ...a, output: undefined, notes: [] }));
  /**
   * The pages to carry, and which agents may still call their loop finished.
   *
   * Newest-first was the whole rule, and the oldest pages belong to the earliest
   * agents — the ones most likely to be `gathered`. A gathered agent does not run
   * its loop again, so anything of its own that fell out was gone for good and it
   * wrote from pages it had never fetched. Its pages are kept first now; if they
   * still do not fit, it loses `gathered` instead, and re-buys its evidence on the
   * next dispatch — paying twice beats writing from someone else's research.
   */
  const carry = (): { pages: ExtractedPage[]; gatheredIds: string[] } => {
    const owned = new Set<string>();
    for (const id of gathered) for (const u of fetchedByAgent[id] ?? []) owned.add(u);
    const mine = evidence.extracted.filter((p) => owned.has(p.url));
    const rest = evidence.extracted.filter((p) => !owned.has(p.url));
    // Own pages first, then the newest of the others, then back into store order:
    // the dossier's tiers read this list, and store order is what they assume.
    //
    // `room` is computed from what was actually kept, not from `mine.length`:
    // `rest.slice(-Math.max(0, CAP - mine.length))` is `slice(-0)` once an agent
    // owns the whole cap, and `-0 === 0`, so `slice(-0)` returns the ENTIRE array.
    // The bound switched itself off at exactly the size it exists to bound, and
    // this runs after every agent (round 8, R8-2).
    const own = mine.slice(-CHECKPOINT_MAX_PAGES);
    const room = CHECKPOINT_MAX_PAGES - own.length;
    const keep = new Set([...own, ...(room > 0 ? rest.slice(-room) : [])]);
    const pages = evidence.extracted.filter((p) => keep.has(p));
    const kept = new Set(pages.map((p) => p.url));
    const gatheredIds = [...gathered].filter((id) => (fetchedByAgent[id] ?? []).every((u) => kept.has(u)));
    return { pages, gatheredIds };
  };

  const snapshot = (): Checkpoint => {
    const { pages, gatheredIds } = carry();
    return {
      // `report` and `sources` are copied too, and they are the two that made the
      // claim "copies its arrays and maps" false: `sources` is the LARGEST array on
      // the checkpoint and both keep being written after a snapshot is taken (round
      // 9, R9-18). Shallow — a section body edited in place is still shared — which
      // is the honest bound: the top level is frozen, the leaves are not.
      report: { ...report },
      sources: [...evidence.sources],
      extracted: pages,
      doneAgentIds: [...done],
      gatheredAgentIds: gatheredIds,
      fetchedByAgent: { ...fetchedByAgent },
      touchedByAgent: { ...touchedByAgent },
      // Copied, not aliased. `snapshot()` used to hand out the live arrays and maps,
      // so a push on the finalize tail mutated a checkpoint that had already been
      // taken (round 8, R8-37). Harmless on today's paths — the caller serializes
      // straight away — which is exactly the kind of aliasing that gets inherited by
      // a caller that does not.
      handoffs: { ...handoffs },
      degraded: degraded.map((d) => ({ ...d })),
      warnings: [...warnings],
      agentTraces: slimAgents(),
      cost: { ...trace.cost },
      turnsUsed: counter.turns,
      writeFailures: { ...writeFailures },
    };
  };

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

  await emit('planning', `Starting workflow [${mode.key}]: ${effTemplate.agents.length} agents (${done.size} already done).`, 'starting');

  // One pass over the DAG. `bestEffort` is the finalize semantics: an agent whose
  // dependency never finished runs anyway, on whatever context exists. It is a
  // function because a dispatch can decide, AFTER its retrying pass, that there is
  // nothing left worth a re-dispatch — and then runs the deferred steps right here
  // rather than paying another dispatch to reach the same conclusion.
  /**
   * Out of wall clock for THIS dispatch (see `RunResearchInput.deadlineAt`).
   *
   * Asked before an agent starts, never while one runs. Never true on the finalize
   * pass — its caller passes `bestEffort`.
   */
  const outOfTime = (): boolean => input.deadlineAt != null && Date.now() >= input.deadlineAt;
  let stoppedOnDeadline = false;

  const runWaves = async (bestEffort: boolean) => {
    for (const [w, wave] of waves.entries()) {
      // Not done, and not given up on: an agent whose write failed the same way on
      // two dispatches is not run a third time — it degrades below with the rest.
      const todo = wave.filter((a) => !done.has(a.id) && !exhausted(a.id));
      if (!todo.length) continue;
      // Before the `emit`, so a dispatch that is out of time does not announce a
      // wave it will not run — the buyer's progress line would name five agents and
      // then nothing would happen for the rest of the dispatch.
      if (!bestEffort && outOfTime()) {
        stoppedOnDeadline = true;
        break;
      }
      await emit('planning', `Wave ${w + 1}/${waves.length}: ${todo.map((a) => a.id).join(', ')}.`, 'wave');
      await runPool(todo, config.llm.maxConcurrentAgents, async (agent) => {
        const at: AgentTrace = {
          id: agent.id,
          role: agent.role,
          kind: agentKind(agent),
          wave: w + 1,
          produces: agent.produces ?? [],
          enriches: agent.enriches ?? [],
          model: agent.model ?? config.llm.defaultSynthModel,
          ...(hasResearchLoop(agent) ? { gatherModel: agent.gatherModel ?? config.llm.defaultGatherModel } : {}),
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
          // …and its loop, for the same reason: an agent resuming on evidence it
          // gathered last dispatch (`gatheredAgentIds`) runs no loop now, and a row
          // saying "0 turns, no stop" would describe a write from nothing. A loop
          // that does run again ADDS its turns to the row (`72d2777`) and overwrites
          // `gatherStop` — this comment said "overwrites both" for a batch after
          // that stopped being true (round 7, R7-13).
          at.turnsUsed = trace.agents[prior]!.turnsUsed ?? 0;
          if (trace.agents[prior]!.gatherStop) at.gatherStop = trace.agents[prior]!.gatherStop;
          trace.agents[prior] = at;
        } else trace.agents.push(at);

        // While retries remain, defer an agent whose dependency hasn't completed —
        // it runs once its deps succeed (a later re-dispatch), never on stale context.
        // On the finalize pass there's no future retry, so run it best-effort with
        // whatever context exists (a failed dep just means missing context).
        const deps = depsOf(agent, producers);
        const depsReady = [...deps].every((d) => done.has(d) || !byId.has(d));
        if (!bestEffort && !depsReady) {
          at.status = 'pending';
          at.finishedAt = new Date().toISOString();
          return;
        }

        // Out of wall clock. Same treatment as a deferred dependency, and for a
        // reason of the same shape: there is no point starting work this dispatch
        // cannot keep. The wave-level check above stops whole waves; this one stops
        // the agents of the CURRENT wave that the pool has not reached yet — with
        // `maxConcurrentAgents` at 2, a five-agent wave has three of them queued
        // behind the two running, and the line can fall between them.
        if (!bestEffort && outOfTime()) {
          at.status = 'pending';
          at.finishedAt = new Date().toISOString();
          stoppedOnDeadline = true;
          return;
        }

        // Whether THIS agent has already bought its evidence — in this dispatch, or
        // in an earlier one (`gatheredAgentIds`, carried by the checkpoint).
        //
        // The retry loop wraps both halves of an agent — the research loop and the
        // structured write — so a write that failed used to re-buy the whole loop:
        // fresh searches, fresh page fetches, fresh tokens, for evidence that was
        // already paid for and still sitting in the shared store. Set only when
        // `gather` RETURNS with turns, so a failure inside the loop still re-runs it
        // and an empty pass gets one more go (C2). Restored from the checkpoint for
        // the same reason: the evidence a finished loop bought is in the store this
        // dispatch was seeded from, and a re-dispatch after a failed write used to
        // buy it all again — eight times over (M-D1).
        // `fetched` is seeded from the checkpoint so a RESUMED writer still ranks the
        // pages it paid for above everyone else's; it was a per-dispatch local, so a
        // re-dispatched writer fell back to store order (round 7, R7-31 F9).
        const research = {
          done: gathered.has(agent.id),
          touched: new Set<string>([...(touchedByAgent[agent.id] ?? []), ...(fetchedByAgent[agent.id] ?? [])]),
          fetched: new Set<string>(fetchedByAgent[agent.id] ?? []),
        };
        // The last VALIDATION failure any attempt of this dispatch ended on, if one
        // did — what the signature bookkeeping below compares across dispatches. A
        // provider error or the ceiling leaves it alone: they say nothing about what
        // the model does with this evidence.
        let lastWriteFailure: StructuredOutputError | undefined;
        let succeeded = false;

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
            // `message` here, `detail` in the note. The reason used to be that
            // `emit` lands in `job.progress.message` and the API handed that to the
            // buyer raw — `9850bdf` ended that, and this comment outlived it by a
            // batch (round 7, R7-22). What remains true is the split it describes:
            // the spend figures belong in the note, which is admin-side, and the
            // message is the sentence an admin reads in the trace.
            at.error = err.message;
            at.notes.push(`${new Date().toISOString()} ${err.detail}`);
            trace.budgetExceeded = true;
            await emit(agent.id, err.message, 'ceiling');
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
            // A rewrite REPLACES the section. When it comes back with fewer items
            // than it was handed, say so where an admin reads — a note, never a
            // refusal: dropping a duplicate, a sold listing or a misleading chart is
            // a rewrite doing its job, and the trace still holds the analyst's
            // output. What this catches is the other case: a pass that came back
            // shorter for no reason, delivered green (M-A1).
            for (const key of agent.enriches ?? []) {
              for (const [label, before, after] of arrayFields(key, report[key], slice[key])) {
                if (after < before) {
                  at.notes.push(`${new Date().toISOString()} rewrite of "${label}" returned ${after} item(s) where the current version had ${before}; the previous version is in the analyst's trace output.`);
                  // …and where an admin actually reads. The note alone reached no
                  // screen: `JobSummary.agents` carries six fields and `notes` is not
                  // one of them, no admin page renders it, and `slimAgents()` blanks
                  // it in the checkpoint, so a re-dispatch deleted the only record
                  // (round 7, R7-4). `warnings` is admin-only — the API redacts it
                  // for a buyer — and does NOT make the report degraded: an honest
                  // dedup must not tell a buyer their dossier is incomplete.
                  // Timestamped like its `notes` twin one line up. `warnings` rides
                  // the checkpoint and is seeded on resume, so an agent that shrinks
                  // the same array on two dispatches left two byte-identical lines
                  // and an admin could not tell "it happened twice" from "we
                  // double-counted it" (round 8, R8-37). Not deduped: two shrinks of
                  // one field on two dispatches is worse news than one, and
                  // collapsing them hides it.
                  warnings.push(
                    `${new Date().toISOString()} Agent "${agent.id}" rewrote "${label}": ${after} item(s) where the current version had ${before}; ` +
                      `the previous version is in that agent's trace output.`,
                  );
                }
              }
            }
            Object.assign(report, slice);
            if (handoff) handoffs[agent.id] = handoff;
            at.status = 'ok';
            at.output = slice;
            done.add(agent.id);
            ok = true;
            succeeded = true;
          } catch (err) {
            at.status = 'failed';
            at.error = (err as Error).stack ?? (err as Error).message ?? String(err);
            failure = err as Error;
            if (err instanceof StructuredOutputError) lastWriteFailure = err;
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
            await emit(agent.id, `Retry ${attempt}/${config.workflow.agentMaxAttempts - 1} after error; backing off ${Math.round(backoff)}ms.`, 'retry');
            await sleep(backoff);
          } else {
            await emit(agent.id, `Failed after ${attempt} attempts: ${failure?.message}`, 'failed');
          }
        }
        // A loop that finished stays finished: whatever happened to the write, the
        // next dispatch must not buy this evidence again.
        if (research.done) gathered.add(agent.id);
        // What it fetched, carried across dispatches: the checkpoint keeps those
        // pages ahead of everyone else's, and a resumed writer ranks them first in
        // its own dossier (see `Checkpoint.fetchedByAgent`).
        // Bounded by the same number that bounds the pages, because `carry()` keeps
        // `gathered` only for an agent ALL of whose recorded urls survived: an agent
        // with 61 recorded urls could never satisfy that test, lost `gathered` on
        // every snapshot, and re-bought its whole loop on all eight dispatches — the
        // permanent version of the cost M-D1 was filed to stop (round 8, R8-3).
        if (research.fetched.size) {
          const all = [...new Set([...(fetchedByAgent[agent.id] ?? []), ...research.fetched])];
          fetchedByAgent[agent.id] = all.slice(-CHECKPOINT_MAX_PAGES);
          const capped = `${agent.id}: fetched ${all.length} pages, more than the ${CHECKPOINT_MAX_PAGES} a checkpoint carries; a resumed dispatch writes from the newest ${CHECKPOINT_MAX_PAGES} of its own.`;
          if (all.length > CHECKPOINT_MAX_PAGES && !warnings.includes(capped)) warnings.push(capped);
        }
        if (research.touched.size) {
          touchedByAgent[agent.id] = [...new Set([...(touchedByAgent[agent.id] ?? []), ...research.touched])].slice(-MAX_SEEN_PER_AGENT);
        }
        // The cross-dispatch record. Kept only for a validation failure; a success,
        // a provider error or the ceiling clears it (see `writeFailureAfter`). An
        // agent that never got an attempt (the ceiling was already spent) said
        // nothing new, so its record is left as it was.
        if (at.attempts === 0) {
          // nothing ran; nothing to record
        } else if (succeeded) delete writeFailures[agent.id];
        else {
          const next = writeFailureAfter(writeFailures[agent.id], lastWriteFailure);
          if (!next) delete writeFailures[agent.id];
          else {
            writeFailures[agent.id] = next;
            if (writeFailureExhausted(next)) {
              at.notes.push(
                `${new Date().toISOString()} write failed the same way on ${next.dispatches} dispatches (${next.signature}); ` +
                  `not retrying this step on a later dispatch.`,
              );
              await emit(agent.id, `Failed the same way on ${next.dispatches} dispatches; giving up on this step.`, 'failed');
            }
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
  };

  await runWaves(finalize);

  const pendingAgents = () => effTemplate.agents.filter((a) => !done.has(a.id));

  // Whether a re-dispatch could still finish anything. Every unfinished agent is
  // either given up on (its write failed the same way twice), or blocked behind
  // one that is — transitively: an agent is retryable only if it is not exhausted
  // AND each dependency it has is done or itself retryable. When nothing is, the
  // remaining dispatches would each wake up, run no agent, and return
  // `incomplete` again until `maxJobAttempts` finalized — so finalize NOW: run
  // the deferred steps best-effort, degrade the rest, deliver the report.
  const retryable = (): AgentSpec[] => {
    const set = new Set(pendingAgents().filter((a) => !exhausted(a.id)).map((a) => a.id));
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of set) {
        const deps = depsOf(byId.get(id)!, producers);
        if ([...deps].some((d) => byId.has(d) && !done.has(d) && !set.has(d))) {
          set.delete(id);
          changed = true;
        }
      }
    }
    return effTemplate.agents.filter((a) => set.has(a.id));
  };
  let finalizing = finalize;
  if (!finalizing && pendingAgents().length && !jobSpend.budget().exceeded && !retryable().length) {
    finalizing = true;
    // `assembling`, not `planning`: the phase is what a client looks up in the
    // manifest for its step label, so the buyer read "Planning" in bold over a line
    // that said "Assembling the report." (round 7, R7-19).
    await emit('assembling', 'No unfinished step can still be retried; finishing the report now.', 'assembling');
    await runWaves(true);
  }

  const pending = pendingAgents();

  // Say WHICH kind of incomplete this is, on the surface an admin reads. The two are
  // not the same fact and one of them is not a problem: "three steps failed and will
  // be retried" is a job to look at; "the dispatch ran out of clock with three steps
  // still to start" is the design working. Pushed BEFORE `snapshot()` so it rides in
  // the checkpoint and the finished job's trace still shows how many dispatches the
  // clock cost — which is the thing C5 wanted visible and nothing recorded.
  // `warnings` is admin-only and in English; the buyer's progress line is unchanged,
  // and it already says the right thing, which is that this will resume.
  if (stoppedOnDeadline && pending.length) {
    warnings.push(
      `Dispatch stopped at its wall-clock budget with ${pending.length} step(s) not started; a re-dispatch resumes them from the checkpoint.`,
    );
  }

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
  // Before the early returns below, not only at the end: a dispatch that ends
  // `incomplete` or `held` still raised whatever it raised.
  if (warnings.length) trace.warnings = warnings;
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
    await emit('held', `Held at the cost ceiling with ${pending.length} step(s) unfinished — awaiting review.`, 'held');
    return { report, meta: makeMeta(), sources: evidence.sources, language, turnsUsed: counter.turns, trace, checkpoint };
  }

  // Not finalizing yet → return 'incomplete' so a re-dispatch resumes the rest.
  if (pending.length && !finalizing) {
    trace.status = 'incomplete';
    trace.durationMs = Date.now() - Date.parse(trace.startedAt);
    trace.finishedAt = new Date().toISOString();
    await persistTrace();
    await emit('incomplete', `Incomplete: ${pending.length} step(s) still pending — will resume.`, 'incomplete');
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
  //
  // `delivered` is what a PRODUCER finished — not `ownedKeys`, which folds
  // `enriches` in. An enricher's key is a rewrite of someone else's section, and
  // on the finalize pass an enricher whose producer was given up on runs anyway,
  // best-effort, with `current = {}`: it writes the section out of whatever
  // context exists. Counting that as delivered labelled the result `unenriched`,
  // whose buyer copy says the section "was researched and written… complete and
  // sourced as usual" — false in every clause (round 7, R7-1).
  //
  // So it is its own state. The body STAYS: an enricher with other finished
  // dependencies (chart-refiner depends on three agents, one of which produces
  // `charts`) writes from real sections, and blanking that would throw away work
  // the buyer paid for. Only the label changes, and it says what happened.
  const delivered = new Set<string>();
  for (const agent of effTemplate.agents) {
    if (done.has(agent.id)) for (const key of agent.produces ?? []) delivered.add(key);
  }
  const rebuilt = new Set<string>();
  for (const agent of effTemplate.agents) {
    if (!done.has(agent.id)) continue;
    // Nothing to keep if the enricher's write left the key empty — that is `lost`.
    for (const key of agent.enriches ?? []) if (!delivered.has(key) && report[key] !== undefined) rebuilt.add(key);
  }

  // Severity, so a re-dispatch's statuses (carried in `degraded`) are upgraded and
  // never downgraded: a section nobody wrote is not merely shallow, and one only an
  // enricher wrote is not merely shallow either.
  const RANK: Record<SectionStatus['status'], number> = { unenriched: 0, reconstructed: 1, lost: 2 };
  const mark = (key: string, status: SectionStatus['status']): void => {
    const at = degraded.findIndex((d) => d.key === key);
    if (at === -1) degraded.push({ key, status });
    else if (RANK[status] > RANK[degraded[at]!.status]) degraded[at]!.status = status;
  };

  for (const agent of pending) {
    const reason = agentReason(trace, agent.id, writeFailures[agent.id]);
    // The placeholder the BUYER reads is ours and localized; the internal reason
    // goes to `warnings` (admin-side) on the next line, never into the report.
    const lost = ownedKeys(agent).filter((key) => !delivered.has(key) && !rebuilt.has(key));
    for (const key of lost) {
      report[key] = degradedValue(effTemplate, key, degradedSectionNote(language));
      mark(key, 'lost');
    }
    // A key an enricher wrote without its producer: real text, honestly labelled.
    const reconstructed = ownedKeys(agent).filter((key) => rebuilt.has(key));
    for (const key of reconstructed) mark(key, 'reconstructed');
    // Still worth a warning even when nothing was lost: a step that never finished
    // is a step the admin should see, and "kept" says the section survived it.
    const kept = ownedKeys(agent).filter((key) => delivered.has(key));
    // …and now it says it to the BUYER too. A kept key means the section exists and
    // this step did not run on it — for a refiner, exactly the depth the tier was
    // sold on. The body stays; only the label is added.
    for (const key of kept) mark(key, 'unenriched');
    warnings.push(
      `Degraded [${lost.join(', ') || 'none'}] from agent "${agent.id}" after exhausting retries/re-dispatches: ${reason}` +
        (kept.length ? ` (kept, already written: ${kept.join(', ')})` : '') +
        (reconstructed.length ? ` (rebuilt by a later pass: ${reconstructed.join(', ')})` : ''),
    );
  }

  // Derived sections (e.g. sources) — deterministic, filled last.
  await emit('assembling', 'Assembling report.', 'assembling');
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

  await emit(failed ? 'failed' : 'done', failed ? `Report failed: ${reason}` : 'Report complete.', failed ? 'failed' : 'done');
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
function agentReason(trace: JobTrace, agentId: string, failure?: WriteFailure): string {
  const at = trace.agents.find((a) => a.id === agentId);
  const error = at?.error ? (at.error.split('\n')[0] ?? '').slice(0, 300) : undefined;
  // Given up on, not merely out of retries: the admin reading this warning should
  // see that the same write failed the same way twice, and what "the same way" was.
  if (failure && writeFailureExhausted(failure)) {
    return `the write failed the same way on ${failure.dispatches} dispatches [${failure.signature}]: ${error ?? '(no error recorded)'}`;
  }
  if (error) return error;
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
  emit: (phase: string, message: string, kind: ProgressKind, detail?: string) => Promise<void> | undefined;
  trace: AgentTrace;
  /** Every paid call inside this agent writes here as it happens, so a failed
   *  attempt's spend is still known to the caller. */
  spend: CostSink;
  /** Cross-attempt (and, via the checkpoint, cross-dispatch) state for THIS agent: has its research loop already run? */
  research: { done: boolean; touched: Set<string>; fetched: Set<string> };
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
          `not headings. A briefing made of bare URLs tells the next step nothing. Under ${MAX_HANDOFF_CHARS} ` +
          'characters: anything past that is cut.',
      ),
  });
  const synthModel = resolveModel(agent.model ?? config.llm.defaultSynthModel);
  const context = contextFor(template, agent, report, ctx.handoffs);

  const note = (m: string, kind: ProgressKind = 'researching', detail?: string) => {
    if (trace.notes.length < MAX_NOTES) trace.notes.push(`${new Date().toISOString()} ${m}`);
    return ctx.emit(agent.id, m, kind, detail);
  };

  if (hasResearchLoop(agent)) {
    const gatherModel: ResolvedModel = resolveModel(agent.gatherModel ?? config.llm.defaultGatherModel);
    const budget = agentTurns(agent.researchBudget, depth.budgetScale);
    const sites = effectiveSites(template, agent);
    if (sites.length) await note(`Suggested sources (additive): ${sites.join(', ')}.`, 'researching');
    // A retry after a failed WRITE reuses what the last attempt bought. The
    // evidence store is shared and still holds it; re-running the loop would not
    // recover anything, it would go and buy more of the same.
    if (ctx.research.done) {
      await note(`Reusing evidence already gathered (${evidence.sources.length} sources, ${evidence.extracted.length} pages).`, 'reusing');
    } else {
      await note(`Researching (${owned.join(', ')}).`, 'researching');
      // Turns are counted as they are charged (like cost), not when the loop
      // returns: a loop that throws still spent them, and the progress line's
      // turn count used to lag a whole loop behind.
      const turnsBefore = trace.turnsUsed;
      const gres = await gather({
        spend: ctx.spend,
        touched: ctx.research.touched,
        fetched: ctx.research.fetched,
        onTurn: () => {
          counter.turns += 1;
          trace.turnsUsed += 1;
        },
        model: gatherModel,
        system,
        messages: [{ role: 'user', text: buildAgentKickoff({ agent, brief, sections, maxTurns: budget, handoffs: context.handoffs, current: context.current, sites }) }],
        maxTurns: budget,
        evidence,
        onNote: (m, kind, detail) => note(m, kind, detail),
      });
      // `gres.turns` and what `onTurn` counted agree by construction; the loop's
      // own figure is the one kept for the row (a retried agent's row starts from
      // the carried value and this pass adds to it).
      trace.turnsUsed = turnsBefore + gres.turns;
      trace.gatherStop = gres.stop;
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

    await note(`Writing (${owned.join(', ')}).`, 'writing');
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
            touched: ctx.research.touched,
            fetched: ctx.research.fetched,
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
            touched: ctx.research.touched,
            fetched: ctx.research.fetched,
            lang: language,
            depthDirective,
          });
    const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema, spend: ctx.spend });
    return splitHandoff(guardPromptEcho(sres.value as Record<string, unknown>, system, language, note));
  }

  // synthesizer — compose from upstream only.
  await note(`Composing (${owned.join(', ')}).`, 'composing');
  const text = buildSynthesizerPrompt({ agent, brief, sections, context: context.sections, handoffs: context.handoffs, current: context.current, lang: language, depthDirective });
  const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema, spend: ctx.spend });
  return splitHandoff(guardPromptEcho(sres.value as Record<string, unknown>, system, language, note));
}

/**
 * Our own prompt, refused on its way into the report.
 *
 * Compared against the SYSTEM prompt alone, deliberately. The user message carries
 * the evidence — the fetched pages, the snippets, the upstream sections — and a
 * report is supposed to quote those; guarding against them would delete the
 * product to protect a sentence that is not a secret. What must never come back out
 * is the instructions.
 *
 * A hit empties the FIELD, not the section: the rest of the write is usually fine,
 * and an agent whose overview was a transcription still found real listings. The
 * buyer reads the same "we could not complete this" line a degraded section uses —
 * they cannot act on the difference, and explaining our prompt handling to whoever
 * asked for it is the last thing this should do. The ADMIN gets the field paths.
 */
function guardPromptEcho(
  value: Record<string, unknown>,
  system: string,
  language: string,
  note: (m: string, kind?: ProgressKind, detail?: string) => unknown,
): Record<string, unknown> {
  const { value: clean, redacted } = redactPromptEcho(value, system, degradedSectionNote(language));
  if (redacted.length) {
    void note(`Removed ${redacted.length} field(s) that repeated this agent's own instructions.`, 'composing');
  }
  return clean as Record<string, unknown>;
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
  // By code point, not UTF-16 unit: a cut through an emoji left a lone surrogate
  // in the checkpoint.
  const chars = Array.from(text);
  return { slice, handoff: chars.length > MAX_HANDOFF_CHARS ? `${chars.slice(0, MAX_HANDOFF_CHARS).join('')}…` : text };
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

/**
 * The array-valued parts of a section, before and after a rewrite: the section
 * itself if it is an array (`charts`, `shortlist`), and each array field one
 * level down if it is an object (`findings.listings`). Deeper than that a rewrite
 * is restructuring, not shrinking.
 */
function arrayFields(key: string, before: unknown, after: unknown): Array<[string, number, number]> {
  if (Array.isArray(before) && Array.isArray(after)) return [[key, before.length, after.length]];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const out: Array<[string, number, number]> = [];
    for (const [k, v] of Object.entries(before as Record<string, unknown>)) {
      const w = (after as Record<string, unknown>)[k];
      if (Array.isArray(v) && Array.isArray(w)) out.push([`${key}.${k}`, v.length, w.length]);
    }
    return out;
  }
  return [];
}

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
