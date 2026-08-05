/**
 * The "your report is ready" mail, when the report is not whole.
 *
 * `meta.sections` records what did not come out; `run-job.ts` turns it into
 * `summary.notice` in the buyer's language, and that sentence reached the web
 * viewer, the shared read-only page and the PDF cover. It did not reach this
 * mail — which is the message that arrives unprompted and is often the only
 * thing read before the PDF is opened. A dossier with a section missing was
 * announced as finished, by us, in writing.
 *
 * The notice is NOT rebuilt here: it is the same string the buyer has already
 * been shown elsewhere, passed through. So these tests feed `sectionsNotice`'s
 * real output in and check it survives — a mail carrying a second, differently
 * worded description of the same report is the failure this shape prevents.
 */
import { describe, it, expect } from 'vitest';
import { reportReadyTemplate } from '../src/email/templates.js';
import { sectionsNotice } from '../src/jobs/report-copy.js';

const LANGS = ['en', 'es', 'fr', 'pt'] as const;
/** The notice block's own styling — present iff the mail carries one. */
const NOTICE_MARK = 'background:#fdf6ee';
const mail = (lang: string, notice?: string) => reportReadyTemplate('Florida Biz Labs', 'Un titre', 'https://x/y', lang, notice);

describe('the ready mail says when the dossier is incomplete', () => {
  it('carries the very sentence the viewer and the PDF carry', () => {
    const notice = sectionsNotice('en', [{ status: 'lost' }]);
    const m = mail('en', notice);

    // Anchored on the whole sentence, not on the presence of some notice block:
    // a mail that says "some parts are missing" in its own words is exactly the
    // second, drifting description this passes the string through to avoid.
    expect(notice).toMatch(/could not be completed/i); // the premise
    expect(m.html).toContain(notice);
    expect(m.text).toContain(notice);
  });

  it('says nothing at all when the dossier is whole', () => {
    // The live control. "Always shows a notice" has to fail as loudly as "never
    // shows one" — a clean report that arrives hedged is its own defect, and
    // `sectionsNotice` returns '' precisely so this mail stays unchanged.
    const clean = mail('en', sectionsNotice('en', []));
    expect(sectionsNotice('en', [])).toBe(''); // the premise

    // Anchored on the BLOCK, not on any sentence and not on this function
    // compared with itself. `expect(clean.html).toBe(mail('en').html)` was the
    // first version and it passes for a template that hedges unconditionally:
    // both sides come out of the same code, so they agree on whatever it does.
    // A wrong answer twice is still equal to itself.
    const hedged = mail('en', 'Something may be missing.');
    expect(hedged.html, 'the premise: a notice is a visible block').toContain(NOTICE_MARK);
    expect(clean.html, 'a whole dossier arrived hedged').not.toContain(NOTICE_MARK);

    // …and the text version, which has no markup to key on: it is the mail's
    // paragraphs and nothing else.
    expect(hedged.text.split('\n\n').length).toBeGreaterThan(clean.text.split('\n\n').length);
    expect(clean.text).not.toMatch(/could not be completed|section/i);
  });

  it('reaches the buyer in the buyer’s language, not English', () => {
    // The mail is localized everywhere else; a notice bolted on in English would
    // put the one sentence that changes what they do next in a language they may
    // not read. Anchored per language on words a speaker would notice missing.
    const anchors: Record<string, RegExp> = {
      es: /no pudieron completarse con fuentes confiables/i,
      fr: /n’ont pas pu être complétées avec des sources fiables/i,
      pt: /não puderam ser concluídas com fontes confiáveis/i,
    };
    for (const [lang, re] of Object.entries(anchors)) {
      const notice = sectionsNotice(lang, [{ status: 'lost' }, { status: 'lost' }]);
      const m = mail(lang, notice);
      expect(`${m.html}\n${m.text}`, `${lang} lost its notice`).toMatch(re);
      expect(m.html, `${lang} got the English notice`).not.toMatch(/could not be completed with sources/i);
    }
  });

  it('tells a lost section apart from a shallow one, in the mail too', () => {
    // The two states get different sentences on every other surface. Collapsing
    // them here would tell a buyer a section "could not be completed" while it
    // sits fully written in the dossier they are about to open.
    const shallow = mail('en', sectionsNotice('en', [{ status: 'unenriched' }]));
    expect(shallow.text).toMatch(/its content is complete and sourced as usual/i);
    expect(shallow.text).not.toMatch(/could not be completed with sources/i);
  });

  it('keeps the mail it already was — heading, button, link and disclaimer', () => {
    // The notice is an insertion, not a rewrite. Losing the CTA or the AI
    // disclaimer to it would be a worse mail than the one with no notice.
    const m = mail('fr', sectionsNotice('fr', [{ status: 'lost' }]));
    expect(m.subject).toContain('Un titre');
    expect(m.html).toMatch(/Votre rapport est prêt/);
    expect(m.html).toMatch(/Voir le rapport/); // the button
    expect(m.html).toContain('https://x/y');
    expect(m.text).toMatch(/Recherche générée par IA/); // the disclaimer, still last
    expect(m.text.trimEnd().endsWith('avant d’agir.')).toBe(true);
  });

  it('does not let the notice reach the markup unchecked', () => {
    for (const lang of LANGS) {
      const m = mail(lang, 'One section <script>alert(1)</script> & more');
      expect(m.html, lang).not.toMatch(/<script>/);
      expect(m.html, lang).toContain('One section scriptalert(1)/script  more');
    }
  });
});
