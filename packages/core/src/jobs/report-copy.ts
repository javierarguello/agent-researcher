/**
 * What the BUYER reads when a report comes back incomplete.
 *
 * The same rule as `moderation/copy.ts`, applied to a different leak: no internal
 * string is ever shown to a customer. A degraded report used to explain itself with
 * `trace.warnings` rendered verbatim —
 *
 *   Degraded [risks_red_flags] from agent "market-analyst" after exhausting retries…
 *
 * — in English, to Spanish, French and Portuguese customers, naming our agents and
 * our section keys. That text is diagnostics. It belongs in the trace and in the
 * admin, and it is still there; what the buyer gets is written here, in their own
 * language, and says the one thing they actually need to know.
 */
import { asLang, type Lang } from '../moderation/copy.js';

type Copy = Record<Lang, string>;
const pick = (c: Copy, lang: Lang): string => c[lang] ?? c.en;

/**
 * The placeholder that stands in for a section we could not produce. Goes INSIDE
 * report.json, so it is read in the middle of the document — short, plain, and
 * without blaming a component the reader has never heard of.
 */
const SECTION_NOTE: Copy = {
  en: '_We could not complete this section with sources we were confident in, so it has been left out rather than filled with guesses._',
  es: '_No pudimos completar esta sección con fuentes confiables, así que preferimos dejarla fuera antes que llenarla con suposiciones._',
  fr: '_Nous n’avons pas pu compléter cette section avec des sources fiables ; nous avons préféré la laisser de côté plutôt que d’avancer des suppositions._',
  pt: '_Não conseguimos concluir esta seção com fontes confiáveis, então preferimos deixá-la de fora em vez de preenchê-la com suposições._',
};

/** One section could not be produced. */
export function degradedSectionNote(lang: unknown): string {
  return pick(SECTION_NOTE, asLang(lang));
}

const NOTICE_ONE: Copy = {
  en: 'One section of this dossier could not be completed with sources we were confident in. Everything else is complete. If this section matters to you, reply and we will look at it.',
  es: 'Una sección de este dossier no pudo completarse con fuentes confiables. Todo lo demás está completo. Si esa sección te importa, escríbenos y la revisamos.',
  fr: 'Une section de ce dossier n’a pas pu être complétée avec des sources fiables. Tout le reste est complet. Si cette section vous importe, écrivez-nous et nous la reprendrons.',
  pt: 'Uma seção deste dossiê não pôde ser concluída com fontes confiáveis. Todo o restante está completo. Se essa seção for importante para você, escreva e nós revisamos.',
};

const NOTICE_MANY: Copy = {
  en: '{n} sections of this dossier could not be completed with sources we were confident in. Everything else is complete. If those sections matter to you, reply and we will look at it.',
  es: '{n} secciones de este dossier no pudieron completarse con fuentes confiables. Todo lo demás está completo. Si esas secciones te importan, escríbenos y las revisamos.',
  fr: '{n} sections de ce dossier n’ont pas pu être complétées avec des sources fiables. Tout le reste est complet. Si ces sections vous importent, écrivez-nous et nous les reprendrons.',
  pt: '{n} seções deste dossiê não puderam ser concluídas com fontes confiáveis. Todo o restante está completo. Se essas seções forem importantes para você, escreva e nós revisamos.',
};

/**
 * The one line shown above a delivered-but-incomplete report. Returns '' when
 * nothing degraded, so a complete report carries no notice at all.
 */
export function degradedNotice(lang: unknown, degradedCount: number): string {
  if (degradedCount <= 0) return '';
  const l = asLang(lang);
  return degradedCount === 1 ? pick(NOTICE_ONE, l) : pick(NOTICE_MANY, l).replace('{n}', String(degradedCount));
}

const HELD_NOTICE: Copy = {
  en: 'Paused while we review it. Nothing more is being spent, and we will come back to you.',
  es: 'En pausa mientras lo revisamos. No se está gastando nada más y volvemos contigo.',
  fr: 'En pause pendant que nous l’examinons. Rien de plus n’est dépensé, et nous revenons vers vous.',
  pt: 'Em pausa enquanto revisamos. Nada mais está sendo gasto e voltaremos a você.',
};

/**
 * The progress line a buyer sees on a parked job.
 *
 * It is rendered raw by the client, so it has to be the buyer's language and it
 * must not name an internal limit — "held at the cost ceiling" tells a customer
 * about our budget, which is neither their business nor their problem.
 */
export function heldNotice(lang: unknown): string {
  return pick(HELD_NOTICE, asLang(lang));
}

const CLOSED_NOTICE: Copy = {
  en: 'This report could not be completed.',
  es: 'Este informe no pudo completarse.',
  fr: 'Ce rapport n’a pas pu être terminé.',
  pt: 'Este relatório não pôde ser concluído.',
};

const CLOSED_REFUNDED_NOTICE: Copy = {
  en: 'This report could not be completed, and the credits were returned.',
  es: 'Este informe no pudo completarse y los créditos fueron devueltos.',
  fr: 'Ce rapport n’a pas pu être terminé, et les crédits ont été restitués.',
  pt: 'Este relatório não pôde ser concluído e os créditos foram devolvidos.',
};

/**
 * What a buyer reads on a job an admin closed.
 *
 * Two strings, and which one is written depends on what actually happened to the
 * money — never on what the admin intended. The resolve route flips the job before
 * it refunds (deliberately: the flip is what stops two admins both moving money),
 * so writing the refund sentence up front promised something that had not happened
 * yet and could still fail.
 */
export function closedNotice(lang: unknown, refunded: boolean): string {
  return pick(refunded ? CLOSED_REFUNDED_NOTICE : CLOSED_NOTICE, asLang(lang));
}
