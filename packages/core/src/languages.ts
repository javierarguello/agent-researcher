/**
 * Human labels for the language codes a template may accept. Templates reuse
 * this for `paramsUi.fields.<lang>.optionLabels` so a client can render a
 * language picker without hard-coding names. The default language stays in the
 * template's Zod schema (e.g. `.default('en')`).
 */
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
};
