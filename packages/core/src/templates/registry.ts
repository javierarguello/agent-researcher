import { z } from 'zod';
import { floridaBusinessForSale } from './florida-business-for-sale.js';
import { reportSchemaOf, type ResearchTemplate, type TemplateManifest } from './types.js';
import { assertTemplatesValid } from './validate.js';
import { REPORT_MODES, DEFAULT_MODES, creditsForMode } from '../mode.js';

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

import { LANGUAGE_LABELS } from '../languages.js';
import type { ParamsUi, TemplateI18n } from './types.js';

/** Languages a manifest can be requested in (the `lang` query param). */
export const SUPPORTED_LANGS = Object.keys(LANGUAGE_LABELS);
export const DEFAULT_LANG = 'en';

/** Apply per-language help/placeholder overrides to the paramsUi. */
function localizeParamsUi(ui: ParamsUi | undefined, tr: TemplateI18n | undefined): ParamsUi | undefined {
  if (!ui || !tr?.fields) return ui;
  const fields = { ...(ui.fields ?? {}) };
  for (const [key, ov] of Object.entries(tr.fields)) {
    fields[key] = {
      ...fields[key],
      ...(ov.help ? { help: ov.help } : {}),
      ...(ov.placeholder ? { placeholder: ov.placeholder } : {}),
    };
  }
  return { ...ui, fields };
}

/**
 * Public, client-safe manifest (never exposes the internal base prompt),
 * localized to `lang` (default 'en'). Any string without a translation falls
 * back to the template's English base.
 */
export function toManifest(t: ResearchTemplate<any>, lang: string = DEFAULT_LANG): TemplateManifest {
  const tr = lang !== DEFAULT_LANG ? t.i18n?.[lang] : undefined;
  return {
    id: t.id,
    name: tr?.name ?? t.name,
    description: tr?.description ?? t.description,
    version: t.version,
    lang,
    sections: t.sections.map((s) => ({ key: s.key, title: tr?.sectionTitles?.[s.key] ?? s.title })),
    paramsSchema: z.toJSONSchema(t.paramsSchema),
    ...(t.paramsUi ? { paramsUi: localizeParamsUi(t.paramsUi, tr) } : {}),
    modes: REPORT_MODES.map((key) => {
      const cfg = t.modes?.[key] ?? DEFAULT_MODES[key];
      return { key, label: tr?.modeLabels?.[key] ?? cfg.label ?? key, credits: creditsForMode(cfg, key) };
    }),
    reportSchema: z.toJSONSchema(reportSchemaOf(t)),
  };
}

export { TEMPLATES };
