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
 * A section no producer ever researched, written by the pass that was meant to
 * DEEPEN it (the producer was given up on and the finalize pass runs the deferred
 * steps best-effort).
 *
 * It must not borrow the `unenriched` sentence: that one says the section "was
 * researched and written… complete and sourced as usual", which is exactly what
 * did not happen here. What is true in every case — with real upstream sections
 * to work from or without — is that the step which researches it never finished
 * and a later pass wrote it anyway.
 */
const REBUILT_ONE: Copy = {
  en: 'For one section of this dossier the step that researches it did not finish, and a later step wrote the section from the rest of the dossier. Read it as less directly sourced than the others.',
  es: 'En una sección de este dossier la etapa que la investiga no llegó a completarse, y una etapa posterior la redactó a partir del resto del dossier. Tómala como menos documentada que las demás.',
  fr: 'Pour une section de ce dossier, l’étape qui la recherche n’a pas abouti, et une étape ultérieure l’a rédigée à partir du reste du dossier. Considérez-la comme moins directement sourcée que les autres.',
  pt: 'Em uma seção deste dossiê a etapa que a pesquisa não foi concluída, e uma etapa posterior a redigiu a partir do restante do dossiê. Leia-a como menos documentada que as demais.',
};

const REBUILT_MANY: Copy = {
  en: 'For {n} sections of this dossier the step that researches them did not finish, and a later step wrote them from the rest of the dossier. Read them as less directly sourced than the others.',
  es: 'En {n} secciones de este dossier la etapa que las investiga no llegó a completarse, y una etapa posterior las redactó a partir del resto del dossier. Tómalas como menos documentadas que las demás.',
  fr: 'Pour {n} sections de ce dossier, l’étape qui les recherche n’a pas abouti, et une étape ultérieure les a rédigées à partir du reste du dossier. Considérez-les comme moins directement sourcées que les autres.',
  pt: 'Em {n} seções deste dossiê a etapa que as pesquisa não foi concluída, e uma etapa posterior as redigiu a partir do restante do dossiê. Leia-as como menos documentadas que as demais.',
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
export function sectionsNotice(lang: unknown, statuses: Array<{ status: 'lost' | 'unenriched' | 'reconstructed' }>): string {
  const l = asLang(lang);
  const lost = statuses.filter((x) => x.status === 'lost').length;
  const shallow = statuses.filter((x) => x.status === 'unenriched').length;
  const rebuilt = statuses.filter((x) => x.status === 'reconstructed').length;
  const parts: string[] = [];
  if (lost > 0) parts.push(lost === 1 ? pick(LOST_ONE, l) : pick(LOST_MANY, l).replace('{n}', String(lost)));
  if (shallow > 0) parts.push(shallow === 1 ? pick(SHALLOW_ONE, l) : pick(SHALLOW_MANY, l).replace('{n}', String(shallow)));
  if (rebuilt > 0) parts.push(rebuilt === 1 ? pick(REBUILT_ONE, l) : pick(REBUILT_MANY, l).replace('{n}', String(rebuilt)));
  // Only claimed when it is true. Said unconditionally, it contradicted the very
  // next sentence on a report that had both kinds.
  if (lost > 0 && shallow === 0 && rebuilt === 0) parts.push(pick(ALL_ELSE_OK, l));
  if (lost > 0) parts.push(pick(WRITE_TO_US, l));
  return parts.join(' ');
}

// `heldNotice` lived here: a localized "paused while we review it" that `run-job`
// wrote into `progress.message`. It has had no reader since `9850bdf` — the API
// hands a buyer the KIND and never the message, and the SPA renders `held` from its
// own table. Two copies of one sentence in four languages, which had already drifted
// in two of them (round 7, R7-22). The kind carries it; the message is the admin's,
// in English, like every other one.

const RATE_LIMIT_USER: Copy = {
  en: 'You have reached the limit of reports per hour. Please try again shortly.',
  es: 'Has alcanzado el límite de informes por hora. Inténtalo de nuevo en un rato.',
  fr: 'Vous avez atteint la limite de rapports par heure. Réessayez dans un moment.',
  pt: 'Você atingiu o limite de relatórios por hora. Tente novamente em instantes.',
};

const RATE_LIMIT_CAPACITY: Copy = {
  en: 'We are at capacity right now. Please try again shortly — nothing was charged.',
  es: 'Estamos al límite de capacidad ahora mismo. Inténtalo de nuevo en un rato — no se te cobró nada.',
  fr: 'Nous sommes à pleine capacité en ce moment. Réessayez dans un moment — rien ne vous a été facturé.',
  pt: 'Estamos no limite de capacidade agora. Tente novamente em instantes — nada foi cobrado.',
};

/**
 * What a buyer reads when a report request is rate-limited.
 *
 * Two sentences, because there are two different facts. `user` is this person's
 * own hourly cap. `app` is the bucket EVERY customer of the app draws from, and
 * the old message — `Rate limit exceeded: 100 reports/hour per app` — told a
 * buyer who had generated one report that they had exceeded a hundred. In
 * English, whatever they read. It named an internal scope, blamed them for
 * someone else's traffic, and did not say the thing they most need to know,
 * which is that no credits moved.
 */
export function rateLimitNotice(lang: unknown, scope: string): string {
  return pick(scope === 'user' ? RATE_LIMIT_USER : RATE_LIMIT_CAPACITY, asLang(lang));
}

const TOO_MANY_REQUESTS: Copy = {
  en: 'Too many requests. Please wait a moment and try again.',
  es: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  fr: 'Trop de requêtes. Patientez un instant et réessayez.',
  pt: 'Muitas solicitações. Aguarde um momento e tente novamente.',
};

const TOO_MANY_CHECKOUTS: Copy = {
  en: 'Too many checkout attempts. Please wait a moment and try again — nothing was charged.',
  es: 'Demasiados intentos de pago. Espera un momento e inténtalo de nuevo — no se te cobró nada.',
  fr: 'Trop de tentatives de paiement. Patientez un instant et réessayez — rien ne vous a été facturé.',
  pt: 'Muitas tentativas de pagamento. Aguarde um momento e tente novamente — nada foi cobrado.',
};

/**
 * What a person reads when a NON-report request is rate-limited.
 *
 * `rateLimitNotice` above is the report route's, and it was the only 429 in the
 * product that spoke the buyer's language. The other four — the captcha burst
 * window, every public endpoint, the plans list and the checkout button — sent one
 * of three hand-written English sentences into a page translated into four
 * languages, on the three doors a NEW buyer walks through first: register, sign in,
 * pay.
 *
 * One sentence for all of them, not three: they state the same fact. Checkout keeps
 * its own, because there the person has just pressed a button that takes money and
 * the thing they most need to know is that none moved — the same reason
 * `RATE_LIMIT_CAPACITY` says it.
 */
export function tooManyRequestsNotice(lang: unknown, kind: 'requests' | 'checkout' = 'requests'): string {
  return pick(kind === 'checkout' ? TOO_MANY_CHECKOUTS : TOO_MANY_REQUESTS, asLang(lang));
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
