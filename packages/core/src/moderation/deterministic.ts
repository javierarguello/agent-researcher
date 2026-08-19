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
      return `${template.preflight.describePlan(params, ctx).trim()}${planDirectives(template, params, ctx.lang)}`;
    } catch {
      /* fall through to the generic renderer */
    }
  }
  // Generic fallback: subject + scope + the filters that are actually set.
  const filters = Object.entries(params)
    .filter(([k, v]) => k !== 'mode' && k !== 'language' && v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  const head = GENERIC_HEAD[ctx.lang] ?? GENERIC_HEAD.en;
  return `${head(template.name, ctx.modeLabel)}${filters.length ? ` — ${filters.join('; ')}.` : '.'}`;
}

/** "Preferences" — the lead-in for the directive clause. */
const PREFS_LEAD: Record<Lang, string> = {
  en: 'Preferences you set:',
  es: 'Preferencias que indicaste:',
  fr: 'Préférences que vous avez indiquées :',
  pt: 'Preferências que você indicou:',
};
const PREFS_YESNO: Record<Lang, [string, string]> = {
  en: ['yes', 'no'],
  es: ['sí', 'no'],
  fr: ['oui', 'non'],
  pt: ['sim', 'não'],
};

/**
 * The directives, appended to whatever the model's own `describePlan` wrote.
 *
 * Here and not in the template, because this is the last screen before payment and
 * a template must not be able to forget it: `describePlan` rendered industry,
 * location, price band, revenue, cash flow, SBA, real estate and keywords, and NO
 * directive at all — while six of the seven decide which listings get shortlisted
 * (round 8, R8-36). The page's proposals block lists them, but only while there
 * are proposals: not after a second review that proposes nothing, and never for a
 * value the buyer picked by hand.
 *
 * Still a pure function of the validated params, and still no user-authored text:
 * every word here is a label from the manifest, in the buyer's language — the same
 * strings the form showed them.
 */
function planDirectives(template: ResearchTemplate<any>, params: Record<string, unknown>, lang: Lang): string {
  const spec = template.directives;
  const set = spec ? (params[spec.key] as Record<string, unknown> | undefined) : undefined;
  if (!spec || !set || typeof set !== 'object') return '';
  const parts: string[] = [];
  for (const field of spec.fields) {
    const v = set[field.key];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    const text = directiveText(field, lang);
    const label = (raw: string) => text.valueLabels?.[raw] ?? raw;
    const shown =
      typeof v === 'boolean' ? (PREFS_YESNO[lang] ?? PREFS_YESNO.en)[v ? 0 : 1]
      : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(label).join(', ')
      : typeof v === 'string' ? label(v)
      : '';
    if (shown) parts.push(`${text.label}: ${shown}`);
  }
  return parts.length ? ` ${PREFS_LEAD[lang] ?? PREFS_LEAD.en} ${parts.join('; ')}.` : '';
}

const GENERIC_HEAD: Record<Lang, (name: string, mode: string) => string> = {
  en: (name, mode) => `We'll run "${name}" (${mode})`,
  es: (name, mode) => `Ejecutaremos "${name}" (${mode})`,
  fr: (name, mode) => `Nous lancerons « ${name} » (${mode})`,
  pt: (name, mode) => `Vamos executar "${name}" (${mode})`,
};
