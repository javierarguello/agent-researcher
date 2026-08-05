/**
 * Fixed, localized copy for everything the moderation / pre-flight layer shows a
 * user or persists.
 *
 * The rule this file exists to enforce: **no string produced by an LLM is ever
 * rendered or stored**. The cheap models return CODES from a closed vocabulary;
 * this module turns a code into wording we wrote. That removes the whole class of
 * "the model repeated back what the attacker dictated" problems (a spoofed block
 * reason in the admin panel, a phishing line in the confirm dialog) and makes the
 * user-facing text deterministic and translatable.
 */

// Re-exported, not redeclared. This file used to write the union out again, which
// meant `LANGUAGE_LABELS` could lose a language and every `Record<Lang, …>` table
// below stayed happily compiling with a key nobody supports — and, the direction
// that reaches a buyer, gain one that no table here has strings for.
import { LANGS, type Lang } from '../languages.js';
export { LANGS, type Lang };

export function asLang(v: unknown): Lang {
  return typeof v === 'string' && (LANGS as string[]).includes(v) ? (v as Lang) : 'en';
}

type Copy = Record<Lang, string>;
const pick = (c: Copy | undefined, lang: Lang): string => c?.[lang] ?? c?.en ?? '';

// --- Moderation categories ---------------------------------------------------

/** The closed set of reasons a request may be rejected. The LLM classifier may
 *  only answer with one of these; anything else collapses to `other`. */
export const MODERATION_CATEGORIES = [
  'prompt_injection',
  'profanity_hate',
  'harassment_threats',
  'sexual_explicit',
  'violence_graphic',
  'control_chars',
  'other',
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export function asModerationCategory(v: unknown): ModerationCategory {
  return typeof v === 'string' && (MODERATION_CATEGORIES as readonly string[]).includes(v)
    ? (v as ModerationCategory)
    : 'other';
}

const MODERATION_COPY: Record<ModerationCategory, Copy> = {
  prompt_injection: {
    en: 'Your request looks like it is trying to change how the assistant works. Describe what you want researched in plain terms.',
    es: 'Tu solicitud parece intentar cambiar el funcionamiento del asistente. Describe en palabras normales qué quieres investigar.',
    fr: 'Votre demande semble vouloir modifier le fonctionnement de l’assistant. Décrivez simplement ce que vous voulez rechercher.',
    pt: 'Seu pedido parece tentar alterar o funcionamento do assistente. Descreva em palavras simples o que deseja pesquisar.',
  },
  profanity_hate: {
    en: 'Your request contains offensive language. Please rephrase it.',
    es: 'Tu solicitud contiene lenguaje ofensivo. Por favor, reescríbela.',
    fr: 'Votre demande contient un langage offensant. Merci de la reformuler.',
    pt: 'Seu pedido contém linguagem ofensiva. Por favor, reescreva-o.',
  },
  harassment_threats: {
    en: 'Your request targets or threatens a person. Please rephrase it.',
    es: 'Tu solicitud señala o amenaza a una persona. Por favor, reescríbela.',
    fr: 'Votre demande vise ou menace une personne. Merci de la reformuler.',
    pt: 'Seu pedido ataca ou ameaça uma pessoa. Por favor, reescreva-o.',
  },
  sexual_explicit: {
    en: 'Your request contains explicit content. Note that researching a lawful adult-oriented business is allowed — explicit wording is not.',
    es: 'Tu solicitud contiene contenido explícito. Investigar un negocio legal para adultos sí está permitido; el lenguaje explícito no.',
    fr: 'Votre demande contient un contenu explicite. Rechercher une activité légale pour adultes est permis ; les propos explicites ne le sont pas.',
    pt: 'Seu pedido contém conteúdo explícito. Pesquisar um negócio adulto legal é permitido; linguagem explícita não.',
  },
  violence_graphic: {
    en: 'Your request contains violent content. Please rephrase it.',
    es: 'Tu solicitud contiene contenido violento. Por favor, reescríbela.',
    fr: 'Votre demande contient un contenu violent. Merci de la reformuler.',
    pt: 'Seu pedido contém conteúdo violento. Por favor, reescreva-o.',
  },
  control_chars: {
    en: 'Your request contains invalid characters. Please remove them and try again.',
    es: 'Tu solicitud contiene caracteres inválidos. Elimínalos e inténtalo de nuevo.',
    fr: 'Votre demande contient des caractères invalides. Supprimez-les et réessayez.',
    pt: 'Seu pedido contém caracteres inválidos. Remova-os e tente novamente.',
  },
  other: {
    en: 'Your request was rejected by our content filter. Please review your details and try again.',
    es: 'Nuestro filtro de contenido rechazó tu solicitud. Revisa los datos e inténtalo de nuevo.',
    fr: 'Notre filtre de contenu a rejeté votre demande. Vérifiez vos informations et réessayez.',
    pt: 'Nosso filtro de conteúdo rejeitou seu pedido. Revise os dados e tente novamente.',
  },
};

/** User-facing wording for a rejection category. Never model output. */
export function moderationMessage(category: ModerationCategory, lang: Lang = 'en'): string {
  return pick(MODERATION_COPY[category], lang);
}

/** Canonical English reason persisted on a blocked account (admin-facing). */
export function blockReasonFor(categories: ModerationCategory[]): string {
  const list = categories.length ? categories.join(', ') : 'other';
  return `Blocked after repeated policy violations in report requests (categories: ${list}).`;
}

/**
 * What a BLOCKED user reads. Separate from `blockReasonFor`, which is the stored,
 * admin-facing line: that string names internal category codes and is English-only,
 * and it was being sent to the customer verbatim — a Spanish user read "Tu cuenta
 * está bloqueada: Blocked after repeated policy violations… (categories:
 * prompt_injection)."
 */
const BLOCKED_COPY = {
  en: 'Your account is blocked for report generation and purchases. Reply to your welcome email if you think this is a mistake.',
  es: 'Tu cuenta está bloqueada para generar informes y comprar créditos. Responde a tu email de bienvenida si crees que es un error.',
  fr: 'Votre compte est bloqué pour la génération de rapports et les achats. Répondez à votre email de bienvenue si vous pensez qu’il s’agit d’une erreur.',
  pt: 'Sua conta está bloqueada para gerar relatórios e comprar créditos. Responda ao seu email de boas-vindas se achar que é um engano.',
};

export function blockedMessage(lang: Lang = 'en'): string {
  return pick(BLOCKED_COPY, lang);
}

// --- Pre-flight issue codes --------------------------------------------------

/**
 * Generic, template-independent findings about a request. A template may declare
 * extra codes with its own copy (`ResearchTemplate.preflight.issueCopy`); the LLM
 * pass may only answer with codes from the union of both sets.
 */
export const CORE_ISSUE_CODES = [
  'missing_subject',
  'no_narrowing_filter',
  'scope_too_broad',
  'contradictory_range',
  'instructions_vague',
  'request_ambiguous',
] as const;
export type CoreIssueCode = (typeof CORE_ISSUE_CODES)[number];

export type IssueSeverity = 'info' | 'warn';

const ISSUE_COPY: Record<CoreIssueCode, Copy> = {
  missing_subject: {
    en: 'No subject is set — add the type of business you are looking for so the search has a target.',
    es: 'No definiste el rubro — indica qué tipo de negocio buscas para que la búsqueda tenga un objetivo.',
    fr: 'Aucun secteur défini — indiquez le type d’activité recherché pour cibler la recherche.',
    pt: 'Nenhum setor definido — informe o tipo de negócio que procura para direcionar a busca.',
  },
  no_narrowing_filter: {
    en: 'No narrowing filter is set. Adding a price ceiling, a minimum revenue or a smaller area gives sharper matches.',
    es: 'No hay ningún filtro que acote la búsqueda. Un techo de precio, un ingreso mínimo o una zona más chica dan resultados más precisos.',
    fr: 'Aucun filtre restrictif. Un plafond de prix, un revenu minimum ou une zone plus petite donnent des résultats plus précis.',
    pt: 'Nenhum filtro restritivo. Um teto de preço, receita mínima ou uma área menor trazem resultados mais precisos.',
  },
  scope_too_broad: {
    en: 'The scope is very wide, so the report will cover a lot at less depth. Narrowing it gives a more useful shortlist.',
    es: 'El alcance es muy amplio, así que el reporte cubrirá mucho con menos profundidad. Acotarlo da una lista corta más útil.',
    fr: 'Le périmètre est très large : le rapport couvrira beaucoup avec moins de profondeur. Le réduire donne une liste plus utile.',
    pt: 'O escopo é muito amplo, então o relatório cobrirá muito com menos profundidade. Reduzi-lo gera uma lista mais útil.',
  },
  contradictory_range: {
    en: 'A minimum is higher than its maximum, so nothing can match. Check the range.',
    es: 'Un mínimo es mayor que su máximo, así que nada puede coincidir. Revisa el rango.',
    fr: 'Un minimum dépasse son maximum : aucun résultat possible. Vérifiez la fourchette.',
    pt: 'Um mínimo é maior que o máximo, então nada pode corresponder. Revise a faixa.',
  },
  instructions_vague: {
    en: 'The free-text instructions are vague. Naming what matters to you (margins, staffing, absentee owner…) focuses the analysis.',
    es: 'Las instrucciones libres son vagas. Nombrar lo que te importa (márgenes, personal, dueño ausente…) enfoca el análisis.',
    fr: 'Les instructions libres sont vagues. Préciser ce qui compte (marges, personnel, propriétaire absent…) recentre l’analyse.',
    pt: 'As instruções livres estão vagas. Dizer o que importa (margens, equipe, dono ausente…) foca a análise.',
  },
  request_ambiguous: {
    en: 'The request reads as ambiguous or self-contradictory. Re-check the fields before spending credits.',
    es: 'La solicitud se lee ambigua o contradictoria. Revisa los campos antes de gastar créditos.',
    fr: 'La demande paraît ambiguë ou contradictoire. Vérifiez les champs avant de dépenser des crédits.',
    pt: 'O pedido parece ambíguo ou contraditório. Revise os campos antes de gastar créditos.',
  },
};

/** Copy for a core issue code, or undefined when the code is template-specific. */
export function coreIssueMessage(code: string, lang: Lang = 'en'): string | undefined {
  return (ISSUE_COPY as Record<string, Copy>)[code] ? pick((ISSUE_COPY as Record<string, Copy>)[code], lang) : undefined;
}

export function isCoreIssueCode(code: string): code is CoreIssueCode {
  return (CORE_ISSUE_CODES as readonly string[]).includes(code);
}

// --- Assisted-review availability -------------------------------------------

export type AssistState = 'on' | 'off_disabled' | 'off_no_credits' | 'off_cooldown' | 'off_attempts';

const ASSIST_COPY: Record<Exclude<AssistState, 'on'>, Copy> = {
  off_disabled: {
    en: 'Assisted review is unavailable right now; the checks below still ran.',
    es: 'La revisión asistida no está disponible ahora; las verificaciones de abajo sí se ejecutaron.',
    fr: 'La relecture assistée est indisponible ; les vérifications ci-dessous ont bien été faites.',
    pt: 'A revisão assistida está indisponível; as verificações abaixo foram feitas.',
  },
  off_no_credits: {
    en: 'Assisted review runs once you have enough credits for this report. The checks below still ran.',
    es: 'La revisión asistida se activa cuando tengas créditos suficientes para este reporte. Las verificaciones de abajo sí se ejecutaron.',
    fr: 'La relecture assistée s’active dès que vous avez assez de crédits pour ce rapport. Les vérifications ci-dessous ont été faites.',
    pt: 'A revisão assistida é ativada quando você tiver créditos suficientes para este relatório. As verificações abaixo foram feitas.',
  },
  off_cooldown: {
    en: 'Assisted review is paused after several previews without generating a report. It comes back automatically — the checks below still ran.',
    es: 'La revisión asistida está en pausa tras varias vistas previas sin generar un reporte. Vuelve sola — las verificaciones de abajo sí se ejecutaron.',
    fr: 'La relecture assistée est en pause après plusieurs aperçus sans génération. Elle revient d’elle-même — les vérifications ci-dessous ont été faites.',
    pt: 'A revisão assistida está pausada após várias prévias sem gerar relatório. Ela volta sozinha — as verificações abaixo foram feitas.',
  },
  off_attempts: {
    en: 'You have already had this request reviewed. The checks below still ran — go ahead and generate when you are ready.',
    es: 'Esta solicitud ya fue revisada. Las verificaciones de abajo sí se ejecutaron — cuando quieras, genera el reporte.',
    fr: 'Cette demande a déjà été relue. Les vérifications ci-dessous ont bien été faites — lancez la génération quand vous voulez.',
    pt: 'Este pedido já foi revisado. As verificações abaixo foram feitas — gere o relatório quando quiser.',
  },
};

export function assistMessage(state: AssistState, lang: Lang = 'en'): string | undefined {
  return state === 'on' ? undefined : pick(ASSIST_COPY[state], lang);
}
