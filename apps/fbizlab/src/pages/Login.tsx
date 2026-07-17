import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { config } from '../config';
import { initGoogleAuth, renderGoogleButton } from '../auth/google';
import { LangSwitcher } from '../components/LangSwitcher';
import { useCheckout } from '../api/hooks';
import { ApiError, PENDING_PLAN_KEY, register, requestPasswordReset } from '../api/client';

const BRAND = 'Florida Biz Labs';
const MARK = '/icons/favicon.svg';

const T = {
  en: {
    eyebrowL: 'Research digest · Florida', heroL: 'Sign in to research Florida business opportunities.',
    leadL: 'Organize listing information, compare key details and prepare the questions worth investigating.',
    statL: 'A specialized research digest — not investment advice.',
    member: 'Account access', welcome: 'Welcome back.', welcomeSub: 'Sign in to continue your research.',
    createTitle: 'Create your account.', createSub: 'Start organizing Florida opportunities in minutes.',
    forgotTitle: 'Reset your password.', forgotSub: 'We’ll email you a link to choose a new password.',
    orEmail: 'or with email', nameLabel: 'Name', namePh: 'Your name', emailLabel: 'Email', emailPh: 'you@company.com',
    passLabel: 'Password', forgot: 'Forgot?', passPh: '••••••••',
    signIn: 'Sign in', signUp: 'Create account', sendReset: 'Send reset link',
    noAccount: 'Don’t have an account?', createOne: 'Create one',
    haveAccount: 'Already have an account?', signInLink: 'Sign in', backToSignin: '← Back to sign in',
    denied: 'This account can’t sign in yet.', back: '← Back to home',
    errInvalid: 'Invalid email or password.', errUnverified: 'Please verify your email before signing in.',
    errTaken: 'An account with this email already exists. Sign in instead.',
    resend: 'Resend verification email', busy: 'Please wait…',
    verifyTitle: 'Check your email', verifySub: 'We sent a verification link to',
    verifyHint: 'Click the link to activate your account. It expires in 24 hours.',
    resetTitle: 'Check your email', resetSub: 'If an account exists for',
    resetHint: 'you’ll get a link to reset your password. It expires in 1 hour.',
    footDisc: 'AI-generated research. Not investment or legal advice. Verify all figures independently before purchasing.',
    footProduct: 'Product', footCompany: 'Company',
    footLinks: { discovery: 'Search', reports: 'AI reports', api: 'Pricing', privacy: 'Privacy', legal: 'Legal', support: 'Support' },
  },
  es: {
    eyebrowL: 'Digest de investigación · Florida', heroL: 'Ingresa para investigar oportunidades de negocio en Florida.',
    leadL: 'Organiza la información de los avisos, compara detalles clave y prepara las preguntas que vale la pena investigar.',
    statL: 'Un digest de investigación especializado — no es asesoría de inversión.',
    member: 'Acceso a la cuenta', welcome: 'Bienvenido de nuevo.', welcomeSub: 'Ingresa para continuar tu investigación.',
    createTitle: 'Crea tu cuenta.', createSub: 'Empieza a organizar oportunidades en Florida en minutos.',
    forgotTitle: 'Restablece tu contraseña.', forgotSub: 'Te enviaremos un enlace para elegir una nueva contraseña.',
    orEmail: 'o con email', nameLabel: 'Nombre', namePh: 'Tu nombre', emailLabel: 'Email', emailPh: 'tú@empresa.com',
    passLabel: 'Contraseña', forgot: '¿Olvidaste?', passPh: '••••••••',
    signIn: 'Ingresar', signUp: 'Crear cuenta', sendReset: 'Enviar enlace',
    noAccount: '¿No tienes cuenta?', createOne: 'Crea una',
    haveAccount: '¿Ya tienes cuenta?', signInLink: 'Ingresa', backToSignin: '← Volver al ingreso',
    denied: 'Esta cuenta aún no puede ingresar.', back: '← Volver al inicio',
    errInvalid: 'Email o contraseña incorrectos.', errUnverified: 'Verifica tu email antes de ingresar.',
    errTaken: 'Ya existe una cuenta con este email. Mejor ingresa.',
    resend: 'Reenviar email de verificación', busy: 'Espera…',
    verifyTitle: 'Revisa tu email', verifySub: 'Enviamos un enlace de verificación a',
    verifyHint: 'Haz clic en el enlace para activar tu cuenta. Expira en 24 horas.',
    resetTitle: 'Revisa tu email', resetSub: 'Si existe una cuenta para',
    resetHint: 'recibirás un enlace para restablecer tu contraseña. Expira en 1 hora.',
    footDisc: 'Investigación generada por IA. No es asesoría de inversión ni legal. Verifica todas las cifras de forma independiente antes de comprar.',
    footProduct: 'Producto', footCompany: 'Empresa',
    footLinks: { discovery: 'Buscar', reports: 'Reportes IA', api: 'Precios', privacy: 'Privacidad', legal: 'Legal', support: 'Soporte' },
  },
  fr: {
    eyebrowL: 'Digest de recherche · Floride', heroL: 'Connectez-vous pour rechercher des opportunités en Floride.',
    leadL: 'Organisez les informations des annonces, comparez les détails clés et préparez les questions à approfondir.',
    statL: 'Un digest de recherche spécialisé — pas un conseil en investissement.',
    member: 'Accès au compte', welcome: 'Bon retour.', welcomeSub: 'Connectez-vous pour continuer votre recherche.',
    createTitle: 'Créez votre compte.', createSub: 'Commencez à organiser des opportunités en quelques minutes.',
    forgotTitle: 'Réinitialisez votre mot de passe.', forgotSub: 'Nous vous enverrons un lien pour en choisir un nouveau.',
    orEmail: 'ou par email', nameLabel: 'Nom', namePh: 'Votre nom', emailLabel: 'Email', emailPh: 'vous@entreprise.com',
    passLabel: 'Mot de passe', forgot: 'Oublié ?', passPh: '••••••••',
    signIn: 'Se connecter', signUp: 'Créer un compte', sendReset: 'Envoyer le lien',
    noAccount: 'Pas de compte ?', createOne: 'Créez-en un',
    haveAccount: 'Déjà un compte ?', signInLink: 'Se connecter', backToSignin: '← Retour à la connexion',
    denied: 'Ce compte ne peut pas encore se connecter.', back: '← Retour à l’accueil',
    errInvalid: 'Email ou mot de passe incorrect.', errUnverified: 'Vérifiez votre email avant de vous connecter.',
    errTaken: 'Un compte existe déjà pour cet email. Connectez-vous.',
    resend: 'Renvoyer l’email de vérification', busy: 'Patientez…',
    verifyTitle: 'Vérifiez votre email', verifySub: 'Nous avons envoyé un lien de vérification à',
    verifyHint: 'Cliquez sur le lien pour activer votre compte. Il expire dans 24 heures.',
    resetTitle: 'Vérifiez votre email', resetSub: 'Si un compte existe pour',
    resetHint: 'vous recevrez un lien pour réinitialiser votre mot de passe. Il expire dans 1 heure.',
    footDisc: 'Recherche générée par IA. Pas un conseil en investissement ni juridique. Vérifiez tous les chiffres avant d’acheter.',
    footProduct: 'Produit', footCompany: 'Entreprise',
    footLinks: { discovery: 'Recherche', reports: 'Rapports IA', api: 'Tarifs', privacy: 'Confidentialité', legal: 'Mentions légales', support: 'Support' },
  },
  pt: {
    eyebrowL: 'Digest de pesquisa · Flórida', heroL: 'Entre para pesquisar oportunidades de negócio na Flórida.',
    leadL: 'Organize as informações dos anúncios, compare detalhes-chave e prepare as perguntas que valem a pena investigar.',
    statL: 'Um digest de pesquisa especializado — não é aconselhamento de investimento.',
    member: 'Acesso à conta', welcome: 'Bem-vindo de volta.', welcomeSub: 'Entre para continuar sua pesquisa.',
    createTitle: 'Crie sua conta.', createSub: 'Comece a organizar oportunidades na Flórida em minutos.',
    forgotTitle: 'Redefina sua senha.', forgotSub: 'Enviaremos um link para escolher uma nova senha.',
    orEmail: 'ou com email', nameLabel: 'Nome', namePh: 'Seu nome', emailLabel: 'Email', emailPh: 'voce@empresa.com',
    passLabel: 'Senha', forgot: 'Esqueceu?', passPh: '••••••••',
    signIn: 'Entrar', signUp: 'Criar conta', sendReset: 'Enviar link',
    noAccount: 'Não tem conta?', createOne: 'Crie uma',
    haveAccount: 'Já tem conta?', signInLink: 'Entrar', backToSignin: '← Voltar ao login',
    denied: 'Esta conta ainda não pode entrar.', back: '← Voltar ao início',
    errInvalid: 'Email ou senha incorretos.', errUnverified: 'Verifique seu email antes de entrar.',
    errTaken: 'Já existe uma conta com este email. Faça login.',
    resend: 'Reenviar email de verificação', busy: 'Aguarde…',
    verifyTitle: 'Verifique seu email', verifySub: 'Enviamos um link de verificação para',
    verifyHint: 'Clique no link para ativar sua conta. Expira em 24 horas.',
    resetTitle: 'Verifique seu email', resetSub: 'Se existe uma conta para',
    resetHint: 'você receberá um link para redefinir a senha. Expira em 1 hora.',
    footDisc: 'Pesquisa gerada por IA. Não é aconselhamento de investimento ou jurídico. Verifique todos os números antes de comprar.',
    footProduct: 'Produto', footCompany: 'Empresa',
    footLinks: { discovery: 'Buscar', reports: 'Relatórios IA', api: 'Preços', privacy: 'Privacidade', legal: 'Jurídico', support: 'Suporte' },
  },
};

type Mode = 'signin' | 'signup' | 'forgot';

export function Login() {
  const { isAuthed, loginWithGoogle, loginWithPassword } = useAuth();
  const { lang } = useLang();
  const t = pick(T, lang);
  const nav = useNavigate();
  const location = useLocation();
  const checkout = useCheckout();
  // Where to land after login: the page the user was sent to (e.g. a report link
  // from an email that bounced through /login), falling back to the app home.
  const dest = () => {
    const from = (location.state as { from?: string } | null)?.from;
    return from && from.startsWith('/app') ? from : '/app';
  };
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [sent, setSent] = useState<'verify' | 'reset' | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAuthed) nav(dest(), { replace: true }); }, [isAuthed]);

  // Shared post-login step: resume a plan the visitor picked on the landing
  // (Stripe Checkout), else go to the app. Credits are granted by the backend
  // webhook after payment — this never credits the user itself.
  async function afterLogin() {
    const pending = localStorage.getItem(PENDING_PLAN_KEY);
    if (pending) {
      localStorage.removeItem(PENDING_PLAN_KEY);
      try {
        const base = `${window.location.origin}/app/credits`;
        const res = await checkout.mutateAsync({ planId: pending, successUrl: `${base}?ok=1`, cancelUrl: base });
        window.location.href = res.url;
        return;
      } catch {
        nav('/app/credits', { replace: true });
        return;
      }
    }
    nav(dest(), { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    if (!config.googleClientId) { setError('VITE_GOOGLE_CLIENT_ID is not configured.'); return; }
    initGoogleAuth(config.googleClientId, async (idToken) => {
      setError(null);
      try {
        await loginWithGoogle(idToken);
        await afterLogin();
      } catch (err) {
        setError(err instanceof ApiError && err.status === 403 ? t.denied : err instanceof ApiError ? err.message : 'Login failed.');
      }
    })
      .then((id) => { if (!cancelled && btnRef.current) renderGoogleButton(id, btnRef.current); })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWithGoogle, t.denied]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email);
        setSent('reset');
      } else if (mode === 'signup') {
        await register(email, password, name || undefined);
        setSent('verify');
      } else {
        await loginWithPassword(email, password);
        await afterLogin();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) { setUnverified(true); setError(t.errUnverified); }
      else if (err instanceof ApiError && err.status === 409) setError(t.errTaken);
      else if (err instanceof ApiError && err.status === 401) setError(t.errInvalid);
      else setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    try { await register(email, password, name || undefined); setSent('verify'); setError(null); setUnverified(false); }
    catch { /* keep the current error */ }
    finally { setBusy(false); }
  }

  const switchMode = (m: Mode) => { setMode(m); setError(null); setUnverified(false); };
  const homeHref = lang === 'en' ? '/' : `/${lang}`;
  const title = mode === 'signin' ? t.welcome : mode === 'signup' ? t.createTitle : t.forgotTitle;
  const subtitle = mode === 'signin' ? t.welcomeSub : mode === 'signup' ? t.createSub : t.forgotSub;

  return (
    <div className="auth">
      <div className="auth-split">
        <section className="auth-left">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <Link className="brand" to={homeHref}><img className="brand-mark" src={MARK} alt="" width="26" height="26" />{BRAND}</Link>
            <LangSwitcher />
          </div>
          <div className="auth-left__body">
            <span className="eyebrow">{t.eyebrowL}</span>
            <h1 className="auth-hero">{t.heroL}</h1>
            <p className="auth-lead">{t.leadL}</p>
          </div>
          <div className="auth-left__foot"><span className="rule" />{t.statL}</div>
        </section>

        <section className="auth-right">
          <div className="auth-form">
            {sent ? (
              <div className="stack" style={{ gap: 8 }}>
                <span className="eyebrow" style={{ color: 'var(--accent)' }}>{t.member}</span>
                <h2 style={{ fontSize: 28, letterSpacing: '-0.03em', margin: '10px 0 6px' }}>{sent === 'verify' ? t.verifyTitle : t.resetTitle}</h2>
                <p className="soft" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                  {sent === 'verify' ? t.verifySub : t.resetSub} <b>{email}</b>. {sent === 'verify' ? t.verifyHint : t.resetHint}
                </p>
                <button className="link-ink" style={{ marginTop: 18, textAlign: 'left' }} onClick={() => { setSent(null); switchMode('signin'); }}>{t.backToSignin}</button>
              </div>
            ) : (
              <>
                <span className="eyebrow" style={{ color: 'var(--accent)' }}>{t.member}</span>
                <h2 style={{ fontSize: 30, letterSpacing: '-0.03em', margin: '10px 0 6px' }}>{title}</h2>
                <p className="soft" style={{ fontSize: 14, marginBottom: 22 }}>{subtitle}</p>

                {error && (
                  <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 14, lineHeight: 1.6 }}>
                    {error}
                    {unverified && <> · <button type="button" className="link-accent" onClick={resend} disabled={busy}>{t.resend}</button></>}
                  </div>
                )}

                {mode !== 'forgot' && (
                  <>
                    <div className="auth-gbtn" ref={btnRef} />
                    <div className="auth-or">{t.orEmail}</div>
                  </>
                )}

                <form onSubmit={onSubmit} noValidate>
                  {mode === 'signup' && (
                    <div className="auth-field">
                      <label htmlFor="name">{t.nameLabel}</label>
                      <input id="name" className="input" type="text" autoComplete="name" placeholder={t.namePh} value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                  )}
                  <div className="auth-field">
                    <label htmlFor="email">{t.emailLabel}</label>
                    <input id="email" className="input" type="email" autoComplete="email" placeholder={t.emailPh} value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  {mode !== 'forgot' && (
                    <div className="auth-field">
                      <div className="label-row">
                        <label htmlFor="password">{t.passLabel}</label>
                        {mode === 'signin' && <button type="button" className="link-accent" onClick={() => switchMode('forgot')}>{t.forgot}</button>}
                      </div>
                      <input id="password" className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={t.passPh} value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </div>
                  )}
                  <button type="submit" className="btn btn--black btn--block" style={{ marginTop: 4 }} disabled={busy}>
                    {busy ? t.busy : mode === 'signin' ? t.signIn : mode === 'signup' ? t.signUp : t.sendReset}
                  </button>
                </form>

                {mode === 'forgot' ? (
                  <p className="soft" style={{ fontSize: 13.5, marginTop: 20 }}>
                    <button className="link-ink" onClick={() => switchMode('signin')}>{t.backToSignin}</button>
                  </p>
                ) : (
                  <p className="soft" style={{ fontSize: 13.5, marginTop: 20 }}>
                    {mode === 'signin' ? t.noAccount : t.haveAccount}{' '}
                    <button className="link-ink" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>{mode === 'signin' ? t.createOne : t.signInLink}</button>
                  </p>
                )}
              </>
            )}
            <Link to={homeHref} className="mono muted" style={{ fontSize: 11, display: 'inline-block', marginTop: 16 }}>{t.back}</Link>
          </div>
        </section>
      </div>

      <footer className="foot">
        <div className="container">
          <div className="cols">
            <div>
              <div className="brand" style={{ marginBottom: 12 }}><img className="brand-mark" src={MARK} alt="" width="24" height="24" />{BRAND}</div>
              <p className="mono muted" style={{ fontSize: 10.5, lineHeight: 1.7, maxWidth: 340 }}>{t.footDisc}</p>
            </div>
            <div className="col">
              <h5>{t.footProduct}</h5>
              <a href="/#benefits">{t.footLinks.discovery}</a>
              <a href="/#inside">{t.footLinks.reports}</a>
              <Link to="/api-access">{t.footLinks.api}</Link>
            </div>
            <div className="col">
              <h5>{t.footCompany}</h5>
              <Link to="/privacy">{t.footLinks.privacy}</Link>
              <Link to="/legal">{t.footLinks.legal}</Link>
              <Link to="/support">{t.footLinks.support}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
