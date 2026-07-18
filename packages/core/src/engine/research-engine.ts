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
import { addCost, emptyCost, type Cost } from '../cost.js';
import { resolveDepthProfile, type DepthProfile } from '../depth.js';
import { resolveMode } from '../mode.js';
import { resolveModel, type ResolvedModel } from '../llm/index.js';
import type { SearchResult } from '../tools/web-search.js';
import {
  reportSchemaOf,
  sectionByKey,
  sectionSubsetSchema,
  type AgentSpec,
  type ReportSection,
  type ResearchTemplate,
} from '../templates/types.js';
import { createEvidence, gather, type Evidence } from './gather.js';
import { synthesizeStructured } from './synthesize.js';
import {
  buildAgentKickoff,
  buildEnricherSynthPrompt,
  buildProducerSynthPrompt,
  buildSynthesizerPrompt,
  buildSystemPrompt,
  isLanguage,
  type Language,
} from './prompt.js';

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
  /** Agent ids that failed and were filled with a degraded placeholder. */
  degradedSections?: string[];
}

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
  /** 'incomplete' = some steps still failing; the job will be re-dispatched to resume. */
  status: 'running' | 'completed' | 'failed' | 'incomplete';
  /** Job-level fatal error (e.g. final schema validation), if any. */
  error?: string;
  /** Warnings worth reviewing later (e.g. sections degraded after exhausting retries). */
  warnings?: string[];
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
  /** Agent ids already completed — skipped on resume. */
  doneAgentIds: string[];
  degraded: string[];
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
}

/** Max notes kept per agent (bounds trace size). */
const MAX_NOTES = 300;

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
  const degraded: string[] = [...(input.resume?.degraded ?? [])];
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

  const waves = topoSortAgents(effTemplate);
  const producers = producerOf(effTemplate);
  const byId = new Map(effTemplate.agents.map((a) => [a.id, a]));
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
    cost: addCost(input.resume?.cost ?? emptyCost(), input.baseCost ?? emptyCost()),
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
  const saveCheckpoint = async () =>
    input.onCheckpoint?.({ report, sources: evidence.sources, doneAgentIds: [...done], degraded, agentTraces: slimAgents(), cost: trace.cost });

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
      trace.agents.push(at);

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

      // In-run retries with exponential backoff — keep trying the step.
      for (let attempt = 1; attempt <= config.workflow.agentMaxAttempts; attempt++) {
        at.attempts = attempt;
        try {
          const { slice, cost } = await runAgent({ template: effTemplate, agent, brief, language, depth, system, evidence, report, counter, emit, trace: at });
          Object.assign(report, slice);
          at.status = 'ok';
          at.output = slice;
          at.cost = cost;
          trace.cost = addCost(trace.cost, cost);
          done.add(agent.id);
          break;
        } catch (err) {
          at.status = 'failed';
          at.error = (err as Error).stack ?? (err as Error).message ?? String(err);
          if (attempt < config.workflow.agentMaxAttempts) {
            const backoff = backoffMs(attempt);
            at.notes.push(`${new Date().toISOString()} retry ${attempt} after: ${(err as Error).message}`);
            await emit(agent.id, `Retry ${attempt}/${config.workflow.agentMaxAttempts - 1} after error; backing off ${Math.round(backoff)}ms.`);
            await sleep(backoff);
          } else {
            await emit(agent.id, `Failed after ${attempt} attempts: ${(err as Error).message}`);
          }
        }
      }
      at.durationMs = Date.now() - Date.parse(at.startedAt);
      at.finishedAt = new Date().toISOString();
      if (at.status === 'ok') await saveCheckpoint();
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
    ...(degraded.length ? { degradedSections: degraded } : {}),
  });
  const checkpoint: Checkpoint = { report, sources: evidence.sources, doneAgentIds: [...done], degraded, agentTraces: slimAgents(), cost: trace.cost };

  // Not finalizing yet → return 'incomplete' so a re-dispatch resumes the rest.
  if (pending.length && !finalize) {
    trace.status = 'incomplete';
    trace.durationMs = Date.now() - Date.parse(trace.startedAt);
    trace.finishedAt = new Date().toISOString();
    await persistTrace();
    await emit('incomplete', `Incomplete: ${pending.length} step(s) still pending — will resume.`);
    return { report, meta: makeMeta(), sources: evidence.sources, language, turnsUsed: counter.turns, trace, checkpoint };
  }

  // Finalizing with unfinished steps → degrade them (WARNING) and deliver the rest.
  for (const agent of pending) {
    const reason = agentReason(trace, agent.id);
    for (const key of ownedKeys(agent)) {
      report[key] = degradedValue(effTemplate, key, reason);
      if (!degraded.includes(key)) degraded.push(key);
    }
    warnings.push(`Degraded [${ownedKeys(agent).join(', ')}] from agent "${agent.id}" after exhausting retries/re-dispatches: ${reason}`);
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

  const failed = !!fatalError;
  trace.status = failed ? 'failed' : 'completed';
  if (fatalError) trace.error = fatalError;
  if (warnings.length) trace.warnings = warnings;
  trace.durationMs = Date.now() - Date.parse(trace.startedAt);
  trace.finishedAt = new Date().toISOString();
  await persistTrace();

  await emit(failed ? 'failed' : 'done', failed ? `Report failed: ${fatalError}` : 'Report complete.');
  return {
    report: parsed.success ? parsed.data : report,
    meta: makeMeta(),
    sources: evidence.sources,
    language,
    turnsUsed: counter.turns,
    trace,
    checkpoint: { report, sources: evidence.sources, doneAgentIds: [...done], degraded, agentTraces: slimAgents(), cost: trace.cost },
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
}): Promise<{ slice: Record<string, unknown>; cost: Cost }> {
  const { template, agent, brief, language, depth, system, evidence, report, counter, trace } = ctx;
  const depthDirective = depth.directive;
  const owned = ownedKeys(agent);
  const sections = owned.map((k) => sectionByKey(template, k)).filter(Boolean) as ReportSection[];
  const schema = sectionSubsetSchema(template, owned);
  const synthModel = resolveModel(agent.model ?? config.llm.defaultSynthModel);
  const context = contextFor(template, agent, report);

  const note = (m: string) => {
    if (trace.notes.length < MAX_NOTES) trace.notes.push(`${new Date().toISOString()} ${m}`);
    return ctx.emit(agent.id, m);
  };

  if (agent.role === 'producer') {
    const gatherModel: ResolvedModel = resolveModel(agent.gatherModel ?? config.llm.defaultGatherModel);
    const budget = Math.max(2, Math.round((agent.researchBudget ?? config.search.maxTurns) * depth.budgetScale));
    const sites = effectiveSites(template, agent);
    if (sites.length) await note(`Suggested sources (additive): ${sites.join(', ')}.`);
    await note(`Researching (${owned.join(', ')}).`);
    const gres = await gather({
      model: gatherModel,
      system,
      messages: [{ role: 'user', text: buildAgentKickoff({ agent, brief, sections, maxTurns: budget, context, sites }) }],
      maxTurns: budget,
      evidence,
      onNote: (m) => note(m),
    });
    counter.turns += gres.turns;
    trace.turnsUsed = gres.turns;

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
            context,
            lang: language,
            depthDirective,
          });
    const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema });
    return { slice: sres.value as Record<string, unknown>, cost: addCost(gres.cost, sres.cost) };
  }

  // synthesizer — compose from upstream only.
  await note(`Composing (${owned.join(', ')}).`);
  const text = buildSynthesizerPrompt({ agent, brief, sections, context, lang: language, depthDirective });
  const sres = await synthesizeStructured({ model: synthModel, system, messages: [{ role: 'user', text }], schema });
  return { slice: sres.value as Record<string, unknown>, cost: sres.cost };
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
): Record<string, unknown> {
  const producers = producerOf(template);
  const byId = new Map(template.agents.map((a) => [a.id, a]));
  const keys = new Set<string>();
  for (const depId of depsOf(agent, producers)) {
    for (const k of ownedKeys(byId.get(depId) ?? ({} as AgentSpec))) keys.add(k);
  }
  return pick(report, [...keys]);
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
function degradedValue(template: ResearchTemplate<any>, key: string, reason: string): unknown {
  const section = sectionByKey(template, key);
  if (!section) return null;
  const note = `_Section unavailable: ${reason}._`;
  return emptyFromJsonSchema(z.toJSONSchema(section.schema) as Record<string, unknown>, note);
}

/** Build a minimal schema-valid value; put the note into the first string field. */
function emptyFromJsonSchema(node: Record<string, unknown>, note: string, usedNote = { done: false }): unknown {
  const root = node;
  const resolve = (n: Record<string, unknown>): Record<string, unknown> => {
    if (typeof n.$ref === 'string') {
      const name = (n.$ref as string).replace(/^#\/(?:\$defs|definitions)\//, '');
      const defs = (root.$defs ?? root.definitions ?? {}) as Record<string, Record<string, unknown>>;
      return defs[name] ?? n;
    }
    const union = (n.anyOf ?? n.oneOf) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(union)) return union.find((s) => s.type !== 'null') ?? n;
    return n;
  };
  const build = (n0: Record<string, unknown>): unknown => {
    const n = resolve(n0);
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
        if (!usedNote.done) {
          usedNote.done = true;
          return note;
        }
        return '';
    }
  };
  return build(root);
}
