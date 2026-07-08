/**
 * Template well-formedness checks — the safety net that makes adding agents,
 * sections, and models non-breaking. Run at registration time and in CI, so a
 * malformed template fails fast instead of corrupting a live run.
 */
import { config } from '../config.js';
import { modelAliases } from '../llm/models.js';
import type { AgentSpec, ResearchTemplate } from './types.js';

export function validateTemplate(t: ResearchTemplate<any>): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`[${t.id}] ${m}`);

  // Sections: unique keys.
  const sectionKeys = new Set<string>();
  for (const s of t.sections) {
    if (sectionKeys.has(s.key)) err(`duplicate section key "${s.key}"`);
    sectionKeys.add(s.key);
    if (s.derived && !s.derive) err(`section "${s.key}" is derived but has no derive()`);
  }

  // Agents: unique ids, valid section references, valid model aliases.
  const agentIds = new Set<string>();
  const aliases = new Set(modelAliases());
  const known = (a?: string) => a == null || aliases.has(a);
  const producedBy = new Map<string, string>();

  for (const a of t.agents) {
    if (agentIds.has(a.id)) err(`duplicate agent id "${a.id}"`);
    agentIds.add(a.id);
    for (const k of a.produces ?? []) {
      if (!sectionKeys.has(k)) err(`agent "${a.id}" produces unknown section "${k}"`);
      const s = t.sections.find((x) => x.key === k);
      if (s?.derived) err(`agent "${a.id}" produces derived section "${k}" (fill via derive())`);
      if (producedBy.has(k)) err(`section "${k}" produced by both "${producedBy.get(k)}" and "${a.id}"`);
      producedBy.set(k, a.id);
    }
    for (const k of a.enriches ?? []) {
      if (!sectionKeys.has(k)) err(`agent "${a.id}" enriches unknown section "${k}"`);
    }
    if (!known(a.model)) err(`agent "${a.id}" uses unknown model alias "${a.model}"`);
    if (!known(a.gatherModel)) err(`agent "${a.id}" uses unknown gatherModel alias "${a.gatherModel}"`);
    if (a.role === 'producer' && !(a.produces?.length || a.enriches?.length)) {
      err(`producer "${a.id}" has no sections`);
    }
  }

  // Every non-derived section must have a producer.
  for (const s of t.sections) {
    if (!s.derived && !producedBy.has(s.key)) err(`section "${s.key}" has no producing agent`);
  }

  // Mode configs may only exclude sections that exist.
  for (const [modeKey, cfg] of Object.entries(t.modes ?? {})) {
    for (const k of cfg?.exclude ?? []) {
      if (!sectionKeys.has(k)) err(`mode "${modeKey}" excludes unknown section "${k}"`);
    }
  }

  // Dependencies + enriched sections must reference existing agents/producers.
  for (const a of t.agents) {
    for (const d of a.dependsOn ?? []) {
      if (!agentIds.has(d)) err(`agent "${a.id}" depends on unknown agent "${d}"`);
    }
    for (const k of a.enriches ?? []) {
      const p = producedBy.get(k);
      if (!p) err(`agent "${a.id}" enriches "${k}" but no agent produces it`);
      else if (p === a.id) err(`agent "${a.id}" enriches its own section "${k}"`);
    }
  }

  // Default aliases must exist.
  if (!aliases.has(config.llm.defaultSynthModel)) err(`default synth alias "${config.llm.defaultSynthModel}" not registered`);
  if (!aliases.has(config.llm.defaultGatherModel)) err(`default gather alias "${config.llm.defaultGatherModel}" not registered`);

  // Acyclic DAG.
  if (hasCycle(t)) err('agent dependency graph has a cycle');

  return errors;
}

/** Throws if any registered template is malformed. Called at module load. */
export function assertTemplatesValid(templates: ResearchTemplate<any>[]): void {
  const errors = templates.flatMap(validateTemplate);
  if (errors.length) throw new Error(`Invalid research template(s):\n- ${errors.join('\n- ')}`);
}

function depsOf(a: AgentSpec, producedBy: Map<string, string>): Set<string> {
  const deps = new Set(a.dependsOn ?? []);
  for (const k of a.enriches ?? []) {
    const p = producedBy.get(k);
    if (p && p !== a.id) deps.add(p);
  }
  return deps;
}

function hasCycle(t: ResearchTemplate<any>): boolean {
  const producedBy = new Map<string, string>();
  for (const a of t.agents) for (const k of a.produces ?? []) producedBy.set(k, a.id);
  const byId = new Map(t.agents.map((a) => [a.id, a]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen,1=in-stack,2=done

  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    const a = byId.get(id);
    if (a) for (const d of depsOf(a, producedBy)) if (byId.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return t.agents.some((a) => visit(a.id));
}
