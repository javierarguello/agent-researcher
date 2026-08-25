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
import { deterministicIssues, issueMessage, planPreferences, renderPlan, type PreflightIssue } from './deterministic.js';
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
  /**
   * `summary`, re-rendered from `proposedParams` — the sentence the buyer would be
   * confirming if they accepted every proposal. NOT what to show by default: that
   * is `summary`, the request as they typed it, and R7-9/R7-25 are about why.
   *
   * It exists because the client cannot compute it. The buyer's app patches the
   * sentence locally when a proposal is ticked, rather than buying a second
   * assisted review per checkbox, and it did that by replacing the field's DEFAULT
   * with the accepted value. That only works when the summary contains the default
   * verbatim, and no shipped model's does: `florida-business-for-sale` defaults
   * location to 'State of Florida, USA' and `describePlan` renders it as the
   * localized phrase 'the State of Florida'. So the substitution never fired, and a
   * buyer who ticked 'Hialeah, FL' read 'in the State of Florida' on the last
   * screen before their credits were spent (round 11, `confirm-sentence-1`).
   *
   * Rendering it here is free — `renderPlan` is a pure function of the params, no
   * model and no allowance — so the exact sentence costs one string and removes the
   * guess entirely.
   */
  proposedSummary?: string;
  /**
   * The preferences this request carries, as label/value pairs in the buyer's
   * language — the manifest's own labels, never a word the model wrote.
   *
   * Pairs and not a sentence inside `summary`, because a client that lets the buyer
   * edit a preference WITHOUT re-previewing (the buyer's app does exactly that, on
   * purpose — re-previewing spends an assisted attempt) would otherwise show a
   * cached sentence about values that have since changed (round 9, R9-1). Render
   * these from the params you are about to submit; they are what makes the last
   * screen before payment state what will actually be searched (round 8, R8-36).
   */
  preferences: Array<{ label: string; value: string }>;
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
    preferences: planPreferences(template, params, lang),
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
  const p = proposed?.proposals;
  const proposals = p && (Object.keys(p.directives).length || p.keywords.length || Object.keys(p.basics ?? {}).length) ? p : undefined;
  const proposedParams = proposals ? applyProposals(correctedParams ?? params, proposals, template.directives?.key ?? 'directives') : undefined;
  const usage = [enriched.usage, proposed?.usage].filter(Boolean).reduce<PreflightOutcome['usage']>(
    (acc, u) => (acc ? { inputTokens: acc.inputTokens + u!.inputTokens, outputTokens: acc.outputTokens + u!.outputTokens, usd: acc.usd + u!.usd } : u),
    undefined,
  );

  return {
    // The summary is the request as the buyer TYPED it (with their typos fixed, an
    // opt-out), never with the proposals folded in. Proposals are opt-in per field
    // now, so a summary rendered from `proposedParams` described a request the buyer
    // may well decline — it read as "this is what we will research" while listing
    // preferences they had not accepted yet (round 7, R7-9 / R7-25). What the
    // proposals would add is shown beside them, as a diff, where it can be ticked.
    summary: renderPlan(template, correctedParams ?? params, { lang, modeLabel }),
    // From the same params as the summary — the request as the buyer TYPED it, not
    // with the proposals folded in.
    preferences: planPreferences(template, correctedParams ?? params, lang),
    quality: worst(qualityFromIssues(merged), enriched.quality),
    issues: merged,
    corrections: enriched.corrections,
    ...(correctedParams ? { correctedParams } : {}),
    ...(proposals ? { proposals } : {}),
    ...(proposedParams ? { proposedParams } : {}),
    // Free: a pure re-render of the same sentence from the params the proposals
    // would produce. The client shows it instead of patching strings it cannot
    // match — see `proposedSummary` on the interface.
    //
    // NOT from `proposedParams`, and that distinction is the whole value of this
    // line. A basic is opt-in per field, so `applyProposals` leaves basics out
    // unless asked and `proposedParams` still carries the schema default — a
    // sentence rendered from it is byte-identical to `summary`, which would have
    // made this fix the same dead code it replaces, one layer down. `proposedParams`
    // itself must not change: a client that predates the basics row submits it
    // wholesale, and folding an unticked location into it would research a city the
    // buyer never accepted.
    ...(proposals
      ? { proposedSummary: renderPlan(template, applyProposals(correctedParams ?? params, proposals, template.directives?.key ?? 'directives', { basics: true }), { lang, modeLabel }) }
      : {}),
    assist: { state: 'on' },
    ...(usage ? { usage } : {}),
  };
}
