/**
 * Pre-flight review of a research request — what the confirm dialog shows before
 * credits are spent.
 *
 * Two layers, and the split is the whole point:
 *  - DETERMINISTIC (always, free, unforgeable): a plain-language summary rendered
 *    from the validated params, plus rule-based findings. Same input → same output.
 *  - ASSISTED (cheap model, only when it's worth it): typo/format corrections on a
 *    whitelist of fields, plus extra finding codes. Its output is constrained to a
 *    closed vocabulary and re-validated, so it can add value without becoming a
 *    channel for anything the user typed.
 *
 * When the assisted layer is unavailable — outage, cooldown, or a balance too low
 * to generate anything — the preview degrades to the deterministic layer instead
 * of disappearing. It never blocks a generation.
 */
import { deterministicIssues, issueMessage, renderPlan, type PreflightIssue } from './deterministic.js';
import { enrichRequest, applyCorrections, type Correction } from './enrich.js';
import { assistMessage, type AssistState, type Lang } from './copy.js';
import { applyProposals, proposeFromText, type Proposals } from './enrich.js';
import type { ResearchTemplate } from '../templates/types.js';

export type PreflightQuality = 'ok' | 'broad' | 'ambiguous';

export interface PreflightOutcome {
  /** Deterministic, user-facing description of what will be researched. */
  summary: string;
  quality: PreflightQuality;
  issues: PreflightIssue[];
  /** Proposed fixes, as a diff. Applying them is the client's (user's) choice. */
  corrections: Correction[];
  /** The params with every proposed correction applied, ready to submit as-is. */
  correctedParams?: Record<string, unknown>;
  /**
   * What the buyer's own words (`freeText`) turned into: directive values from
   * the template's vocabularies and a few keywords — PROPOSALS, shown as a diff,
   * applied only if the buyer accepts. Present only when text was given and the
   * assisted pass ran.
   */
  proposals?: Proposals;
  /** `correctedParams` (or the params) with the proposals applied too. */
  proposedParams?: Record<string, unknown>;
  /** Whether the assisted pass ran, and why not when it didn't. */
  assist: { state: AssistState; message?: string };
  /** Token usage + dollars of the assisted pass, for per-user metering. */
  usage?: { inputTokens: number; outputTokens: number; usd: number };
}

/** Deterministic findings imply a quality floor even without a model. */
function qualityFromIssues(issues: PreflightIssue[]): PreflightQuality {
  if (issues.some((i) => i.code === 'contradictory_range' || i.code === 'request_ambiguous')) return 'ambiguous';
  if (issues.some((i) => i.code === 'no_narrowing_filter' || i.code === 'scope_too_broad' || i.code === 'missing_subject')) return 'broad';
  return 'ok';
}

const RANK: Record<PreflightQuality, number> = { ok: 0, broad: 1, ambiguous: 2 };
const worst = (a: PreflightQuality, b: PreflightQuality): PreflightQuality => (RANK[a] >= RANK[b] ? a : b);

export async function runPreflight(input: {
  template: ResearchTemplate<any>;
  params: Record<string, unknown>;
  lang: Lang;
  modeLabel: string;
  /** 'on' runs the assisted pass; any other state explains why it was skipped. */
  assist: AssistState;
  /** What the buyer typed in their own words — read by the assist to propose params; never a param itself. */
  freeText?: string;
}): Promise<PreflightOutcome> {
  const { template, params, lang, modeLabel } = input;

  const issues = deterministicIssues(template, params, lang);
  const base: PreflightOutcome = {
    summary: renderPlan(template, params, { lang, modeLabel }),
    quality: qualityFromIssues(issues),
    issues,
    corrections: [],
    assist: { state: input.assist, ...(assistMessage(input.assist, lang) ? { message: assistMessage(input.assist, lang) } : {}) },
  };
  if (input.assist !== 'on') return base;

  const enriched = await enrichRequest(template, params);
  const proposed = input.freeText?.trim() ? await proposeFromText(template, params, input.freeText) : undefined;

  // Merge the model's codes into the deterministic findings (never duplicating one).
  const merged = [...issues];
  for (const code of enriched.issueCodes) {
    if (merged.some((i) => i.code === code)) continue;
    const message = issueMessage(template, code, lang);
    if (message) merged.push({ code, message, severity: 'info' });
  }

  // The summary is re-rendered from the CORRECTED params, so the user reads the
  // request as it would actually run — still without a word written by the model.
  const correctedParams = enriched.corrections.length ? applyCorrections(params, enriched.corrections) : undefined;
  const proposals = proposed && (Object.keys(proposed.proposals.directives).length || proposed.proposals.keywords.length) ? proposed.proposals : undefined;
  const proposedParams = proposals ? applyProposals(correctedParams ?? params, proposals, template.directives?.key ?? 'directives') : undefined;
  const usage = [enriched.usage, proposed?.usage].filter(Boolean).reduce<PreflightOutcome['usage']>(
    (acc, u) => (acc ? { inputTokens: acc.inputTokens + u!.inputTokens, outputTokens: acc.outputTokens + u!.outputTokens, usd: acc.usd + u!.usd } : u),
    undefined,
  );

  return {
    // The summary is rendered from the params as they would run if the buyer
    // accepts everything — still without a word written by the model.
    summary: renderPlan(template, proposedParams ?? correctedParams ?? params, { lang, modeLabel }),
    quality: worst(qualityFromIssues(merged), enriched.quality),
    issues: merged,
    corrections: enriched.corrections,
    ...(correctedParams ? { correctedParams } : {}),
    ...(proposals ? { proposals } : {}),
    ...(proposedParams ? { proposedParams } : {}),
    assist: { state: 'on' },
    ...(usage ? { usage } : {}),
  };
}
