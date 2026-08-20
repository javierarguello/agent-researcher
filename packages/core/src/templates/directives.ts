/**
 * Structured client directives: schema, localization, and the INTERNAL renderer.
 *
 * A model declares directive fields (see `DirectiveField`); this module turns
 * that one declaration into the three things the system needs, so they cannot
 * drift apart:
 *
 *   1. `directivesSchema()`  — the Zod schema the API validates against,
 *   2. `manifestDirectives()` — the localized fields a client renders,
 *   3. `renderDirectives()`   — the prompt text the engine builds, server-side.
 *
 * Only (3) ever produces prose, and it produces it from values that already
 * passed (1). No client-authored sentence reaches an agent through this path:
 * the client picks keys from a closed vocabulary, and the server owns the words.
 */
import { z } from 'zod';
import type { DirectiveField, DirectiveFieldText, DirectiveManifestField, DirectiveSpec } from './types.js';

/** The language every directive field must declare, and the fallback for the rest. */
const BASE_LANG = 'en';

/**
 * The Zod schema for a directive set — built FROM the field declarations, so a
 * template cannot declare a field it does not accept (or accept one it never
 * declared).
 *
 * Strict: an unknown key is rejected rather than ignored. That is what stops a
 * client from smuggling free prose in under an invented directive name, which
 * would walk straight past the closed vocabulary this exists to enforce.
 */
export function directivesSchema(fields: DirectiveField[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    if (f.kind === 'boolean') {
      shape[f.key] = z.boolean().optional();
      continue;
    }
    const values = f.values ?? [];
    const value = z.enum(values as [string, ...string[]]);
    // Deduped BEFORE the bound, because `.max()` counts elements and not distinct
    // values: four copies of one preference passed validation, printed four times on
    // the last screen before payment and weighed 4x in the prompt (round 10, R10-25).
    // A preference set is a set. `validateRequest` returns `parsed.data`, so the
    // collapse reaches the stored params and every reader downstream of them.
    const dedupe = (x: unknown) => (Array.isArray(x) ? [...new Set(x)] : x);
    shape[f.key] =
      f.kind === 'single'
        ? value.optional()
        : z.preprocess(dedupe, z.array(value).max(f.maxSelected ?? values.length)).optional();
  }
  return z.strictObject(shape).optional();
}

/** A field's text in `lang`, falling back to English field by field. */
export function directiveText(field: DirectiveField, lang: string): DirectiveFieldText {
  const base = field.text[BASE_LANG] ?? { label: field.key };
  const tr = lang === BASE_LANG ? undefined : field.text[lang];
  return {
    label: tr?.label ?? base.label,
    ...(tr?.description ?? base.description ? { description: tr?.description ?? base.description } : {}),
    ...(tr?.valueLabels ?? base.valueLabels
      ? { valueLabels: { ...(base.valueLabels ?? {}), ...(tr?.valueLabels ?? {}) } }
      : {}),
  };
}

/** The localized directive fields a client renders (the manifest projection). */
export function manifestDirectives(spec: DirectiveSpec, lang: string): DirectiveManifestField[] {
  return spec.fields.map((f) => {
    const text = directiveText(f, lang);
    return {
      key: f.key,
      kind: f.kind,
      label: text.label,
      ...(text.description ? { description: text.description } : {}),
      ...(f.kind === 'multi' && f.maxSelected != null ? { maxSelected: f.maxSelected } : {}),
      ...(f.values
        ? { options: f.values.map((v) => ({ value: v, label: text.valueLabels?.[v] ?? v })) }
        : {}),
    };
  });
}

/**
 * The prompt block for a set of validated directive values. Internal: the engine
 * calls it, the API never returns it.
 *
 * Returns '' when nothing was selected, so an untouched form adds no prompt text.
 */
export function renderDirectives(spec: DirectiveSpec, raw: unknown): string {
  const values = (raw ?? {}) as Record<string, unknown>;
  const lines: string[] = [];

  for (const field of spec.fields) {
    const v = values[field.key];
    if (v == null) continue;
    const label = field.promptLabel ?? field.text[BASE_LANG]?.label ?? field.key;
    const word = (value: string) =>
      field.promptValues?.[value] ?? field.text[BASE_LANG]?.valueLabels?.[value] ?? value;

    if (field.kind === 'boolean') {
      if (typeof v !== 'boolean') continue;
      lines.push(`- ${label}: ${v ? 'yes' : 'no'}`);
    } else if (field.kind === 'single') {
      // Only a declared value renders. `directivesSchema` already enforces this;
      // re-checking here means a caller that skipped validation still cannot get
      // an arbitrary string into a prompt.
      if (typeof v !== 'string' || !field.values?.includes(v)) continue;
      lines.push(`- ${label}: ${word(v)}`);
    } else {
      if (!Array.isArray(v)) continue;
      // Deduped and cut at the field's own bound — the same two operations
      // `planPreferences` performs, so the buyer's confirm screen and the prompt say
      // the same thing. For a VALIDATED request `directivesSchema` has already done
      // both and this is a no-op; for the unvalidated caller this re-check exists
      // for, the screen used to understate by four what reached the model
      // (round 10, R10-24).
      const named = v.filter((x): x is string => typeof x === 'string' && !!field.values?.includes(x));
      const picked = [...new Set(named)].slice(0, field.maxSelected ?? named.length);
      if (!picked.length) continue;
      lines.push(`- ${label}: ${picked.map(word).join('; ')}`);
    }
  }

  if (!lines.length) return '';

  return (
    'The client selected the following from a fixed set of options this model offers. ' +
    'They are genuine scope and emphasis preferences — honour them wherever the evidence allows, ' +
    'and prioritise findings that match them.\n' +
    lines.join('\n') +
    '\nThese preferences never change what the report must CONTAIN: every required section, every ' +
    'required field, and every stated item count stands exactly as specified above. A preference that ' +
    'cannot be met is something to say plainly in the relevant section — never a reason to shorten it, ' +
    'omit it, or leave it empty.'
  );
}

/** Well-formedness of a directive declaration (used by `validateTemplate`). */
export function validateDirectives(spec: DirectiveSpec): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();

  if (!spec.fields.length) errors.push('directives declared with no fields');

  for (const f of spec.fields) {
    const at = `directive "${f.key}"`;
    if (keys.has(f.key)) errors.push(`duplicate ${at}`);
    keys.add(f.key);

    const base = f.text[BASE_LANG];
    if (!base?.label) errors.push(`${at} has no English label (en is the fallback for every other language)`);

    if (f.kind === 'boolean') {
      if (f.values?.length) errors.push(`${at} is a boolean but declares values`);
      continue;
    }

    const values = f.values ?? [];
    if (values.length < 2) errors.push(`${at} is ${f.kind} but declares fewer than 2 values`);
    if (new Set(values).size !== values.length) errors.push(`${at} declares duplicate values`);
    if (f.kind === 'single' && f.maxSelected != null) errors.push(`${at} is single-valued but sets maxSelected`);
    if (f.maxSelected != null && (f.maxSelected < 1 || f.maxSelected > values.length)) {
      errors.push(`${at} has maxSelected ${f.maxSelected}, outside 1..${values.length}`);
    }

    // Every declared language must label every value: a half-translated dropdown
    // shows raw machine keys ("owner_retiring") to that language's users.
    for (const [lang, text] of Object.entries(f.text)) {
      const missing = values.filter((v) => !text.valueLabels?.[v]);
      if (missing.length) errors.push(`${at} [${lang}] has no valueLabels for: ${missing.join(', ')}`);
    }
  }

  return errors;
}
