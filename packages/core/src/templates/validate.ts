/**
 * Template well-formedness checks — the safety net that makes adding agents,
 * sections, and models non-breaking. Run at registration time and in CI, so a
 * malformed template fails fast instead of corrupting a live run.
 */
import { z } from 'zod';
import { config } from '../config.js';
import { modelAliases } from '../llm/models.js';
import { validateDirectives } from './directives.js';
// The leaf module, not the registry: the registry imports THIS file.
import { LANGUAGE_LABELS } from '../languages.js';
import { agentKind, hasResearchLoop } from './types.js';
import type { AgentSpec, ResearchTemplate } from './types.js';

const SUPPORTED_LANGS = Object.keys(LANGUAGE_LABELS);
const DEFAULT_LANG = 'en';

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
    // `focus` is rendered by `buildAgentKickoff` and by nothing else, and only a
    // producer gets a kickoff — a synthesizer has no research loop at all. So a
    // `focus` on a synthesizer is a sentence the model never reads, and the author
    // has no way to find that out: two of them sat in the flagship for months, one
    // of them saying the OPPOSITE of what the shipped prompt said (round 7, R7-18).
    // What a synthesizer needs to be told about its writing belongs in the
    // `guidance` of the section it writes, which does reach it.
    if (a.focus && !hasResearchLoop(a)) {
      err(
        `${agentKind(a)} "${a.id}" declares \`focus\`, which only the research kickoff renders — an agent with no ` +
          `research loop never reads it. Put what it needs to know into the guidance of the section it writes.`,
      );
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
    // A price, and a price is a positive whole number of credits (N11).
    //
    // `credits: 0` compiles, validates, renders in the manifest as free, and then
    // 500s the buyer on submit: `consumeCredits` reaches `applyEntry`, whose
    // "amounts must be positive whole numbers" guard throws something that is not
    // an `InsufficientCreditsError`, so the route rethrows it. A free mode is a
    // pricing decision that has never been made, and the way to make one is not a
    // stack trace on someone's first report. `undefined` is untouched — that is the
    // code default (5/18), which is always positive.
    if (cfg?.credits !== undefined && (!Number.isInteger(cfg.credits) || cfg.credits <= 0)) {
      err(`mode "${modeKey}" costs ${cfg.credits} credits; a mode's price must be a positive whole number`);
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

  // Structured directives: well-formed, and actually accepted by paramsSchema.
  if (t.directives) {
    for (const e of validateDirectives(t.directives)) err(e);
    // The declaration and the schema are two halves of one contract: a field the
    // manifest advertises but `paramsSchema` rejects fails only in production, on
    // a real user's submit. Catch it at load instead.
    const props = (z.toJSONSchema(t.paramsSchema) as { properties?: Record<string, unknown> }).properties ?? {};
    if (!(t.directives.key in props)) {
      err(`declares directives under "${t.directives.key}" but paramsSchema has no such property`);
    }
  }

  // Localization coverage: a template that speaks a second language must speak
  // them ALL, and cover every section in each.
  //
  // This is the check that was missing. `SUPPORTED_LANGS` is global and the API
  // publishes it, so a buyer picks French, the engine is told to write French
  // prose — and the manifest hands back English section titles, mode labels and
  // field help, because `i18n` only ever had `es`. The body is in their language
  // under headings that are not, on screen and in the PDF, for two of the four
  // languages we sell in. Nothing failed; it just shipped.
  //
  // Only enforced for a template that declares `i18n` at all. One with none is
  // consistently English — a fixture, or a model that has not been localized yet —
  // and that is a different (visible) decision from a half-translated one.
  if (t.i18n) {
    for (const lang of SUPPORTED_LANGS) {
      if (lang === DEFAULT_LANG) continue;
      if (!t.i18n[lang]) err(`is localized but has no "${lang}" block, and the API publishes "${lang}"`);
    }
    for (const [lang, block] of Object.entries(t.i18n)) {
      const missing = t.sections.filter((s) => !block.sectionTitles?.[s.key]).map((s) => s.key);
      // Section titles specifically: they are the headings on the artifact the
      // buyer keeps and forwards, so a silent per-string fallback is at its most
      // visible here.
      if (missing.length) err(`"${lang}" is missing section titles: ${missing.join(', ')}`);
      // The cover is the FIRST page of the artifact the buyer keeps, and its
      // labels were the one localized string with no reader: `CoverSpec.labelKey`
      // is documented as looked up in `TemplateI18n.cover`, and both renderers
      // fell back to their own dictionaries instead — dictionaries filled with the
      // flagship's vocabulary, in all four languages. So this model looked right
      // and the next one printed `combinedSde` as a heading.
      //
      // English is exempt: `humanizeKey` turns a camelCase key into a passable
      // English label ("Price range"), which is why the defect was invisible.
      const keys = [
        ...(t.cover?.figures ?? []).map((x) => x.labelKey),
        ...(t.cover?.tiles ?? []).map((x) => x.labelKey),
      ];
      const noLabel = [...new Set(keys)].filter((k) => !block.cover?.[k]);
      if (noLabel.length) err(`"${lang}" is missing cover labels: ${noLabel.join(', ')}`);
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
