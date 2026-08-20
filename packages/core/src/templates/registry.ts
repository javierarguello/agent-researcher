import { z } from 'zod';
import { floridaBusinessForSale } from './florida-business-for-sale.js';
import { reportSchemaOf, type ResearchTemplate, type TemplateManifest } from './types.js';
import { assertTemplatesValid } from './validate.js';
import { modesOf, creditsForMode } from '../mode.js';

/** All research templates ("models") the API supports. Add new verticals here. */
const TEMPLATES: Record<string, ResearchTemplate<any>> = {
  [floridaBusinessForSale.id]: floridaBusinessForSale,
};

// Fail fast at load time if any template is malformed (bad agent/section/model ref).
assertTemplatesValid(Object.values(TEMPLATES));

export function getTemplate(id: string): ResearchTemplate<any> | undefined {
  return TEMPLATES[id];
}

export function listTemplates(): ResearchTemplate<any>[] {
  return Object.values(TEMPLATES);
}

/**
 * Test seam: register a template for the duration of a test (mirrors
 * `__setProviderForTests`).
 *
 * An end-to-end test that goes through the API and the worker can only use a
 * REGISTERED model — everything downstream resolves the template by id. Without
 * this, such a test has to drive a production model, and against a real local
 * model that is tens of minutes per run. A two-agent stand-in exercises the same
 * pipeline in a couple of them.
 *
 * Validated on the way in, so a fixture cannot get away with a shape a real
 * template would be rejected for.
 */
export function __registerTemplateForTests(t: ResearchTemplate<any>): void {
  assertTemplatesValid([t]);
  TEMPLATES[t.id] = t;
  registeredForTests.add(t.id);
}

export function __clearTestTemplates(): void {
  for (const id of registeredForTests) delete TEMPLATES[id];
  registeredForTests.clear();
}

const registeredForTests = new Set<string>();

import { LANGUAGE_LABELS } from '../languages.js';
import { manifestDirectives } from './directives.js';
import { planWaves } from '../engine/research-engine.js';
import { LIFECYCLE_BEFORE, LIFECYCLE_AFTER, LIFECYCLE_OTHER, phaseLabel } from './phases.js';
import type { ParamsUi, StepInfo, TemplateI18n } from './types.js';

/** Languages a manifest can be requested in (the `lang` query param). */
export const SUPPORTED_LANGS = Object.keys(LANGUAGE_LABELS);
export const DEFAULT_LANG = 'en';

/** "deal-scout" → "Deal scout" (fallback when an agent has no explicit label). */
function titleize(id: string): string {
  const s = id.replace(/[-_]/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The workflow steps a client can show: lifecycle phases + agents, in run order, localized. */
function buildSteps(t: ResearchTemplate<any>, tr: TemplateI18n | undefined, lang: string): StepInfo[] {
  const agentIds = planWaves(t).flat();
  const agentSteps: StepInfo[] = agentIds.map((id) => {
    const a = t.agents.find((x) => x.id === id)!;
    const ov = tr?.agentLabels?.[id];
    return { id, label: ov?.label ?? a.label ?? titleize(id), description: ov?.description ?? a.objective };
  });
  const phase = (id: string): StepInfo => ({ id, ...phaseLabel(id, lang) });
  return [
    ...LIFECYCLE_BEFORE.map(phase),
    ...agentSteps,
    ...LIFECYCLE_AFTER.map(phase),
    ...LIFECYCLE_OTHER.map(phase),
  ];
}

/**
 * Strip a template's `internalParams` out of everything a client reads.
 *
 * Both halves, or the field is broken rather than hidden: a schema without the
 * key and a `paramsUi` that still names it makes a client render a control for a
 * property that does not exist, and a `paramsUi` without it while the schema
 * keeps it makes the client render a default input for a field whose every
 * submission is a 400.
 */
function hideInternal<T>(schema: T, ui: ParamsUi | undefined, internal: string[] | undefined): { schema: T; ui: ParamsUi | undefined } {
  if (!internal?.length) return { schema, ui };
  const hide = new Set(internal);
  const js = schema as unknown as { properties?: Record<string, unknown>; required?: string[] };
  const outSchema = js && typeof js === 'object' && js.properties
    ? {
        ...js,
        properties: Object.fromEntries(Object.entries(js.properties).filter(([k]) => !hide.has(k))),
        ...(js.required ? { required: js.required.filter((k) => !hide.has(k)) } : {}),
      }
    : schema;
  const outUi = ui
    ? {
        ...ui,
        ...(ui.fields ? { fields: Object.fromEntries(Object.entries(ui.fields).filter(([k]) => !hide.has(k))) } : {}),
        ...(ui.rows ? { rows: ui.rows.map((r) => r.filter((k) => !hide.has(k))).filter((r) => r.length) } : {}),
        ...(ui.hidden ? { hidden: ui.hidden.filter((k) => !hide.has(k)) } : {}),
        ...(ui.advanced ? { advanced: ui.advanced.filter((k) => !hide.has(k)) } : {}),
        ...(ui.ranges ? { ranges: ui.ranges.filter((r) => !hide.has(r.minKey) && !hide.has(r.maxKey)) } : {}),
      }
    : ui;
  return { schema: outSchema as T, ui: outUi };
}

/** Apply per-language help/placeholder overrides to the paramsUi. */
function localizeParamsUi(ui: ParamsUi | undefined, tr: TemplateI18n | undefined): ParamsUi | undefined {
  if (!ui || !(tr?.fields || tr?.ranges)) return ui;
  const fields = { ...(ui.fields ?? {}) };
  for (const [key, ov] of Object.entries(tr.fields ?? {})) {
    fields[key] = {
      ...fields[key],
      // `label` and `suggestions` too: both are rendered to the buyer, and both
      // were English in every language because only these two were copied.
      ...(ov.label ? { label: ov.label } : {}),
      ...(ov.help ? { help: ov.help } : {}),
      ...(ov.placeholder ? { placeholder: ov.placeholder } : {}),
      ...(ov.suggestions ? { suggestions: ov.suggestions } : {}),
      ...(ov.optionLabels ? { optionLabels: { ...fields[key]?.optionLabels, ...ov.optionLabels } } : {}),
    };
  }
  const ranges = tr.ranges
    ? (ui.ranges ?? []).map((r) => (tr.ranges![r.minKey] ? { ...r, label: tr.ranges![r.minKey]! } : r))
    : ui.ranges;
  return { ...ui, fields, ...(ranges ? { ranges } : {}) };
}

/**
 * The localized label of one report tier ("Essential" / "Esencial" / …). Same
 * source of truth the manifest uses, so a preview and the form always agree.
 */
export function modeLabel(t: ResearchTemplate<any>, key: string, lang: string = DEFAULT_LANG): string {
  const tr = lang !== DEFAULT_LANG ? t.i18n?.[lang] : undefined;
  const cfg = modesOf(t.modes).find(([k]) => k === key)?.[1];
  return tr?.modeLabels?.[key as keyof NonNullable<TemplateI18n['modeLabels']>] ?? cfg?.label ?? key;
}

/**
 * Public, client-safe manifest (never exposes the internal base prompt),
 * localized to `lang` (default 'en'). Any string without a translation falls
 * back to the template's English base.
 */
export function toManifest(t: ResearchTemplate<any>, lang: string = DEFAULT_LANG): TemplateManifest {
  const tr = lang !== DEFAULT_LANG ? t.i18n?.[lang] : undefined;
  // What the texts below are ACTUALLY in.
  //
  // This used to echo the request unconditionally, so a model with no block for
  // the asked-for language answered `lang: 'pt'` with English throughout — and a
  // client had no way to detect it and fall back deliberately. The API's `?lang`
  // enum stops that for the languages we publish; a model that ships English-only
  // is the case it could not see.
  //
  // `actualLang` is then what the REST of this manifest is built in, not just what
  // it reports. Steps and directives are translated globally (`phases.ts`,
  // `directives.ts`), so building them from the request while the model's own
  // texts fell back to English produced a manifest in two languages — and a `lang`
  // field that was wrong about part of it whichever value it took.
  const actualLang = lang === DEFAULT_LANG || tr ? lang : DEFAULT_LANG;
  const hidden = hideInternal(z.toJSONSchema(t.paramsSchema), t.paramsUi ? localizeParamsUi(t.paramsUi, tr) : undefined, t.internalParams);
  return {
    id: t.id,
    name: tr?.name ?? t.name,
    description: tr?.description ?? t.description,
    version: t.version,
    lang: actualLang,
    sections: t.sections.map((s) => ({ key: s.key, title: tr?.sectionTitles?.[s.key] ?? s.title })),
    // `internalParams` never leave the server: a client cannot render, submit or
    // discover them. See `ResearchTemplate.internalParams`.
    paramsSchema: hidden.schema,
    ...(hidden.ui ? { paramsUi: hidden.ui } : {}),
    // Localized in the template, not in the client: a new directive field (or a
    // new language for an existing one) reaches every front-end with no client
    // change. Note what is NOT here — the prompt text these render into. That is
    // built server-side from the submitted values; the client never sees or edits it.
    ...(t.directives
      ? { directives: manifestDirectives(t.directives, actualLang), directivesKey: t.directives.key }
      : {}),
    // Which param carries the buyer's free text. A client needs it to render that
    // one field differently (a textarea with a minimum, not a line input) and to
    // keep it out of anything that prints the request back — the PDF's mandate
    // table excluded the literal name `instructions`, which is Florida's.
    currency: t.currency ?? 'USD',
    ...(t.cover ? { cover: t.cover } : {}),
    // The cover's labels, resolved to the language this manifest is ACTUALLY in.
    //
    // `CoverSpec.labelKey` is documented as "looked up in `TemplateI18n.cover`",
    // and nothing looked it up: `cover` went out raw and both renderers fell back
    // to their own four-language dictionaries. Those dictionaries are Florida's
    // vocabulary — `targets`, `priceRange`, `combinedSde` — so the flagship looked
    // right and the SECOND model to declare a cover got its raw key printed as the
    // label, in every language. Keyed off `actualLang`, so a model with no block
    // for the requested language gets its English labels rather than a mixture.
    ...(t.i18n?.[actualLang]?.cover ? { coverLabels: t.i18n[actualLang]!.cover } : {}),
    // The modes THIS TEMPLATE declares, in its own order — not a walk over a global
    // constant, which silently dropped any mode not called essential/comprehensive
    // and made "a new model just declares its modes" false.
    modes: modesOf(t.modes).map(([key, cfg]) => ({
      key,
      label: tr?.modeLabels?.[key] ?? cfg.label ?? key,
      credits: creditsForMode(cfg, key),
    })),
    addons: (t.addons ?? []).map((a) => {
      const ov = tr?.addonLabels?.[a.key];
      return {
        key: a.key,
        label: ov?.label ?? a.label,
        ...(ov?.description ?? a.description ? { description: ov?.description ?? a.description } : {}),
        credits: a.credits,
      };
    }),
    steps: buildSteps(t, tr, actualLang),
    reportSchema: z.toJSONSchema(reportSchemaOf(t)),
  };
}

export { TEMPLATES };
