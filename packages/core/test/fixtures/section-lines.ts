/**
 * The line printed UNDER an incomplete section, in every language, and the full
 * set of statuses a writer may put in `meta.sections`.
 *
 * Sibling of `legacy-section-shapes.ts` and shared for the same reason: this
 * sentence exists THREE times — the notice above the report
 * (`packages/core/src/jobs/report-copy.ts`), the PDF the buyer keeps
 * (`packages/core/src/pdf/report-html.ts`) and the on-screen viewer
 * (`apps/fbizlab/src/components/ReportViewer.tsx`, a static bundle with no
 * dependency on core). A wording fix landed in one of the three and the French
 * buyer went on reading `la passe` — a sports pass — under the section, and the
 * Portuguese one `a passagem`, a passageway, in both the viewer and the PDF they
 * download. The core test that was supposed to pin the fix only read the notice.
 *
 * So the two per-section tables are asserted against THIS one, key by key and
 * language by language, from core's suite and from the buyer app's. Change a
 * sentence in one copy and the other suite goes red.
 *
 * Imported across the workspace boundary by
 * `apps/fbizlab/test/section-copy-parity.test.tsx`; keep it free of imports so
 * that boundary stays a file path and not a build dependency.
 */

/**
 * Every status the engine can write. Both readers coerce anything ELSE to
 * `lost` — see `packages/core/src/engine/section-status.ts` for why that
 * direction, and what it costs when a browser is a bundle behind.
 *
 * Core's suite ties this list to the `SectionStatus['status']` union with a
 * `Record<…, true>`, so adding a fourth status is a type error here first and a
 * red test in BOTH readers second. That is the point: a status no renderer knows
 * yet must not reach a buyer's screen before the renderer does.
 */
export const SECTION_STATUSES = ['lost', 'unenriched', 'reconstructed'] as const;

export type SectionLineKey = 'degradedSection' | 'allElseOk' | 'unenrichedSection' | 'reconstructedSection';

/**
 * Canonical per-section lines.
 *
 *   - `degradedSection` — the body was suppressed; say so. (English carried an
 *     extra "below" in the viewer only; no other language had a word for it, so it
 *     is gone.)
 *   - `allElseOk` — the reassurance, and a SEPARATE key because it is only true
 *     sometimes. It used to be the second sentence of `degradedSection`, so a
 *     report with two lost sections told the buyer twice that everything else was
 *     researched as usual — once under each gap — and a report with one lost and
 *     one shallow section contradicted itself a screen apart (round 9, R9-7).
 *     `sectionsNotice` was split into `ALL_ELSE_OK` for exactly this reason and the
 *     per-section copy never was; this fixture then canonicalised the unfixed
 *     sentence into all four languages. Rendered only when this section is the ONLY
 *     one with anything to report.
 *   - `unenrichedSection` — the body is real, the deepening step did not run.
 *     Says "step" in all four languages, the same word the notice uses.
 *   - `reconstructedSection` — no producer researched it; a later step wrote it
 *     from the rest of the dossier. Must never borrow `unenriched`'s
 *     "researched and written… sourced as usual".
 */
export const SECTION_LINES: Record<'en' | 'es' | 'fr' | 'pt', Record<SectionLineKey, string>> = {
  en: {
    degradedSection: 'We could not complete this section for this report.',
    allElseOk: 'Everything else was researched and written as usual.',
    unenrichedSection: 'This section was researched and written, but the step that adds extra depth to it did not finish. Everything here is sourced as usual.',
    reconstructedSection: 'The step that researches this section did not finish. A later step wrote it from the rest of the dossier, so read it as less directly sourced than the others.',
  },
  es: {
    degradedSection: 'No pudimos completar esta sección para este informe.',
    allElseOk: 'Todo lo demás se investigó y redactó con normalidad.',
    unenrichedSection: 'Esta sección se investigó y redactó, pero la etapa que le agrega profundidad no llegó a completarse. Todo lo que ves aquí está documentado como siempre.',
    reconstructedSection: 'La etapa que investiga esta sección no llegó a completarse. Una etapa posterior la redactó a partir del resto del dossier, así que tómala como menos documentada que las demás.',
  },
  fr: {
    degradedSection: 'Nous n’avons pas pu terminer cette section pour ce rapport.',
    allElseOk: 'Tout le reste a été recherché et rédigé normalement.',
    unenrichedSection: 'Cette section a été recherchée et rédigée, mais l’étape qui lui ajoute de la profondeur n’a pas abouti. Tout ce qui figure ici est sourcé comme d’habitude.',
    reconstructedSection: 'L’étape qui recherche cette section n’a pas abouti. Une étape ultérieure l’a rédigée à partir du reste du dossier : considérez-la comme moins directement sourcée que les autres.',
  },
  pt: {
    degradedSection: 'Não conseguimos concluir esta seção deste relatório.',
    allElseOk: 'Todo o restante foi pesquisado e redigido normalmente.',
    unenrichedSection: 'Esta seção foi pesquisada e redigida, mas a etapa que lhe acrescenta profundidade não foi concluída. Tudo aqui está documentado como sempre.',
    reconstructedSection: 'A etapa que pesquisa esta seção não foi concluída. Uma etapa posterior a redigiu a partir do restante do dossiê, portanto leia-a como menos documentada que as demais.',
  },
};

/**
 * Words that mean a sports pass, a passageway or a laundry cycle in the language
 * they appear in. They described an internal step to a paying reader; the notice
 * was corrected and the other two copies were not.
 */
export const WRONG_STEP_WORDS: Record<'es' | 'fr' | 'pt', RegExp> = {
  es: /\bla pasada\b/i,
  fr: /\bla passe\b/i,
  pt: /\ba passagem\b/i,
};
