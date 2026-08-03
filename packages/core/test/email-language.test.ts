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
import { verifyEmailTemplate, reportReadyTemplate, resetPasswordTemplate } from '../src/email/templates.js';

const LANGS = ['en', 'es', 'fr', 'pt'] as const;

describe('account emails speak the buyer’s language', () => {
  it('sends a different subject, heading and body in each', () => {
    // Asserted across all four rather than spot-checking one: the defect was a
    // missing parameter, so any single language would have looked fine.
    for (const build of [
      () => LANGS.map((l) => verifyEmailTemplate('Florida Biz Labs', 'https://x/y', l)),
      () => LANGS.map((l) => resetPasswordTemplate('Florida Biz Labs', 'https://x/y', l)),
      () => LANGS.map((l) => reportReadyTemplate('Florida Biz Labs', 'Un titre', 'https://x/y', l)),
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
      ]) {
        expect(m.subject + m.html + m.text, l).not.toMatch(/\{app\}|\{url\}|\{title\}/);
        expect(m.html, l).toContain('https://x/y');
      }
    }
  });
});
