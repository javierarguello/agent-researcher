/**
 * The payment page may not invent a number.
 *
 * `/app/credits` answered "When is my dossier ready?" with **"about 2–8 minutes"**,
 * in all four languages, on the screen a buyer reads while deciding to pay. The
 * three comprehensive runs anybody has actually measured took **17, 18 and 20
 * minutes** (`deep-review.md` § Field findings), and C5's soft deadline — 1500s —
 * was derived from two more at 1241s and 1309s. So the figure was wrong by a factor
 * of three at the moment it mattered most, and a buyer who believed it would have
 * concluded something had broken.
 *
 * This is the same class as the two shipped and fixed on 2026-08-24 (the start
 * mail's refund promise, and the `held` close-page line): copy that describes
 * behaviour nobody re-checked against the behaviour.
 *
 * It asserts the FACT, not the wording — a translator may rewrite the sentence, and
 * only a claim that contradicts what we measured should turn this red.
 */
import { describe, it, expect } from 'vitest';
import { T } from '../src/pages/Credits';
import { LANGS } from '../src/i18n';

/** Measured comprehensive runs, minutes: 17, 18, 20 (plus 20.7 and 21.8 from C5). */
const MEASURED_MIN = 17;
const MEASURED_MAX = 22;

describe('the credits FAQ tells the truth about how long a dossier takes', () => {
  it('quotes no duration outside what was actually measured', () => {
    for (const lang of LANGS) {
      const a3 = (T as Record<string, Record<string, string>>)[lang]!.a3!;
      // Every minute-figure the sentence contains, in any of the four languages.
      const mins = [...a3.matchAll(/(\d+)\s*(?:–|-|a |to |à |até )?\s*(\d+)?\s*(?:min|minut)/gi)]
        .flatMap((m) => [m[1], m[2]])
        .filter(Boolean)
        .map(Number);
      expect(mins.length, `${lang} names no duration at all — see the control below`).toBeGreaterThan(0);
      for (const n of mins) {
        expect(n, `${lang} promises ${n} minutes; measured runs are ${MEASURED_MIN}-${MEASURED_MAX}`)
          .toBeGreaterThanOrEqual(MEASURED_MIN);
        expect(n, `${lang} promises ${n} minutes; measured runs are ${MEASURED_MIN}-${MEASURED_MAX}`)
          .toBeLessThanOrEqual(MEASURED_MAX);
      }
    }
  });

  it('and tells the buyer they will be emailed, so the number is not the only answer', () => {
    // The honest half of this FAQ: the wait does not have to be watched. P-10 made
    // that true (`reportStartedTemplate` + the completion mail), and this is the
    // page where a buyer first needs to know it. Anchored per language on the word
    // for "email"/"write", not on the whole sentence.
    const anchors: Record<string, RegExp> = {
      en: /email/i,
      es: /escribimos|correo/i,
      fr: /écrivons|e-?mail/i,
      pt: /escrevemos|e-?mail/i,
    };
    for (const [lang, re] of Object.entries(anchors)) {
      const a3 = (T as Record<string, Record<string, string>>)[lang]!.a3!;
      expect(a3, `${lang} does not mention the email`).toMatch(re);
    }
  });
});
