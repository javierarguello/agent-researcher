/**
 * The deterministic half of the pre-flight review — everything we can tell the
 * user about their request WITHOUT calling a model.
 *
 * This is the part that always runs: it costs nothing, cannot be influenced by
 * anything the user typed, and returns the same output for the same input. The
 * assisted (LLM) pass in `enrich.ts` only ever ADDS to what this produces, and
 * when it is unavailable — outage, cooldown, no credits — the user still gets a
 * complete, useful preview.
 */
import type { ResearchTemplate } from '../templates/types.js';
import { directiveText } from '../templates/directives.js';
import {
  coreIssueMessage,
  CORE_ISSUE_CODES,
  type IssueSeverity,
  type Lang,
} from './copy.js';

export interface PreflightIssue {
  /** Closed-vocabulary code — the only thing a model is ever allowed to choose. */
  code: string;
  /** Localized wording we wrote for that code. */
  message: string;
  severity: IssueSeverity;
  /** Param this issue is about, when it maps to one (lets a UI highlight it). */
  field?: string;
}

/** Resolve a code to its copy: template-specific codes first, then the core set. */
export function issueMessage(
  template: Pick<ResearchTemplate<any>, 'preflight'> | undefined,
  code: string,
  lang: Lang,
): string | undefined {
  const own = template?.preflight?.issueCopy?.[code];
  if (own) return own[lang] ?? own.en;
  return coreIssueMessage(code, lang);
}

/** Every issue code this template may emit — the enum the assisted pass is bound to. */
export function allowedIssueCodes(template: Pick<ResearchTemplate<any>, 'preflight'> | undefined): string[] {
  const own = Object.keys(template?.preflight?.issueCopy ?? {});
  const fromRules = (template?.preflight?.rules ?? []).map((r) => r.code);
  // From the enum itself, not a second hand-written copy: this list is what the
  // assisted pass may answer with, and the copy table is what turns an answer into
  // a sentence. They drifted — `instructions_vague` outlived both its field and its
  // copy here, and the model kept picking it (R7-10).
  return Array.from(new Set([...CORE_ISSUE_CODES, ...own, ...fromRules]));
}

/**
 * Run the template's declared rules plus the generic range check (any
 * `paramsUi.ranges` pair whose min exceeds its max). Rules are plain predicates
 * over validated params — no model, no I/O.
 */
export function deterministicIssues(
  template: ResearchTemplate<any>,
  params: Record<string, unknown>,
  lang: Lang,
): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const push = (code: string, severity: IssueSeverity, field?: string) => {
    if (out.some((i) => i.code === code)) return;
    const message = issueMessage(template, code, lang);
    if (message) out.push({ code, message, severity, ...(field ? { field } : {}) });
  };

  // Generic: a min above its max can never match anything.
  for (const r of template.paramsUi?.ranges ?? []) {
    const min = params[r.minKey];
    const max = params[r.maxKey];
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      push('contradictory_range', 'warn', r.minKey);
    }
  }

  for (const rule of template.preflight?.rules ?? []) {
    let hit = false;
    try {
      hit = rule.when(params);
    } catch {
      hit = false; // a rule must never break the preview
    }
    if (hit) push(rule.code, rule.severity ?? 'info', rule.field);
  }
  return out;
}

/**
 * A short, plain-language description of what the report will look for, built
 * from the validated params. Pure function → identical params always yield the
 * identical sentence, and no model text ever reaches the user.
 */
export function renderPlan(
  template: ResearchTemplate<any>,
  params: Record<string, unknown>,
  ctx: { lang: Lang; modeLabel: string },
): string {
  if (template.preflight?.describePlan) {
    try {
      return template.preflight.describePlan(params, ctx).trim();
    } catch {
      /* fall through to the generic renderer */
    }
  }
  // Generic fallback: subject + scope + the filters that are actually set.
  //
  // Two exclusions, and they are different things. An object-valued param is
  // skipped because `String(v)` prints literally `[object Object]` on the last
  // screen before payment (round 9, R9-17) — that reason is about the TYPE, and
  // the fix was keyed on the directives KEY, so every other object param still
  // printed it and an array of objects printed one per element (round 10, R10-23).
  // The directives key is skipped for a second, semantic reason: `planPreferences`
  // renders those as pairs for every template, whichever branch wrote the summary,
  // so listing them here would say everything twice. That skip now applies only
  // when the template actually declares a spec — `?? 'directives'` swallowed a
  // legitimately named param on a template with no spec, which is the only kind of
  // template the fallback existed for, and nothing else rendered it (R10-26).
  const dirKey = template.directives?.key;
  const isPrimitive = (x: unknown) => x === null || typeof x !== 'object';
  const renderable = (v: unknown) => (Array.isArray(v) ? v.every(isPrimitive) : isPrimitive(v));
  const filters = Object.entries(params)
    .filter(([k, v]) => k !== 'mode' && k !== 'language' && k !== dirKey && v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length) && renderable(v))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  const head = GENERIC_HEAD[ctx.lang] ?? GENERIC_HEAD.en;
  return `${head(template.name, ctx.modeLabel)}${filters.length ? ` — ${filters.join('; ')}.` : '.'}`;
}

/**
 * The word for a boolean directive, in the buyer's language.
 *
 * Capitalized, which is what the only client that renders these pairs already
 * shows: `t.yes` / `t.no` in `apps/fbizlab/src/pages/NewReport.tsx` are
 * `Yes|No` / `Sí|No` / `Oui|Non` / `Sim|Não`, and this table said `yes` / `sí`.
 * Two renderers of the same request disagreeing on a word is the shape these rounds
 * keep finding, and here it also read oddly beside its neighbours: every other
 * value in the pairs list is a manifest label ("Owner retiring"). Dead copy today —
 * no shipped template declares a boolean directive — and there is no automatic
 * parity check for it, because the SPA is a static bundle with no dependency on this
 * package and `t.yes` is general UI copy rather than this constant (round 10, R10-21).
 */
const PREFS_YESNO: Record<Lang, [string, string]> = {
  en: ['Yes', 'No'],
  es: ['Sí', 'No'],
  fr: ['Oui', 'Non'],
  pt: ['Sim', 'Não'],
};

/**
 * The preferences a request carries, as LABEL/VALUE PAIRS rather than a sentence.
 *
 * Answers R8-36 — `describePlan` rendered industry, location, price band, revenue,
 * cash flow, SBA, real estate and keywords, and NO directive at all, while six of
 * the seven decide which listings get shortlisted — and it lives here rather than
 * in a template so that a template cannot forget the last screen before payment.
 *
 * PAIRS, and not appended to the summary, because of how it went wrong the first
 * time (round 9, R9-1). The buyer's app deliberately keeps the directives OUT of
 * the key that decides whether a preview is still valid: keyed on, every chip click
 * would flip the dialog back to "Validate & continue" and spend one of the two
 * assisted attempts — `reserveAssistedReview` is claimed on every preflight call, so
 * that cost is real. Folding the preferences into `summary` made a cached sentence
 * depend on a value that changes without re-previewing, so the confirm dialog named
 * a preference that was not going and stayed silent about one that was. As pairs,
 * a client renders them from the params it is about to SUBMIT, and a client that
 * does not edit after previewing can render the ones it was handed. Neither has to
 * parse a sentence.
 *
 * Still a pure function of the validated params, and still no user-authored text.
 * The VALUE labels are the manifest's, in the buyer's language — the same strings
 * the form showed them; the lead-in a client puts in front of them and the `yes`/`no`
 * for a boolean are ours, hardcoded here. "Every word is a label from the manifest"
 * was written and is not true of those two (round 9, R9-27). The property that
 * matters — no word the MODEL or the BUYER wrote — holds absolutely.
 */
export function planPreferences(
  template: ResearchTemplate<any>,
  params: Record<string, unknown>,
  lang: Lang,
): Array<{ label: string; value: string }> {
  const spec = template.directives;
  const set = spec ? (params[spec.key] as Record<string, unknown> | undefined) : undefined;
  if (!spec || !set || typeof set !== 'object') return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const field of spec.fields) {
    const v = set[field.key];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    const text = directiveText(field, lang);
    // Only a DECLARED value renders, and the array is cut at the field's own bound —
    // the same re-check `renderDirectives` does one module over, for the same
    // reason: "`directivesSchema` already enforces this; re-checking here means a
    // caller that skipped validation still cannot get an arbitrary string into a
    // prompt". `renderPlan` is exported from the package index, and this string goes
    // to a buyer rather than to a prompt, which is not a weaker place to put a
    // stranger's text (round 9, R9-19).
    const allowed = new Set(field.values ?? []);
    // No escape hatch for a boolean. Its true value is handled by the first arm of
    // the ternary below, so the only way this predicate is ever consulted on a
    // boolean field is a value that is NOT a boolean — exactly the unvalidated
    // caller the re-check exists for — and `field.kind === 'boolean' ||` waved that
    // string through to a label lookup a boolean field has no entries in, i.e.
    // printed it verbatim (round 10, R10-22). `renderDirectives` `continue`s on the
    // same input; the two now agree.
    const ok = (x: unknown): x is string => typeof x === 'string' && allowed.has(x);
    const label = (raw: string) => text.valueLabels?.[raw] ?? raw;
    // Deduped, then cut — the same two operations `renderDirectives` performs on the
    // same values, so the screen and the prompt cannot disagree. Both were one-sided
    // before: only the screen cut at `maxSelected` (R10-24) and neither collapsed a
    // repeat, which `directivesSchema` accepted because `.max()` counts elements
    // rather than distinct values (R10-25).
    const shown =
      typeof v === 'boolean' ? (PREFS_YESNO[lang] ?? PREFS_YESNO.en)[v ? 0 : 1]
      : Array.isArray(v) ? [...new Set(v.filter(ok))].slice(0, field.maxSelected ?? allowed.size).map(label).join(', ')
      : ok(v) ? label(v)
      : '';
    if (shown) out.push({ label: text.label, value: shown });
  }
  return out;
}

const GENERIC_HEAD: Record<Lang, (name: string, mode: string) => string> = {
  en: (name, mode) => `We'll run "${name}" (${mode})`,
  es: (name, mode) => `Ejecutaremos "${name}" (${mode})`,
  fr: (name, mode) => `Nous lancerons « ${name} » (${mode})`,
  pt: (name, mode) => `Vamos executar "${name}" (${mode})`,
};
