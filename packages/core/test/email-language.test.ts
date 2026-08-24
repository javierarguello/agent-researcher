/**
 * Every account email in the buyer's language.
 *
 * All three were English-only literals with no language parameter at all, which
 * put English at the MANDATORY step of every non-English signup — "Verify your
 * email" — before any money changed hands. The report-ready one was worse than
 * plainly English: `job.title` is generated in the report's language by
 * `headline`, so it read "Your report is ready — Recherche d'entreprises à vendre
 * à Miami". The whole job was in hand and `params.language` was never read.
 */
import { describe, it, expect } from 'vitest';
import { verifyEmailTemplate, reportReadyTemplate, resetPasswordTemplate, reportStartedTemplate, creditsPurchasedTemplate } from '../src/email/templates.js';

const LANGS = ['en', 'es', 'fr', 'pt'] as const;

describe('account emails speak the buyer’s language', () => {
  it('sends a different subject, heading and body in each', () => {
    // Asserted across all four rather than spot-checking one: the defect was a
    // missing parameter, so any single language would have looked fine.
    for (const build of [
      () => LANGS.map((l) => verifyEmailTemplate('Florida Biz Labs', 'https://x/y', l)),
      () => LANGS.map((l) => resetPasswordTemplate('Florida Biz Labs', 'https://x/y', l)),
      () => LANGS.map((l) => reportReadyTemplate('Florida Biz Labs', 'Un titre', 'https://x/y', l)),
      () => LANGS.map((l) => reportStartedTemplate('Florida Biz Labs', 'https://x/y', l)),
      () => LANGS.map((l) => creditsPurchasedTemplate('Florida Biz Labs', { credits: 15, balance: 22 }, 'https://x/y', l)),
    ]) {
      const mails = build();
      expect(new Set(mails.map((m) => m.subject)).size).toBe(4);
      expect(new Set(mails.map((m) => m.text)).size).toBe(4);
      expect(new Set(mails.map((m) => m.html)).size).toBe(4);
    }
  });

  it('leaves no English in a translated mail', () => {
    // The half-translated case is the one that reads like a bug in what someone
    // paid for, and a `Copy` dict makes it easy to translate the subject and forget
    // the button or the footer.
    const es = verifyEmailTemplate('Florida Biz Labs', 'https://x/y', 'es');
    expect(es.subject).toMatch(/verifica/i);
    expect(es.html).toMatch(/Confirma tu correo/);
    expect(es.html).toMatch(/Verificar correo/); // the button
    expect(es.html).toMatch(/caduca en 24 horas/); // the footer
    expect(es.html).toMatch(/pega este enlace/); // the fallback link line
    expect(es.html).not.toMatch(/Verify email|expires in 24 hours|paste this link/i);
  });

  it('wraps a report title in the same language it was written in', () => {
    const fr = reportReadyTemplate('Florida Biz Labs', 'Recherche d’entreprises à vendre à Miami', 'https://x/y', 'fr');
    expect(fr.subject).toContain('Recherche d’entreprises');
    expect(fr.subject).not.toMatch(/is ready/i);
    expect(fr.html).toMatch(/Votre rapport est prêt/);
  });

  it('is really translated in each language, not merely different', () => {
    // The distinctness check above passes for four DIFFERENT wrong strings —
    // `TODO-fr-1`, or the English button left in the French mail. Anchored on words
    // a speaker of each language would notice missing, on the surfaces a buyer
    // reads first: the subject, the button, and the expiry line.
    const anchors: Record<string, RegExp[]> = {
      es: [/Verifica tu correo/, /Verificar correo/, /caduca en 24 horas/],
      fr: [/Vérifiez votre adresse/, /Vérifier l’adresse/, /expire dans 24 heures/],
      pt: [/Verifique seu e-mail/, /Verificar e-mail/, /expira em 24 horas/],
    };
    for (const [lang, res] of Object.entries(anchors)) {
      const m = verifyEmailTemplate('Florida Biz Labs', 'https://x/y', lang);
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      for (const re of res) expect(all, `${lang} is missing ${re}`).toMatch(re);
      // …and no English left behind on the button or the expiry.
      expect(all, lang).not.toMatch(/Verify email|expires in 24 hours/);
    }
  });

  it('falls back to English for a language we do not have', () => {
    // The control, and the safe direction: an unknown code must not produce an
    // empty subject or `undefined` in the body.
    const de = verifyEmailTemplate('Florida Biz Labs', 'https://x/y', 'de');
    expect(de.subject).toBe(verifyEmailTemplate('Florida Biz Labs', 'https://x/y', 'en').subject);
    expect(de.html).not.toContain('undefined');
  });

  it('still names the app and the link everywhere', () => {
    // Substitution is per-language, so a missing {app} or {url} in one translation
    // ships a mail with a literal placeholder in it.
    for (const l of LANGS) {
      for (const m of [
        verifyEmailTemplate('Florida Biz Labs', 'https://x/y', l),
        resetPasswordTemplate('Florida Biz Labs', 'https://x/y', l),
        reportReadyTemplate('Florida Biz Labs', 'T', 'https://x/y', l),
        reportStartedTemplate('Florida Biz Labs', 'https://x/y', l),
        creditsPurchasedTemplate('Florida Biz Labs', { credits: 15, balance: 22 }, 'https://x/y', l),
      ]) {
        expect(m.subject + m.html + m.text, l).not.toMatch(/\{app\}|\{url\}|\{title\}|\{credits\}|\{balance\}/);
        expect(m.html, l).toContain('https://x/y');
      }
    }
  });
});

/**
 * The two mails added for P-10 and P-11 (Javier, 2026-08-24): "we started your
 * dossier, you can close the tab", and the receipt for the credits.
 */
describe('the dossier start mail', () => {
  it('tells the reader they can walk away, in every language', () => {
    // This mail exists for exactly one sentence. The distinctness check above is
    // satisfied by four different strings that all forget to say it.
    const anchors: Record<string, RegExp> = {
      en: /close (this|everything)/i,
      es: /cerrar todo/i,
      fr: /tout fermer/i,
      pt: /fechar tudo/i,
    };
    for (const [lang, re] of Object.entries(anchors)) {
      const m = reportStartedTemplate('Florida Biz Labs', 'https://x/y', lang);
      expect(`${m.html}\n${m.text}`, lang).toMatch(re);
    }
  });

  it('promises no duration, in any language', () => {
    // The three measured comprehensive runs were 18, 20 and 17 minutes — but
    // `essential` is a different job and no template declares an estimate. A
    // number here is a promise invented at the one moment it cannot be checked.
    for (const l of LANGS) {
      const m = reportStartedTemplate('Florida Biz Labs', 'https://x/y', l);
      expect(`${m.subject}${m.html}${m.text}`, l).not.toMatch(/\d+\s*(min|minut|hora|heure|hour)/i);
    }
  });

  it('carries the link back to the job in the body AND the text part', () => {
    // The link is what makes closing the tab free. A plain-text client that gets
    // the HTML stripped must still be able to get back.
    for (const l of LANGS) {
      const m = reportStartedTemplate('Florida Biz Labs', 'https://fbizlab.test/app/jobs/j1', l);
      expect(m.html, l).toContain('https://fbizlab.test/app/jobs/j1');
      expect(m.text, l).toContain('https://fbizlab.test/app/jobs/j1');
    }
  });
});

describe('the credit purchase receipt', () => {
  it('names the credits and the balance — the two things Stripe’s own receipt cannot', () => {
    // The whole reason this one is ours rather than Stripe's. A dollar amount is
    // what the card statement already shows.
    for (const l of LANGS) {
      const m = creditsPurchasedTemplate('Florida Biz Labs', { credits: 15, balance: 22 }, 'https://x/y', l);
      expect(m.html, l).toContain('+15');
      expect(m.html, l).toContain('22');
      expect(m.text, l).toContain('22');
      expect(m.subject, l).toContain('15');
    }
  });

  it('escapes a pack name — the catalog is edited by a person in a form', () => {
    const m = creditsPurchasedTemplate('Florida Biz Labs', { credits: 3, balance: 3, planName: '<img src=x onerror=alert(1)>' }, 'https://x/y', 'en');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;img src=x');
  });

  it('drops the amount line rather than printing $0.00 — for a MISSING total and for a zero one', () => {
    // The ledger's authority is the CREDIT count. A receipt one line shorter is
    // honest; one that tells a buyer they paid $0.00 is not.
    //
    // Both halves, and the second is the one that nearly went untested. A first
    // version of this test only passed `amount: undefined`, and the guard it was
    // written for is `> 0` — so mutating `amount != null && amount > 0` down to
    // `amount != null` measured **0 red**. Zero is not hypothetical either:
    // `/credits/checkout` sets `allow_promotion_codes: true`, and a 100%-off coupon
    // produces a real paid session with `amount_total: 0`.
    const none = creditsPurchasedTemplate('Florida Biz Labs', { credits: 3, balance: 3 }, 'https://x/y', 'en');
    const zero = creditsPurchasedTemplate('Florida Biz Labs', { credits: 3, balance: 3, amount: 0, currency: 'usd' }, 'https://x/y', 'en');
    const some = creditsPurchasedTemplate('Florida Biz Labs', { credits: 3, balance: 3, amount: 19, currency: 'usd' }, 'https://x/y', 'en');
    for (const m of [none, zero]) {
      expect(m.html).not.toMatch(/0\.00/);
      expect(m.html).not.toMatch(/>Paid</);
    }
    expect(some.html).toMatch(/\$19\.00/);
    expect(some.html).toMatch(/>Paid</); // the control: the row exists when there IS a total
  });

  it('takes a lowercase Stripe currency code without falling over', () => {
    // `session.currency` is `usd`, and `Intl` wants `USD`. The fallback must not
    // be an exception inside a webhook.
    const m = creditsPurchasedTemplate('Florida Biz Labs', { credits: 3, balance: 3, amount: 19, currency: 'eur' }, 'https://x/y', 'fr');
    expect(m.html).not.toContain('undefined');
    expect(m.html).toMatch(/19/);
  });
});
