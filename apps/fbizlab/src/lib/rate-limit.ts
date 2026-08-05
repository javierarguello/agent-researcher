/**
 * What a buyer reads when the API answers 429.
 *
 * Six pages surfaced `err.message` straight from the body. That string is written
 * for whoever reads the logs — "Too many requests. Please wait a moment and try
 * again." — in English, to Spanish, French and Portuguese customers, on the
 * sign-in form, the sign-up form, the forgot-password form, the reset page, the
 * contact form and the credits page. Two of them were fixed in place; this is the
 * rest, in one module rather than six copies of the same paragraph.
 *
 * One table instead of a per-page one on purpose: the sentence is identical
 * everywhere, and the part that is easy to get wrong — turning
 * `retryAfterSeconds` into something a person can act on — is arithmetic nobody
 * should write twice. What IS page-specific (a link that is still valid, credits
 * that were not spent) comes in as an option.
 *
 * The wait is honest or it is not stated. The hourly buckets are CALENDAR hours,
 * so the API sends the seconds actually remaining; telling someone to come back
 * in an hour when it is ninety seconds is the failure this replaced, and
 * inventing a figure when the body carries none is the same failure with extra
 * steps.
 */
import { pick, type Lang } from '../i18n';

type Copy = Record<Lang, string>;

const TOO_MANY: Copy = {
  en: 'Too many requests just now.',
  es: 'Demasiadas solicitudes ahora mismo.',
  fr: 'Trop de requêtes en ce moment.',
  pt: 'Muitas solicitações agora.',
};

/** Only ever said where it is true — see `nothingCharged`. */
const NOTHING_CHARGED: Copy = {
  en: 'Nothing was charged.',
  es: 'No se te cobró nada.',
  fr: 'Rien ne vous a été facturé.',
  pt: 'Nada foi cobrado.',
};

/** The API sent no figure. Vague, and deliberately so. */
const TRY_SOON: Copy = {
  en: 'Try again in a moment.',
  es: 'Inténtalo de nuevo en un momento.',
  fr: 'Réessayez dans un instant.',
  pt: 'Tente novamente em instantes.',
};
const TRY_MINUTE: Copy = {
  en: 'Try again in about a minute.',
  es: 'Inténtalo de nuevo en un minuto, aproximadamente.',
  fr: 'Réessayez dans une minute environ.',
  pt: 'Tente novamente em cerca de um minuto.',
};
const TRY_MINUTES: Copy = {
  en: 'Try again in about {n} minutes.',
  es: 'Inténtalo de nuevo en unos {n} minutos.',
  fr: 'Réessayez dans environ {n} minutes.',
  pt: 'Tente novamente em cerca de {n} minutos.',
};
const TRY_HOUR: Copy = {
  en: 'Try again in about an hour.',
  es: 'Inténtalo de nuevo en aproximadamente una hora.',
  fr: 'Réessayez dans environ une heure.',
  pt: 'Tente novamente em cerca de uma hora.',
};

/** A 429, however the caller happens to hold it. */
export function isRateLimited(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null | undefined;
  return !!e && (e.status === 429 || e.code === 'rate_limited');
}

/** The "come back when" sentence, rounded the way a person would say it. */
function tryAgain(seconds: number | undefined, lang: Lang): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return pick(TRY_SOON, lang);
  if (seconds <= 90) return pick(TRY_MINUTE, lang);
  const minutes = Math.ceil(seconds / 60);
  // Rounded up, so we never send someone back too early — but "in about 60
  // minutes" is a thing no one says, and at that point an hour is both truer and
  // shorter.
  if (minutes >= 55) return pick(TRY_HOUR, lang);
  return pick(TRY_MINUTES, lang).replace('{n}', String(minutes));
}

interface Options {
  /**
   * Add "Nothing was charged." — pass it only where money could plausibly have
   * moved and did not (the credits page). On a sign-in form it answers a question
   * nobody asked and invites the one they had not thought of.
   */
  nothingCharged?: boolean;
  /** A page-specific sentence, placed before the wait — e.g. "your link is still valid". */
  also?: string;
}

export function rateLimitMessage(err: unknown, lang: Lang, opts: Options = {}): string {
  const retryAfterSeconds = (err as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
  return [
    pick(TOO_MANY, lang),
    opts.also,
    opts.nothingCharged ? pick(NOTHING_CHARGED, lang) : undefined,
    tryAgain(retryAfterSeconds, lang),
  ]
    .filter(Boolean)
    .join(' ');
}
