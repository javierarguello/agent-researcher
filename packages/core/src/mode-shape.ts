/**
 * What a mode actually DOES to a template — the numbers, in one place.
 *
 * The engine filters a template by its mode's `exclude` and scales every research
 * budget by `budgetScale`, and those two lines are what make one tier cheaper than
 * another. Nothing outside the engine could see the result: an admin setting a
 * tier's price had no way to know it buys 40 turns or 92, and answering it in the
 * admin would have meant a second copy of the arithmetic — one that can disagree
 * with the one that runs.
 *
 * So the filter is extracted here and the ENGINE calls it too. A shape this file
 * reports is a shape a job will have.
 */
import { config } from './config.js';
import { hasResearchLoop, type ResearchTemplate } from './templates/types.js';
import { modesOf, type ModeConfig, type ReportMode } from './mode.js';

/**
 * The template a job of this mode actually runs: sections the mode excludes are
 * gone, and an agent left with nothing to produce or enrich goes with them.
 */
export function effectiveTemplate<T>(template: ResearchTemplate<T>, mode: ModeConfig): ResearchTemplate<T> {
  const exclude = new Set(mode.exclude ?? []);
  return {
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
}

/** One agent's research budget under a mode — the engine's own line, shared. */
export function agentTurns(researchBudget: number | undefined, budgetScale: number): number {
  // `Math.max(2, …)`: the engine refuses to give a researching agent fewer than two
  // turns however hard a mode scales down, so a naive `Σ budget × scale` overstates
  // how cheap a light tier is.
  return Math.max(2, Math.round((researchBudget ?? config.search.maxTurns) * budgetScale));
}

export interface ModeShape {
  key: ReportMode;
  label?: string;
  budgetScale: number;
  depth: string;
  /** Sections a report of this tier contains. */
  sections: number;
  /** Agents that run — one dropped entirely when its only sections are excluded. */
  agents: number;
  /** Of those, the ones that research (the rest only write). */
  researchers: number;
  /** The most research turns a job of this tier can spend, summed per agent. */
  maxTurns: number;
}

/** Every tier a template offers, with what each one buys. */
export function modeShapes<T>(template: ResearchTemplate<T>): ModeShape[] {
  return modesOf(template.modes).map(([key, cfg]) => {
    const eff = effectiveTemplate(template, cfg);
    const researchers = eff.agents.filter(hasResearchLoop);
    return {
      key,
      ...(cfg.label ? { label: cfg.label } : {}),
      budgetScale: cfg.budgetScale,
      depth: cfg.depth,
      sections: eff.sections.length,
      agents: eff.agents.length,
      researchers: researchers.length,
      maxTurns: researchers.reduce((n, a) => n + agentTurns(a.researchBudget, cfg.budgetScale), 0),
    };
  });
}
