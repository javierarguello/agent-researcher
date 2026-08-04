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

const LOST_ONE: Copy = {
  en: 'One section of this dossier could not be completed with sources we were confident in.',
  es: 'Una sección de este dossier no pudo completarse con fuentes confiables.',
  fr: 'Une section de ce dossier n’a pas pu être complétée avec des sources fiables.',
  pt: 'Uma seção deste dossiê não pôde ser concluída com fontes confiáveis.',
};

const LOST_MANY: Copy = {
  en: '{n} sections of this dossier could not be completed with sources we were confident in.',
  es: '{n} secciones de este dossier no pudieron completarse con fuentes confiables.',
  fr: '{n} sections de ce dossier n’ont pas pu être complétées avec des sources fiables.',
  pt: '{n} seções deste dossiê não puderam ser concluídas com fontes confiáveis.',
};

/**
 * Only said when NOTHING else is wrong.
 *
 * It used to be part of the sentence above, so a report with one lost section and
 * one shallow one told the buyer "Everything else is complete." and then, in the
 * next sentence, that it was not.
 */
const ALL_ELSE_OK: Copy = {
  en: 'Everything else is complete.',
  es: 'Todo lo demás está completo.',
  fr: 'Tout le reste est complet.',
  pt: 'Todo o restante está completo.',
};

const WRITE_TO_US: Copy = {
  en: 'If that matters to you, reply and we will look at it.',
  es: 'Si eso te importa, escríbenos y lo revisamos.',
  fr: 'Si cela vous importe, écrivez-nous et nous le reprendrons.',
  pt: 'Se isso for importante para você, escreva e nós revisamos.',
};

/**
 * "The pass that adds extra depth" — an internal step, named for a buyer.
 *
 * The French said `la passe` and the Portuguese `a passagem`, which are a sports
 * pass and a passageway. `l'étape` and `a etapa` are what a person would say.
 */
const SHALLOW_ONE: Copy = {
  en: 'One section of this dossier was researched and written, but the step that adds extra depth to it did not finish. Its content is complete and sourced as usual.',
  es: 'Una sección de este dossier se investigó y redactó, pero la etapa que le agrega profundidad no llegó a completarse. Su contenido está completo y documentado como siempre.',
  fr: 'Une section de ce dossier a été recherchée et rédigée, mais l’étape qui lui ajoute de la profondeur n’a pas abouti. Son contenu est complet et sourcé comme d’habitude.',
  pt: 'Uma seção deste dossiê foi pesquisada e redigida, mas a etapa que lhe acrescenta profundidade não foi concluída. Seu conteúdo está completo e documentado como sempre.',
};

const SHALLOW_MANY: Copy = {
  en: '{n} sections of this dossier were researched and written, but the step that adds extra depth to them did not finish. Their content is complete and sourced as usual.',
  es: '{n} secciones de este dossier se investigaron y redactaron, pero la etapa que les agrega profundidad no llegó a completarse. Su contenido está completo y documentado como siempre.',
  fr: '{n} sections de ce dossier ont été recherchées et rédigées, mais l’étape qui leur ajoute de la profondeur n’a pas abouti. Leur contenu est complet et sourcé comme d’habitude.',
  pt: '{n} seções deste dossiê foram pesquisadas e redigidas, mas a etapa que lhes acrescenta profundidade não foi concluída. Seu conteúdo está completo e documentado como sempre.',
};

/**
 * The line shown above a delivered-but-incomplete report. `''` when there is
 * nothing to say, so a clean report carries no notice at all.
 *
 * The two states get DIFFERENT sentences, and that is the point: counting them
 * together would tell a buyer a section "could not be completed" when it is right
 * there in front of them, fully written — which is worse than the silence this
 * replaced.
 */
export function sectionsNotice(lang: unknown, statuses: Array<{ status: 'lost' | 'unenriched' }>): string {
  const l = asLang(lang);
  const lost = statuses.filter((x) => x.status === 'lost').length;
  const shallow = statuses.filter((x) => x.status === 'unenriched').length;
  const parts: string[] = [];
  if (lost > 0) parts.push(lost === 1 ? pick(LOST_ONE, l) : pick(LOST_MANY, l).replace('{n}', String(lost)));
  if (shallow > 0) parts.push(shallow === 1 ? pick(SHALLOW_ONE, l) : pick(SHALLOW_MANY, l).replace('{n}', String(shallow)));
  // Only claimed when it is true. Said unconditionally, it contradicted the very
  // next sentence on a report that had both kinds.
  if (lost > 0 && shallow === 0) parts.push(pick(ALL_ELSE_OK, l));
  if (lost > 0) parts.push(pick(WRITE_TO_US, l));
  return parts.join(' ');
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
