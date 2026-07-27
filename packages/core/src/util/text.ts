/**
 * Text normalization + similarity helpers.
 *
 * Used by two security-sensitive places:
 *  - the moderation pre-screen, whose regexes would otherwise be trivially
 *    bypassed with zero-width characters, homoglyphs or interleaved punctuation
 *    ("i‌gnore", "іgnore", "i.g.n.o.r.e");
 *  - the pre-flight correction guard, which only accepts an LLM-proposed value
 *    when it stays close to what the user actually typed.
 *
 * Nothing here mutates a stored param: normalization exists to DECIDE, the
 * original text is what gets persisted.
 */

/**
 * Zero-width, bidi-override and other invisible formatting characters. Written as
 * escapes on purpose: the literal characters are invisible in an editor and easy
 * to mangle in a copy-paste.
 *   200B-200F zero-width space/joiners + LTR/RTL marks
 *   202A-202E bidi embedding/override      2060-2064 invisible operators
 *   FEFF      BOM / zero-width no-break     FE00-FE0F variation selectors
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\uFE00-\uFE0F]/g;
/** C0/C1 control characters, except tab (09) and newline (0A / 0D). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Cyrillic/Greek/fullwidth look-alikes folded to their Latin twin. Only the
 * characters that actually appear in homoglyph bypasses — a full confusables
 * table would be large and would fold legitimate non-Latin subjects.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', е: 'e', ѕ: 's', һ: 'h', і: 'i', ј: 'j', к: 'k', м: 'm',
  н: 'h', о: 'o', р: 'p', т: 't', у: 'y', х: 'x', ԁ: 'd', ɡ: 'g', ⅼ: 'l',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't', υ: 'u', ν: 'v', χ: 'x',
  'ı': 'i', '–': '-', '—': '-', '‘': "'", '’': "'",
  '“': '"', '”': '"',
};

/** True when the text carries control characters used to smuggle instructions. */
export function hasControlChars(text: string): boolean {
  CONTROL.lastIndex = 0;
  return CONTROL.test(text);
}

/** Drop invisible + control characters (keeps tabs/newlines). */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '').replace(CONTROL, '');
}

/** Fold homoglyphs to their Latin equivalent. */
export function foldConfusables(text: string): string {
  let out = '';
  for (const ch of text) out += CONFUSABLES[ch] ?? CONFUSABLES[ch.toLowerCase()] ?? ch;
  return out;
}

/**
 * The two forms every screening pattern is tested against:
 *  - `normalized`: NFKC, invisibles stripped, homoglyphs folded, lower-cased,
 *    whitespace collapsed — catches unicode tricks while keeping word boundaries;
 *  - `squeezed`: the same with EVERY non-alphanumeric removed — catches
 *    separator padding ("i.g.n.o.r.e  a l l"), which the normalized form misses.
 */
export function screeningForms(text: string): { normalized: string; squeezed: string } {
  const normalized = foldConfusables(stripInvisible(text.normalize('NFKC')))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return { normalized, squeezed: normalized.replace(/[^\p{L}\p{N}]+/gu, '') };
}

/**
 * The squeezed twin of a screening pattern: the same regex with its whitespace
 * matchers removed, so it can be tested against `screeningForms().squeezed`.
 * Lets a single pattern list cover both forms.
 */
export function squeezedPattern(re: RegExp): RegExp {
  const source = re.source
    .replace(/\\s[+*]/g, '')
    .replace(/\\s/g, '')
    .replace(/\\b/g, '')
    .replace(/ /g, ''); // literal spaces in the pattern are gone from the input too
  return new RegExp(source, re.flags.replace('g', ''));
}

/** Levenshtein distance (iterative, two-row). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

const ratio = (a: string, b: string): number => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

/**
 * Similarity in [0,1] between two short strings, on their normalized forms.
 * 1 = identical; used as the "is this a correction or a replacement?" test.
 *
 * A real correction is often BOTH a fix and an expansion ("maimi dade" →
 * "Miami-Dade County, FL"), which a whole-string ratio scores badly. So the
 * leading segments are compared too, and the better score wins. That alone would
 * accept an original with a payload appended, which is why callers pair this with
 * a bound on how much longer the proposal may be.
 */
export function similarity(a: string, b: string): number {
  const x = screeningForms(a).normalized;
  const y = screeningForms(b).normalized;
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.9;
  const n = Math.min(x.length, y.length);
  return Math.max(ratio(x, y), ratio(x.slice(0, n), y.slice(0, n)));
}

/**
 * Squash an LLM-proposed value into a plain, single-line, link-free string
 * bounded by `maxLength`. Everything a correction is allowed to be.
 */
export function sanitizeProposal(value: string, maxLength: number): string {
  return stripInvisible(value.normalize('NFKC'))
    .replace(/https?:\/\/\S+|www\.\S+/gi, '') // no links
    .replace(/[<>{}[\]|`*_#\\]/g, '') // no markup / fencing characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}
