/**
 * The supported-language list, and the type every other copy of it derives from.
 *
 * Human labels for the language codes a template may accept. Templates reuse
 * this for `paramsUi.fields.<lang>.optionLabels` so a client can render a
 * language picker without hard-coding names. The default language stays in the
 * template's Zod schema (e.g. `.default('en')`).
 *
 * `as const` and the `Lang` alias below are load-bearing, not tidiness. This file
 * used to be `Record<string, string>`, which types nothing: the moderation copy,
 * the engine's prompt names, the PDF's string table and the SPA viewer's each
 * declared their own `'en' | 'es' | 'fr' | 'pt'`, textually identical and
 * structurally unrelated, and only a runtime pin held them together. Every one of
 * those now annotates its table `Record<Lang, …>`, which a fresh object literal
 * fails to satisfy in BOTH directions — a missing key on an addition, an excess
 * key on a removal. Adding or dropping a language here breaks the build until
 * someone has written (or deleted) the strings for it.
 *
 * What the compiler still cannot reach, and what `language-lists.test.ts`
 * therefore pins at runtime: the per-template Zod `language` enums, the buyer
 * app's build script (plain `.mjs`), and the SPA's own list in another package.
 */
export const LANGUAGE_LABELS = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
} as const satisfies Record<string, string>;

/** A language code this deployment supports. Derived — never written out again. */
export type Lang = keyof typeof LANGUAGE_LABELS;

/** The same list as an array, for the callers that iterate rather than look up. */
export const LANGS = Object.keys(LANGUAGE_LABELS) as Lang[];
