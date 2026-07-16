import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { config } from '../config';
import { initGoogleAuth, renderGoogleButton } from '../auth/google';
import { LangSwitcher } from '../components/LangSwitcher';
import { ApiError } from '../api/client';

const BRAND = 'Florida Biz Labs';
const MARK = '/icons/favicon.svg';

const T = {
  en: {
    eyebrowL: 'Investment thesis · Florida',
    heroL: 'Find the right Florida business to acquire.',
    leadL: 'A personalized investment thesis, backed by a market digest current to the moment you run it.',
    statL: '400+ active FL buyers this month',
    member: 'Member access',
    welcome: 'Welcome back.', welcomeSub: 'Sign in to keep exploring Florida opportunities.',
    createTitle: 'Create your account.', createSub: 'Start building Florida investment theses in minutes.',
    orEmail: 'or with email', emailLabel: 'Email', emailPh: 'you@company.com',
    passLabel: 'Password', forgot: 'Forgot?', passPh: '••••••••',
    signIn: 'Sign in', signUp: 'Create account',
    noAccount: 'Don’t have an account?', createOne: 'Create one',
    haveAccount: 'Already have an account?', signInLink: 'Sign in',
    mockNote: 'Email sign-in is coming soon — continue with Google for now.',
    denied: 'This account can’t sign in yet.', back: '← Back to home',
    footDisc: 'AI-generated research. Not investment or legal advice. Verify all figures independently before purchasing.',
    footProduct: 'Product', footCompany: 'Company',
    footLinks: { discovery: 'Market discovery', reports: 'AI reports', api: 'API access', privacy: 'Privacy', legal: 'Legal', support: 'Support' },
  },
  es: {
    eyebrowL: 'Tesis de inversión · Florida',
    heroL: 'Encuentra el negocio correcto para comprar en Florida.',
    leadL: 'Una tesis de inversión personalizada, respaldada por un digest de mercado actualizado al momento en que lo generas.',
    statL: '400+ compradores activos en FL este mes',
    member: 'Acceso de miembros',
    welcome: 'Bienvenido de nuevo.', welcomeSub: 'Ingresa para seguir explorando oportunidades en Florida.',
    createTitle: 'Crea tu cuenta.', createSub: 'Empieza a generar tesis de inversión en Florida en minutos.',
    orEmail: 'o con email', emailLabel: 'Email', emailPh: 'tú@empresa.com',
    passLabel: 'Contraseña', forgot: '¿Olvidaste?', passPh: '••••••••',
    signIn: 'Ingresar', signUp: 'Crear cuenta',
    noAccount: '¿No tienes cuenta?', createOne: 'Crea una',
    haveAccount: '¿Ya tienes cuenta?', signInLink: 'Ingresa',
    mockNote: 'El ingreso por email llegará pronto — usa Google por ahora.',
    denied: 'Esta cuenta aún no puede ingresar.', back: '← Volver al inicio',
    footDisc: 'Research generado por IA. No es asesoría de inversión ni legal. Verifica todas las cifras de forma independiente antes de comprar.',
    footProduct: 'Producto', footCompany: 'Empresa',
    footLinks: { discovery: 'Descubrimiento', reports: 'Reportes IA', api: 'Acceso API', privacy: 'Privacidad', legal: 'Legal', support: 'Soporte' },
  },
  fr: {
    eyebrowL: 'Thèse d’investissement · Floride',
    heroL: 'Trouvez la bonne entreprise à acquérir en Floride.',
    leadL: 'Une thèse d’investissement personnalisée, appuyée par un digest de marché actualisé au moment où vous le générez.',
    statL: '400+ acheteurs actifs en FL ce mois-ci',
    member: 'Accès membre',
    welcome: 'Bon retour.', welcomeSub: 'Connectez-vous pour continuer à explorer la Floride.',
    createTitle: 'Créez votre compte.', createSub: 'Commencez à produire des thèses d’investissement en quelques minutes.',
    orEmail: 'ou par email', emailLabel: 'Email', emailPh: 'vous@entreprise.com',
    passLabel: 'Mot de passe', forgot: 'Oublié ?', passPh: '••••••••',
    signIn: 'Se connecter', signUp: 'Créer un compte',
    noAccount: 'Pas de compte ?', createOne: 'Créez-en un',
    haveAccount: 'Déjà un compte ?', signInLink: 'Se connecter',
    mockNote: 'La connexion par email arrive bientôt — utilisez Google pour l’instant.',
    denied: 'Ce compte ne peut pas encore se connecter.', back: '← Retour à l’accueil',
    footDisc: 'Research généré par IA. Pas un conseil en investissement ni juridique. Vérifiez tous les chiffres de façon indépendante avant d’acheter.',
    footProduct: 'Produit', footCompany: 'Entreprise',
    footLinks: { discovery: 'Découverte', reports: 'Rapports IA', api: 'Accès API', privacy: 'Confidentialité', legal: 'Mentions légales', support: 'Support' },
  },
  pt: {
    eyebrowL: 'Tese de investimento · Flórida',
    heroL: 'Encontre o negócio certo para comprar na Flórida.',
    leadL: 'Uma tese de investimento personalizada, apoiada por um digest de mercado atualizado no momento em que você gera.',
    statL: '400+ compradores ativos na FL este mês',
    member: 'Acesso de membros',
    welcome: 'Bem-vindo de volta.', welcomeSub: 'Entre para continuar explorando oportunidades na Flórida.',
    createTitle: 'Crie sua conta.', createSub: 'Comece a gerar teses de investimento na Flórida em minutos.',
    orEmail: 'ou com email', emailLabel: 'Email', emailPh: 'voce@empresa.com',
    passLabel: 'Senha', forgot: 'Esqueceu?', passPh: '••••••••',
    signIn: 'Entrar', signUp: 'Criar conta',
    noAccount: 'Não tem conta?', createOne: 'Crie uma',
    haveAccount: 'Já tem conta?', signInLink: 'Entrar',
    mockNote: 'O login por email chega em breve — use o Google por enquanto.',
    denied: 'Esta conta ainda não pode entrar.', back: '← Voltar ao início',
    footDisc: 'Research gerado por IA. Não é aconselhamento de investimento ou jurídico. Verifique todos os números de forma independente antes de comprar.',
    footProduct: 'Produto', footCompany: 'Empresa',
    footLinks: { discovery: 'Descoberta', reports: 'Relatórios IA', api: 'Acesso API', privacy: 'Privacidade', legal: 'Jurídico', support: 'Suporte' },
  },
};

export function Login() {
  const { isAuthed, loginWithGoogle } = useAuth();
  const { lang } = useLang();
  const t = pick(T, lang);
  const nav = useNavigate();
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { if (isAuthed) nav('/app', { replace: true }); }, [isAuthed, nav]);

  useEffect(() => {
    let cancelled = false;
    if (!config.googleClientId) { setError('VITE_GOOGLE_CLIENT_ID is not configured.'); return; }
    initGoogleAuth(config.googleClientId, async (idToken) => {
      setError(null);
      try {
        await loginWithGoogle(idToken);
        nav('/app', { replace: true });
      } catch (err) {
        setError(err instanceof ApiError && err.status === 403 ? t.denied : err instanceof ApiError ? err.message : 'Login failed.');
      }
    })
      .then((id) => { if (!cancelled && btnRef.current) renderGoogleButton(id, btnRef.current); })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [loginWithGoogle, nav, t.denied]);

  // Email/password is mocked for now — real password auth isn't wired yet.
  const onSubmit = (e: FormEvent) => { e.preventDefault(); setInfo(t.mockNote); };
  const toggleMode = () => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setInfo(null); };

  return (
    <div className="auth">
      <div className="auth-split">
        <section className="auth-left">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <Link className="brand" to="/"><img className="brand-mark" src={MARK} alt="" width="26" height="26" />{BRAND}</Link>
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
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>{t.member}</span>
            <h2 style={{ fontSize: 30, letterSpacing: '-0.03em', margin: '10px 0 6px' }}>{mode === 'signin' ? t.welcome : t.createTitle}</h2>
            <p className="soft" style={{ fontSize: 14, marginBottom: 22 }}>{mode === 'signin' ? t.welcomeSub : t.createSub}</p>

            {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 14 }}>{error}</div>}

            <div className="auth-gbtn" ref={btnRef} />

            <div className="auth-or">{t.orEmail}</div>

            <form onSubmit={onSubmit} noValidate>
              <div className="auth-field">
                <label htmlFor="email">{t.emailLabel}</label>
                <input id="email" className="input" type="email" autoComplete="email" placeholder={t.emailPh} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="auth-field">
                <div className="label-row">
                  <label htmlFor="password">{t.passLabel}</label>
                  <button type="button" className="link-accent" onClick={() => setInfo(t.mockNote)}>{t.forgot}</button>
                </div>
                <input id="password" className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={t.passPh} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button type="submit" className="btn btn--black btn--block" style={{ marginTop: 4 }}>{mode === 'signin' ? t.signIn : t.signUp}</button>
            </form>

            {info && <div className="mono" style={{ fontSize: 12, color: 'var(--accent)', marginTop: 14, lineHeight: 1.6 }}>{info}</div>}

            <p className="soft" style={{ fontSize: 13.5, marginTop: 20 }}>
              {mode === 'signin' ? t.noAccount : t.haveAccount}{' '}
              <button className="link-ink" onClick={toggleMode}>{mode === 'signin' ? t.createOne : t.signInLink}</button>
            </p>
            <Link to="/" className="mono muted" style={{ fontSize: 11, display: 'inline-block', marginTop: 16 }}>{t.back}</Link>
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
              <a href="/#workspace">{t.footLinks.discovery}</a>
              <a href="/#inside">{t.footLinks.reports}</a>
              <a href="/#pricing">{t.footLinks.api}</a>
            </div>
            <div className="col">
              <h5>{t.footCompany}</h5>
              <a href="/#">{t.footLinks.privacy}</a>
              <a href="/#">{t.footLinks.legal}</a>
              <a href="/#">{t.footLinks.support}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
