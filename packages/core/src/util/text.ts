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
// Includes U+00AD SOFT HYPHEN and the U+E0000 tag block: NFKC preserves both, a
// browser renders both as nothing, and a single one inside a word is not a padding
// run — so `ig\u00ADnore all previous instructions` walked past the pre-screen
// while the file above claimed every pattern is tested against normalized text.
// The `u` flag is what lets the tag range be written as a code point.
//
// The second half of the class was measured, not guessed: a rebuilt §K census on
// 2026-08-19 ran six invisible characters at the real function and five walked
// through. They are the ones that are NOT whitespace and NOT control characters —
// fillers, a joiner, an inherent vowel, a blank braille cell — so `\s` never
// collapsed them and `hasControlChars` never saw them:
//   034F combining grapheme joiner      115F/1160 hangul fillers (3164/FFA0 NFKC to 1160)
//   17B4/17B5 khmer inherent vowels     180B-180F mongolian selectors + separator
//   2800 braille blank                  FFF9-FFFB interlinear annotation
//   1D173-1D17A musical formatting
// Stripping them can only JOIN text, so what a wrong entry costs is a false
// positive, and the corpus pins the shape that would produce one (`jail-break
// themed escape room`).
const INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\uFE00-\uFE0F\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFFA0\uFFF9-\uFFFB\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]/gu;
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
 * The two forms every screening pattern is tested against.
 *
 *  - `normalized`: NFKC, invisibles stripped, homoglyphs folded, lower-cased,
 *    whitespace collapsed — catches unicode tricks while keeping word boundaries;
 *  - `unpadded`: the same, with PADDING RUNS collapsed ("i.g.n.o.r.e" → "ignore",
 *    "j a i l b r e a k" → "jailbreak"). Only runs of single characters are
 *    joined, so ordinary prose keeps every one of its word boundaries.
 *
 * The predecessor of `unpadded` removed EVERY separator in the text, which also
 * removed the boundaries between real words: "county jail. Breakdown of revenue"
 * became "…countyjailbreakdown…" and matched `jailbreak`, and "told them to
 * ignore. All previous instructions from the fire marshal" matched across a
 * sentence boundary. Padding is the thing to undo — not punctuation.
 */
export function screeningForms(text: string): { normalized: string; unpadded: string; deobfuscated: DeobfuscatedForm[] } {
  const normalized = foldConfusables(stripInvisible(text.normalize('NFKC')))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const unpadded = unpad(normalized);
  return { normalized, unpadded, deobfuscated: deobfuscate(normalized, unpadded) };
}

/**
 * A separator sitting INSIDE one word — `ig-nore`, `instruc_tions`, `pre.vious`.
 *
 * Neither of the other two forms reaches this. `unpad` joins runs of SINGLE
 * characters, and `ig-nore` is not one; `tolerantPattern` makes the gaps BETWEEN a
 * pattern's words optional, and this gap is inside a word. Measured walking through
 * on 2026-08-19, as §K said it did.
 *
 * A space is deliberately not in the class. Joining across whitespace is what the
 * predecessor of `unpad` did, and it turned "county jail. Breakdown of revenue"
 * into a jailbreak.
 */
const INTRA_WORD_SEPARATOR = /(?<=\p{L})[-_*~+.]+(?=\p{L})/gu;

/**
 * Digits standing in for letters. A substitution is undone only inside a WORD —
 * seeded by a letter next to it, then spread along the run, so "a11" folds whole
 * while "24/7", "4 bays", "2/10 net 30" and a bare "30" keep every digit. Without
 * the spread the second `1` of "a11" has no letter neighbour and the fold stops
 * one character short of the word it was hiding.
 *
 * `1` is the one ambiguous case (`i` in "1nstructions", `l` in "a11"), which is why
 * this returns a LIST: one form per reading, consistently applied. Two forms, not
 * 2^n — a per-position expansion is exponential in the attacker's input length.
 *
 * `$` is NOT here, though "$ystem" is a real evasion: it is also how this product's
 * buyers write money, and folding it inside "$1M" defeats the price exemption in
 * the `forget everything above …` rule — which is a hard 422 on "Forget everything
 * above the $1M asking price". A miss is the cheaper of the two.
 */
const LEET: Record<string, [string, string]> = {
  '0': ['o', 'o'], '1': ['i', 'l'], '3': ['e', 'e'], '4': ['a', 'a'],
  '5': ['s', 's'], '7': ['t', 't'], '@': ['a', 'a'],
};
const LETTER = /\p{L}/u;

function foldLeet(text: string, reading: 0 | 1): string {
  const isLetter = (i: number) => LETTER.test(text[i] ?? '');
  const fold = text.split('').map((ch, i) => !!LEET[ch] && (isLetter(i - 1) || isLetter(i + 1)));
  // Spread along the run: a leet character next to one that already folds is part
  // of the same hidden word.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < text.length; i++) {
      if (fold[i] || !LEET[text[i]!]) continue;
      if (fold[i - 1] || fold[i + 1]) { fold[i] = true; changed = true; }
    }
  }
  return text.split('').map((ch, i) => (fold[i] ? LEET[ch]![reading] : ch)).join('');
}

/**
 * The forms left once the two obfuscations above are undone, minus the two the
 * caller already has. Empty when the text carries neither — most text — so the
 * extra regex passes are paid for only by input that looks tampered with.
 */
/**
 * A de-obfuscated form, and WHICH rewrites produced it.
 *
 * The flags exist because two screening rules are broken by de-obfuscation for
 * OPPOSITE reasons, and a single "may this rule read the de-obfuscated forms"
 * boolean could only turn both off together (round 11, `mod-jailbreak-leet-2`):
 *
 *   - the jailbreak framing is broken by JOINING — `Jail-Break: The Escape Room`
 *     becomes `jailbreak:`, an attack shape, and that is a real Florida business;
 *   - the price ceiling is broken by LEET — `above 1M` becomes `above im`, killing
 *     the digit that tells the rule "this is a ceiling, not an override".
 *
 * Each flag says the rewrite actually CHANGED the text, not merely that it was
 * attempted, so a form that survives a rewrite unaltered is not labelled with it.
 * That also keeps the de-duplication below honest: the first emission of a string
 * wins, and it is the one whose flags describe what really happened to it.
 */
export interface DeobfuscatedForm {
  form: string;
  /** Intra-word separators were removed to produce this. */
  joined: boolean;
  /** Digits standing in for letters were folded back to produce this. */
  leet: boolean;
}

export function deobfuscate(normalized: string, unpadded: string): DeobfuscatedForm[] {
  const out: DeobfuscatedForm[] = [];
  const seen = new Set([normalized, unpadded]);
  for (const base of new Set([normalized, unpadded])) {
    const joinedForm = base.replace(INTRA_WORD_SEPARATOR, '');
    const joined = joinedForm !== base;
    for (const form of [joinedForm, foldLeet(joinedForm, 0), foldLeet(joinedForm, 1)]) {
      if (seen.has(form)) continue;
      seen.add(form);
      out.push({ form, joined, leet: form !== joinedForm });
    }
  }
  return out;
}

/**
 * A run of 3+ single characters separated by anything — the shape of "i.g.n.o.r.e"
 * and "i g n o r e" — joined into one word. Nothing else is touched: a real word
 * has multi-character tokens, so it never enters a run.
 */
const PADDING_RUN = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][^\p{L}\p{N}]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;

export function unpad(text: string): string {
  return text.replace(PADDING_RUN, (run) => run.replace(/[^\p{L}\p{N}]+/gu, ''));
}

/**
 * The separator-tolerant twin of a screening pattern: every inter-word gap becomes
 * "any run of separators, or none at all". That covers `system-prompt`,
 * `system_prompt`, `ignore***all***previous`, and — matched against `unpadded` —
 * the de-padded forms, where the gap has already been closed.
 *
 * Word boundaries (`\b`) are KEPT, unlike the squeezed twin this replaces. They
 * are what stops `\b(?:system|developer)\s+prompt\b` from firing on
 * "ecoSYSTEM PROMPTed growth".
 */
/**
 * A gap between two words of a pattern — any run of separators, or none.
 *
 * Punctuation is INCLUDED, deliberately: defeating `i.g.n.o.r.e a.l.l` and
 * `ignore***all***previous` is the entire reason this rewrite exists. Excluding
 * sentence terminators to stop one over-broad pattern from crossing a full stop
 * reopened that class wholesale — `ignore.all.previous.instructions` and
 * `Ignore all previous;instructions` both walked straight through, and `unpad`
 * does not rescue them because a run of multi-character tokens is not a padding
 * run. The pattern that was crossing sentences was the thing to fix, and was.
 */
/**
 * Shorten any run of separators longer than four to its first two and last two
 * characters — the only bound on how much work a screening pattern can be made to
 * do.
 *
 * The tolerant twin writes every inter-word gap as `[^\p{L}\p{N}]*`, and two of
 * the rules have three of those adjacent with optional groups between them. On a
 * string that ALMOST matches, that backtracks CUBICALLY in the length of the run:
 * `disregard` followed by 2,000 dots measured **3.0 seconds** of a single thread,
 * on `/research/preflight`, before anything is billed (round 10, G3-break F3).
 * 500 / 1000 / 1500 / 2000 dots measured 57ms / 457ms / 1.6s / 3.7s.
 *
 * A run this long carries nothing a pattern needs: the gaps exist to defeat
 * `i.g.n.o.r.e` and `ignore***all`, whose runs are one to three characters. Both
 * ENDS are kept rather than a prefix, because the character that matters can sit
 * at either — the price exemption reads a `$` at the end of the gap before it
 * (`forget everything above  —  $1M`), and a `:` at the start of the one after
 * `jailbreak` is what makes it an instruction.
 *
 * Applied where the patterns are matched, not in `screeningForms`: the correction
 * guard reads `normalized` for a similarity score, and clamping is a decision
 * about regex cost, not about what the text says.
 */
const LONG_SEPARATOR_RUN = /[^\p{L}\p{N}]{5,}/gu;
export function clampSeparatorRuns(text: string): string {
  return text.replace(LONG_SEPARATOR_RUN, (run) => run.slice(0, 2) + run.slice(-2));
}

const GAP = '[^\\p{L}\\p{N}]*';
export function tolerantPattern(re: RegExp): RegExp {
  const source = re.source.replace(/\\s\+/g, GAP).replace(/\\s\*/g, GAP).replace(/ /g, GAP);
  return new RegExp(source, re.flags.includes('u') ? re.flags.replace('g', '') : `${re.flags.replace('g', '')}u`);
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
