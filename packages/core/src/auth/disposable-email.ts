/**
 * Disposable / temporary email blocklist for password registration. These providers
 * hand out throwaway inboxes on the fly (or forward to fake mailboxes), which lets one
 * person spin up unlimited "verified" accounts and burn credits/tokens. We reject them
 * at register time with a clear, simple message.
 *
 * This is a curated list of the most common providers — it's not exhaustive (thousands
 * of rotating domains exist), just the high-traffic ones. Matching is suffix-based, so
 * any subdomain of a listed domain (e.g. `abc.mailinator.com`) is also blocked. Add
 * more domains here as they show up in abuse.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Mailinator & public-inbox style
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'reallymymail.com',
  // Guerrilla Mail family
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'guerrillamail.de', 'pokemail.net', 'spam.me',
  // 10 Minute Mail / timed inboxes
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '10minemail.com',
  // Temp-Mail family
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmailo.com', 'tempmail.plus',
  'tempr.email', 'tmpmail.org', 'tmpmail.net', 'mytemp.email', 'temp-mail.ru',
  // Yopmail
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf',
  // Throwaway / trash / discard
  'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'wegwerfmail.de',
  'discard.email', 'discardmail.com', 'dispostable.com', 'getairmail.com',
  // Nada / Maildrop / others
  'getnada.com', 'nada.email', 'maildrop.cc', 'mailnesia.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'fakeinbox.com', 'fakemailgenerator.com', 'fake-email.com',
  'tempinbox.com', 'inboxkitten.com', 'moakt.com', 'mailcatch.com', 'spambox.us',
  'spamgourmet.com', 'burnermail.io', 'einrot.com', 'luxusmail.org', 'mailsac.com',
  'mail-temp.com', 'anonaddy.me', 'tmail.io', 'linshiyou.com', 'maileater.com',
  '33mail.com', 'yepmail.us', 'mailhole.de', 'harakirimail.com', 'emltmp.com',
]);

/**
 * True when the email's domain (or a parent domain) is a known disposable provider.
 * Expects an email that already has an `@`; matches by walking the domain suffixes so
 * subdomains of a blocked provider are caught too.
 */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const labels = email.slice(at + 1).trim().toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
