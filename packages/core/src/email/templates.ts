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

/**
 * `rows` is the receipt's detail block — label/value pairs rendered as a small
 * table between the body and the button.
 *
 * It takes PLAIN TEXT and escapes both halves here rather than accepting markup
 * from the caller, which is the rule this file already states for `notice`: a
 * plan name comes from the Stripe catalog, and the catalog is edited by a person
 * in a form. Nothing reaches this template literal unchecked.
 */
function shell(appName: string, heading: string, body: string, cta: { label: string; url: string }, footer: string, linkLine: string, notice?: string, rows?: [string, string][]): string {
  // Between the body and the button, so it is read on the way to the report
  // rather than under it. Tinted and ruled, because the whole point is that it
  // must not be skimmed past.
  const noticeBlock = notice
    ? `<p style="font-size:14px;line-height:1.6;color:${INK};margin:0 0 22px;padding:12px 14px;background:#fdf6ee;border-left:3px solid ${ACCENT};border-radius:4px;">${notice}</p>`
    : '';
  const rowsBlock = rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #ece7dc;border-radius:6px;background:#fbf8f3;">${rows
        .map(([label, value], i) => `<tr><td style="padding:11px 14px;font-size:13.5px;color:${MUTED};${i ? `border-top:1px solid #ece7dc;` : ''}">${escHtml(label)}</td><td align="right" style="padding:11px 14px;font-size:13.5px;font-weight:700;color:${INK};${i ? `border-top:1px solid #ece7dc;` : ''}">${escHtml(value)}</td></tr>`)
        .join('')}</table>`
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
        ${rowsBlock}
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

// --- Report started ----------------------------------------------------------

/**
 * The mail that goes out when a dossier is QUEUED, not when it finishes.
 *
 * A comprehensive run takes about twenty minutes, and until now the only message
 * about it arrived at the end — so the buyer's whole model of the wait was a
 * progress line they had to sit in front of. This one exists to put a thread in
 * their inbox from the beginning, with a link back into the job, so closing the
 * tab costs them nothing.
 *
 * It deliberately names NO duration. The three measured comprehensive runs were
 * 18, 20 and 17 minutes, but `essential` is a different job and nothing in the
 * template declares an estimate — a number here would be a promise invented at
 * the one moment we cannot check it.
 *
 * There is no report title either: `job.title` is written by `headline` inside
 * the engine, which has not run yet when this is sent.
 */
const STARTED_SUBJECT: Copy = {
  en: 'We’re building your {app} dossier',
  es: 'Estamos generando tu dossier de {app}',
  fr: 'Nous préparons votre dossier {app}',
  pt: 'Estamos gerando seu dossiê do {app}',
};
const STARTED_HEADING: Copy = {
  en: 'Your dossier is being generated', es: 'Tu dossier se está generando',
  fr: 'Votre dossier est en cours de génération', pt: 'Seu dossiê está sendo gerado',
};
const STARTED_BODY: Copy = {
  en: 'Our research agents are at work. You can close this and relax — we’ll email you the moment it’s ready, and this link brings you back to it at any time.',
  es: 'Nuestros agentes de investigación ya están trabajando. Puedes cerrar todo y estar tranquilo: te avisamos por correo apenas esté listo, y este enlace te trae de vuelta cuando quieras.',
  fr: 'Nos agents de recherche sont au travail. Vous pouvez tout fermer l’esprit tranquille : nous vous préviendrons par e-mail dès que ce sera prêt, et ce lien vous y ramène à tout moment.',
  pt: 'Nossos agentes de pesquisa já estão trabalhando. Você pode fechar tudo e ficar tranquilo: avisamos por e-mail assim que estiver pronto, e este link traz você de volta a qualquer momento.',
};
const STARTED_CTA: Copy = {
  en: 'Follow the progress', es: 'Seguir el progreso',
  fr: 'Suivre la progression', pt: 'Acompanhar o progresso',
};
/**
 * What this footer must NOT say, and did for one release.
 *
 * It read "if something goes wrong we return your credits, and you'll hear about
 * it here" — and BOTH halves were false. The only job mail in the system fires on
 * completion (`worker/src/index.ts`, guarded by `result.status === 'completed'`);
 * a `failed` or `held` job sends nothing, and an admin resolving a hold writes an
 * in-app note, not an email. And refunds are not automatic by design —
 * `run-job.ts`: "a job that could not be assembled does NOT fail and does NOT
 * refund", `credits/store.ts`: "every refund in this system is a decision a person
 * made".
 *
 * So a buyer whose job held or failed did exactly what this mail told them —
 * closed everything — and then waited for a message that was never coming, about
 * credits that were never automatically returned. The mail whose entire purpose is
 * to make walking away safe was the thing that made it unsafe.
 *
 * The rule this leaves behind: **this footer may only describe mail that a code
 * path actually sends.** It now promises the ready mail, and points at the page
 * for everything else — which is where the outcome of a hold really is written.
 */
const STARTED_FOOTER: Copy = {
  en: 'You don’t need to keep any page open — we write when the dossier is ready. Anything else that happens to it is explained on its own page, and the link above is how you get back there.',
  es: 'No necesitas dejar ninguna página abierta: te escribimos cuando el dossier esté listo. Cualquier otra cosa que le pase queda explicada en su propia página, y el enlace de arriba es cómo volver.',
  fr: 'Vous n’avez besoin de laisser aucune page ouverte — nous écrivons quand le dossier est prêt. Tout autre événement le concernant est expliqué sur sa propre page, et le lien ci-dessus vous y ramène.',
  pt: 'Você não precisa deixar nenhuma página aberta — escrevemos quando o dossiê estiver pronto. Qualquer outra coisa que aconteça com ele fica explicada na página dele, e o link acima é como voltar lá.',
};
const STARTED_TEXT: Copy = {
  en: 'We’re building your {app} dossier\n\nOur research agents are at work. You can close everything — we’ll email you the moment it’s ready.\n\nFollow the progress: {url}',
  es: 'Estamos generando tu dossier de {app}\n\nNuestros agentes de investigación ya están trabajando. Puedes cerrar todo: te avisamos por correo apenas esté listo.\n\nSeguir el progreso: {url}',
  fr: 'Nous préparons votre dossier {app}\n\nNos agents de recherche sont au travail. Vous pouvez tout fermer : nous vous préviendrons par e-mail dès que ce sera prêt.\n\nSuivre la progression : {url}',
  pt: 'Estamos gerando seu dossiê do {app}\n\nNossos agentes de pesquisa já estão trabalhando. Você pode fechar tudo: avisamos por e-mail assim que estiver pronto.\n\nAcompanhar o progresso: {url}',
};

export function reportStartedTemplate(appName: string, url: string, lang?: unknown): AccountEmail {
  const v = { app: appName, url };
  return {
    subject: t(STARTED_SUBJECT, lang, v),
    html: shell(appName, t(STARTED_HEADING, lang, v), t(STARTED_BODY, lang, v),
      { label: t(STARTED_CTA, lang, v), url }, t(STARTED_FOOTER, lang, v), t(LINK_LINE, lang)),
    text: t(STARTED_TEXT, lang, v),
  };
}

// --- Credits purchased (the receipt) -----------------------------------------

/**
 * The receipt for a credit purchase.
 *
 * It names the CREDITS, not the charge: what was bought, how many credits, and
 * the balance the buyer now has. Stripe can send its own receipt and it says
 * neither of the last two — a dollar amount is what the card statement already
 * shows, and the balance is the thing the buyer opens the app to check. Only one
 * of the two is sent (Javier, 2026-08-24); sending both is the option that is
 * clearly wrong.
 *
 * `amountUsd` / `currency` are optional because the ledger's authority is the
 * CREDIT count — a session that somehow carried no total still produces an honest
 * receipt, one line shorter, rather than one reading "$0.00".
 */
const RECEIPT_SUBJECT: Copy = {
  en: '{app} receipt — {credits} credits added',
  es: 'Comprobante de {app}: {credits} créditos añadidos',
  fr: 'Reçu {app} — {credits} crédits ajoutés',
  pt: 'Comprovante do {app} — {credits} créditos adicionados',
};
const RECEIPT_HEADING: Copy = {
  en: 'Your credits are in', es: 'Tus créditos ya están',
  fr: 'Vos crédits sont crédités', pt: 'Seus créditos já entraram',
};
const RECEIPT_BODY: Copy = {
  en: 'Thank you. Your payment went through and the credits are already on your account — you can start a dossier right away.',
  es: 'Gracias. Tu pago se procesó y los créditos ya están en tu cuenta: puedes empezar un dossier ahora mismo.',
  fr: 'Merci. Votre paiement a été accepté et les crédits sont déjà sur votre compte : vous pouvez lancer un dossier dès maintenant.',
  pt: 'Obrigado. Seu pagamento foi processado e os créditos já estão na sua conta: você pode começar um dossiê agora mesmo.',
};
const RECEIPT_CTA: Copy = {
  en: 'View my credits', es: 'Ver mis créditos',
  fr: 'Voir mes crédits', pt: 'Ver meus créditos',
};
const RECEIPT_FOOTER: Copy = {
  en: 'Keep this email as your receipt. Credits do not expire. If anything looks wrong, reply to this message and we will sort it out.',
  es: 'Guarda este correo como comprobante. Los créditos no caducan. Si algo no cuadra, responde a este mensaje y lo resolvemos.',
  fr: 'Conservez cet e-mail comme reçu. Les crédits n’expirent pas. Si quelque chose ne va pas, répondez à ce message et nous le réglerons.',
  pt: 'Guarde este e-mail como comprovante. Os créditos não expiram. Se algo estiver errado, responda a esta mensagem e resolvemos.',
};
const RECEIPT_ROW_PACK: Copy = { en: 'Pack', es: 'Pack', fr: 'Pack', pt: 'Pacote' };
const RECEIPT_ROW_CREDITS: Copy = { en: 'Credits added', es: 'Créditos añadidos', fr: 'Crédits ajoutés', pt: 'Créditos adicionados' };
const RECEIPT_ROW_PAID: Copy = { en: 'Paid', es: 'Pagado', fr: 'Payé', pt: 'Pago' };
const RECEIPT_ROW_BALANCE: Copy = { en: 'New balance', es: 'Saldo nuevo', fr: 'Nouveau solde', pt: 'Novo saldo' };
const RECEIPT_TEXT: Copy = {
  en: '{app} receipt\n\nYour payment went through and {credits} credits are on your account.\n\nNew balance: {balance} credits\n\nView your credits: {url}',
  es: 'Comprobante de {app}\n\nTu pago se procesó y {credits} créditos ya están en tu cuenta.\n\nSaldo nuevo: {balance} créditos\n\nVer tus créditos: {url}',
  fr: 'Reçu {app}\n\nVotre paiement a été accepté et {credits} crédits sont sur votre compte.\n\nNouveau solde : {balance} crédits\n\nVoir vos crédits : {url}',
  pt: 'Comprovante do {app}\n\nSeu pagamento foi processado e {credits} créditos estão na sua conta.\n\nNovo saldo: {balance} créditos\n\nVer seus créditos: {url}',
};

/** `usd` from a Stripe session is lowercase and `Intl` wants an ISO code. */
function money(amount: number, currency: string, lang: unknown): string {
  const code = (currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat(asLang(lang), { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export interface PurchaseReceipt {
  credits: number;
  /** The balance AFTER the grant — `recordPurchase` returns it from the same transaction. */
  balance: number;
  planName?: string;
  amount?: number;
  currency?: string;
}

export function creditsPurchasedTemplate(appName: string, receipt: PurchaseReceipt, url: string, lang?: unknown): AccountEmail {
  const credits = String(receipt.credits);
  const balance = String(receipt.balance);
  const v = { app: appName, url, credits, balance };
  const rows: [string, string][] = [];
  if (receipt.planName?.trim()) rows.push([t(RECEIPT_ROW_PACK, lang), receipt.planName.trim()]);
  rows.push([t(RECEIPT_ROW_CREDITS, lang), `+${credits}`]);
  if (receipt.amount != null && receipt.amount > 0) rows.push([t(RECEIPT_ROW_PAID, lang), money(receipt.amount, receipt.currency ?? 'usd', lang)]);
  rows.push([t(RECEIPT_ROW_BALANCE, lang), balance]);
  return {
    subject: t(RECEIPT_SUBJECT, lang, v),
    html: shell(appName, t(RECEIPT_HEADING, lang, v), t(RECEIPT_BODY, lang, v),
      { label: t(RECEIPT_CTA, lang, v), url }, t(RECEIPT_FOOTER, lang, v), t(LINK_LINE, lang), undefined, rows),
    text: t(RECEIPT_TEXT, lang, v),
  };
}
