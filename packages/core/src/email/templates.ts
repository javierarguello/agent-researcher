/**
 * Minimal, self-contained HTML for account emails. Inline styles only (email
 * clients strip <style>). Branded with the app name; the accent is generic so any
 * app looks reasonable without per-app theming.
 *
 * Every string here is localized. It was all English until 2026-08-03, which meant
 * a buyer who signed up entirely in Spanish hit English at the MANDATORY step —
 * "Verify your email" — before any money changed hands. The report-ready one was
 * worse than plainly English: `job.title` is generated in the report's language, so
 * it read "Your report is ready — Recherche d'entreprises à vendre à Miami", half
 * and half, with the whole job in hand and `params.language` never read.
 */
import { asLang, type Lang } from '../moderation/copy.js';

type Copy = Record<Lang, string>;

interface AccountEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = '#e65100';
const INK = '#2a2824';
const MUTED = '#6b6860';

/** Pick a language's string and substitute `{app}` / `{title}`. */
function t(copy: Copy, lang: unknown, vars: Record<string, string> = {}): string {
  const l = asLang(lang);
  let out = (copy as Record<string, string>)[l] ?? copy.en;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** The three characters that are markup in an HTML body — escaped, so the text survives whole. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shell(appName: string, heading: string, body: string, cta: { label: string; url: string }, footer: string, linkLine: string, notice?: string): string {
  // Between the body and the button, so it is read on the way to the report
  // rather than under it. Tinted and ruled, because the whole point is that it
  // must not be skimmed past.
  const noticeBlock = notice
    ? `<p style="font-size:14px;line-height:1.6;color:${INK};margin:0 0 22px;padding:12px 14px;background:#fdf6ee;border-left:3px solid ${ACCENT};border-radius:4px;">${notice}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f0e8;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5dfd4;border-radius:10px;overflow:hidden;">
      <tr><td style="height:6px;background:${ACCENT};"></td></tr>
      <tr><td style="padding:32px 36px 8px;">
        <div style="font-weight:800;font-size:17px;letter-spacing:-0.02em;color:${INK};">${appName}</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0;">
        <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${INK};margin:12px 0 14px;">${heading}</h1>
        <p style="font-size:15px;line-height:1.6;color:${INK};margin:0 0 22px;">${body}</p>
        ${noticeBlock}
        <a href="${cta.url}" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.04em;padding:13px 22px;border-radius:6px;">${cta.label}</a>
        <p style="font-size:12.5px;line-height:1.6;color:${MUTED};margin:24px 0 0;">${linkLine}<br><a href="${cta.url}" style="color:${ACCENT};word-break:break-all;">${cta.url}</a></p>
      </td></tr>
      <tr><td style="padding:24px 36px 30px;">
        <p style="font-size:11.5px;line-height:1.55;color:${MUTED};margin:16px 0 0;border-top:1px solid #ece7dc;padding-top:16px;">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const LINK_LINE: Copy = {
  en: 'Or paste this link into your browser:',
  es: 'O pega este enlace en tu navegador:',
  fr: 'Ou collez ce lien dans votre navigateur :',
  pt: 'Ou cole este link no seu navegador:',
};

// --- Verify email ------------------------------------------------------------

const VERIFY_SUBJECT: Copy = {
  en: 'Verify your email for {app}',
  es: 'Verifica tu correo para {app}',
  fr: 'Vérifiez votre adresse e-mail pour {app}',
  pt: 'Verifique seu e-mail para {app}',
};
const VERIFY_HEADING: Copy = {
  en: 'Confirm your email',
  es: 'Confirma tu correo',
  fr: 'Confirmez votre adresse e-mail',
  pt: 'Confirme seu e-mail',
};
const VERIFY_BODY: Copy = {
  en: 'Welcome to {app}. Confirm this email address to activate your account and sign in.',
  es: 'Te damos la bienvenida a {app}. Confirma esta dirección de correo para activar tu cuenta e iniciar sesión.',
  fr: 'Bienvenue sur {app}. Confirmez cette adresse e-mail pour activer votre compte et vous connecter.',
  pt: 'Boas-vindas a {app}. Confirme este endereço de e-mail para ativar sua conta e entrar.',
};
const VERIFY_CTA: Copy = {
  en: 'Verify email', es: 'Verificar correo', fr: 'Vérifier l’adresse', pt: 'Verificar e-mail',
};
const VERIFY_FOOTER: Copy = {
  en: 'If you didn’t create a {app} account, you can safely ignore this email. This link expires in 24 hours.',
  es: 'Si no creaste una cuenta en {app}, puedes ignorar este correo sin problema. Este enlace caduca en 24 horas.',
  fr: 'Si vous n’avez pas créé de compte {app}, vous pouvez ignorer cet e-mail. Ce lien expire dans 24 heures.',
  pt: 'Se você não criou uma conta em {app}, pode ignorar este e-mail. Este link expira em 24 horas.',
};
const VERIFY_TEXT: Copy = {
  en: 'Confirm your email for {app}\n\nVerify this address to activate your account: {url}\n\nThis link expires in 24 hours. If you didn’t create an account, ignore this email.',
  es: 'Confirma tu correo para {app}\n\nVerifica esta dirección para activar tu cuenta: {url}\n\nEste enlace caduca en 24 horas. Si no creaste una cuenta, ignora este correo.',
  fr: 'Confirmez votre adresse e-mail pour {app}\n\nVérifiez cette adresse pour activer votre compte : {url}\n\nCe lien expire dans 24 heures. Si vous n’avez pas créé de compte, ignorez cet e-mail.',
  pt: 'Confirme seu e-mail para {app}\n\nVerifique este endereço para ativar sua conta: {url}\n\nEste link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.',
};

export function verifyEmailTemplate(appName: string, url: string, lang?: unknown): AccountEmail {
  const v = { app: appName, url };
  return {
    subject: t(VERIFY_SUBJECT, lang, v),
    html: shell(appName, t(VERIFY_HEADING, lang, v), t(VERIFY_BODY, lang, v),
      { label: t(VERIFY_CTA, lang, v), url }, t(VERIFY_FOOTER, lang, v), t(LINK_LINE, lang)),
    text: t(VERIFY_TEXT, lang, v),
  };
}

// --- Report ready ------------------------------------------------------------

const READY_SUBJECT: Copy = {
  en: 'Your {app} report is ready — {title}',
  es: 'Tu informe de {app} está listo — {title}',
  fr: 'Votre rapport {app} est prêt — {title}',
  pt: 'Seu relatório do {app} está pronto — {title}',
};
const READY_HEADING: Copy = {
  en: 'Your report is ready', es: 'Tu informe está listo',
  fr: 'Votre rapport est prêt', pt: 'Seu relatório está pronto',
};
const READY_BODY: Copy = {
  en: 'Your research summary <strong>{title}</strong> has finished generating and is ready to view.',
  es: 'Tu investigación <strong>{title}</strong> terminó de generarse y ya puedes verla.',
  fr: 'Votre recherche <strong>{title}</strong> a fini d’être générée et peut être consultée.',
  pt: 'Sua pesquisa <strong>{title}</strong> terminou de ser gerada e já pode ser vista.',
};
const READY_CTA: Copy = {
  en: 'View report', es: 'Ver informe', fr: 'Voir le rapport', pt: 'Ver relatório',
};
const READY_FOOTER: Copy = {
  en: 'AI-generated research for informational purposes. Always refer to the original listings and verify figures independently before acting.',
  es: 'Investigación generada por IA con fines informativos. Consulta siempre los anuncios originales y verifica las cifras por tu cuenta antes de actuar.',
  fr: 'Recherche générée par IA à titre informatif. Reportez-vous toujours aux annonces d’origine et vérifiez les chiffres par vous-même avant d’agir.',
  pt: 'Pesquisa gerada por IA para fins informativos. Consulte sempre os anúncios originais e verifique os números por conta própria antes de agir.',
};
const READY_TITLE_FALLBACK: Copy = {
  en: 'Your research summary', es: 'Tu investigación',
  fr: 'Votre recherche', pt: 'Sua pesquisa',
};
// Split from the disclaimer below so the incomplete-report notice can sit between
// them. It is the one sentence that changes what the reader does next, and after
// the legal footer is where nobody looks.
const READY_TEXT: Copy = {
  en: 'Your {app} report is ready\n\n{title} has finished generating. View it: {url}',
  es: 'Tu informe de {app} está listo\n\n{title} terminó de generarse. Verlo: {url}',
  fr: 'Votre rapport {app} est prêt\n\n{title} a fini d’être généré. Le consulter : {url}',
  pt: 'Seu relatório do {app} está pronto\n\n{title} terminou de ser gerado. Ver: {url}',
};
const READY_TEXT_FOOT: Copy = {
  en: 'AI-generated research — verify independently before acting.',
  es: 'Investigación generada por IA: verifica por tu cuenta antes de actuar.',
  fr: 'Recherche générée par IA — vérifiez par vous-même avant d’agir.',
  pt: 'Pesquisa gerada por IA — verifique por conta própria antes de agir.',
};

/**
 * `notice` is the incomplete-report line — `sectionsNotice`, already written in
 * the buyer's language by the caller, the same string the web viewer, the shared
 * page and the PDF cover carry.
 *
 * It is passed in rather than computed here for one reason: there must be exactly
 * one sentence describing a partial delivery, and it must be the one the buyer
 * has already been shown. Rebuilding it in the mail is how two surfaces end up
 * disagreeing about the same report.
 *
 * Without it this mail announced every report as finished. It is often the only
 * thing read before the PDF is opened, so a dossier with a section missing
 * arrived described as complete — by us, in writing.
 */
export function reportReadyTemplate(appName: string, reportTitle: string, url: string, lang?: unknown, notice?: string): AccountEmail {
  // The title itself is written by `headline` in the REPORT's language, which is
  // why the shell around it has to match — an English frame around a French title
  // was the most visible half-translation we shipped.
  const title = reportTitle?.trim() || t(READY_TITLE_FALLBACK, lang);
  // ESCAPED into the HTML, not stripped: "Bed & Breakfast inns for sale" is an
  // ordinary headline (it is written by the model from the buyer's own industry
  // text), and stripping the `&` sent "Bed  Breakfast" in the body under a subject
  // that still said "Bed & Breakfast". The subject and the text part take the
  // title raw — there is no markup there to protect.
  const v = { app: appName, url, title: escHtml(title) };
  // The notice is our own copy, but it lands in a raw template literal, and the
  // rule in this file is that nothing reaches the markup unchecked.
  const note = notice?.trim() ? escHtml(notice.trim()) : undefined;
  return {
    subject: t(READY_SUBJECT, lang, { ...v, title }),
    html: shell(appName, t(READY_HEADING, lang, v), t(READY_BODY, lang, v),
      { label: t(READY_CTA, lang, v), url }, t(READY_FOOTER, lang, v), t(LINK_LINE, lang), note),
    text: [t(READY_TEXT, lang, { ...v, title }), notice?.trim() || undefined, t(READY_TEXT_FOOT, lang)].filter(Boolean).join('\n\n'),
  };
}

// --- Password reset ----------------------------------------------------------

const RESET_SUBJECT: Copy = {
  en: 'Reset your {app} password',
  es: 'Restablece tu contraseña de {app}',
  fr: 'Réinitialisez votre mot de passe {app}',
  pt: 'Redefina sua senha do {app}',
};
const RESET_HEADING: Copy = {
  en: 'Reset your password', es: 'Restablece tu contraseña',
  fr: 'Réinitialisez votre mot de passe', pt: 'Redefina sua senha',
};
const RESET_BODY: Copy = {
  en: 'We received a request to reset the password for your {app} account. Choose a new password to continue.',
  es: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de {app}. Elige una nueva contraseña para continuar.',
  fr: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte {app}. Choisissez un nouveau mot de passe pour continuer.',
  pt: 'Recebemos um pedido para redefinir a senha da sua conta do {app}. Escolha uma nova senha para continuar.',
};
const RESET_CTA: Copy = {
  en: 'Reset password', es: 'Restablecer contraseña',
  fr: 'Réinitialiser le mot de passe', pt: 'Redefinir senha',
};
const RESET_FOOTER: Copy = {
  en: 'If you didn’t request this, you can safely ignore this email — your password won’t change. This link expires in 1 hour.',
  es: 'Si no lo solicitaste, puedes ignorar este correo: tu contraseña no cambiará. Este enlace caduca en 1 hora.',
  fr: 'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail — votre mot de passe ne changera pas. Ce lien expire dans 1 heure.',
  pt: 'Se você não solicitou isso, pode ignorar este e-mail — sua senha não será alterada. Este link expira em 1 hora.',
};
const RESET_TEXT: Copy = {
  en: 'Reset your {app} password\n\nChoose a new password: {url}\n\nThis link expires in 1 hour. If you didn’t request this, ignore this email.',
  es: 'Restablece tu contraseña de {app}\n\nElige una nueva contraseña: {url}\n\nEste enlace caduca en 1 hora. Si no lo solicitaste, ignora este correo.',
  fr: 'Réinitialisez votre mot de passe {app}\n\nChoisissez un nouveau mot de passe : {url}\n\nCe lien expire dans 1 heure. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.',
  pt: 'Redefina sua senha do {app}\n\nEscolha uma nova senha: {url}\n\nEste link expira em 1 hora. Se você não solicitou isso, ignore este e-mail.',
};

export function resetPasswordTemplate(appName: string, url: string, lang?: unknown): AccountEmail {
  const v = { app: appName, url };
  return {
    subject: t(RESET_SUBJECT, lang, v),
    html: shell(appName, t(RESET_HEADING, lang, v), t(RESET_BODY, lang, v),
      { label: t(RESET_CTA, lang, v), url }, t(RESET_FOOTER, lang, v), t(LINK_LINE, lang)),
    text: t(RESET_TEXT, lang, v),
  };
}
