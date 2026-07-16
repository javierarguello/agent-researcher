import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { config } from '../config';
import { initGoogleAuth, renderGoogleButton } from '../auth/google';
import { ApiError } from '../api/client';

const BRAND = 'FloridaBizLab';
const T = {
  en: { title: 'Sign in / create account', sub: 'Continue with Google to access your Florida market reports.', back: '← Back to home', denied: 'This account can’t sign in yet.', disclaimer: 'By continuing you agree this is AI-generated research, not investment or legal advice.' },
  es: { title: 'Ingresar / crear cuenta', sub: 'Continúa con Google para acceder a tus reportes de mercado en Florida.', back: '← Volver al inicio', denied: 'Esta cuenta aún no puede ingresar.', disclaimer: 'Al continuar aceptas que esto es research generado por IA, no asesoría de inversión ni legal.' },
  fr: { title: 'Connexion / créer un compte', sub: 'Continuez avec Google pour accéder à vos rapports de marché en Floride.', back: '← Retour à l’accueil', denied: 'Ce compte ne peut pas encore se connecter.', disclaimer: 'En continuant, vous reconnaissez qu’il s’agit de research généré par IA, pas un conseil en investissement ni juridique.' },
  pt: { title: 'Entrar / criar conta', sub: 'Continue com o Google para acessar seus relatórios de mercado na Flórida.', back: '← Voltar ao início', denied: 'Esta conta ainda não pode entrar.', disclaimer: 'Ao continuar, você concorda que isto é research gerado por IA, não aconselhamento de investimento ou jurídico.' },
};

export function Login() {
  const { isAuthed, loginWithGoogle } = useAuth();
  const { lang } = useLang();
  const t = pick(T, lang);
  const nav = useNavigate();
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ padding: 36, width: 380, maxWidth: '100%' }}>
        <div className="brand" style={{ fontSize: 20, marginBottom: 6 }}>{BRAND}<span className="dot">.</span></div>
        <h2 style={{ fontSize: 22, marginTop: 14 }}>{t.title}</h2>
        <p className="soft" style={{ fontSize: 14, margin: '8px 0 22px' }}>{t.sub}</p>
        {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 14 }}>{error}</div>}
        <div ref={btnRef} />
        <p className="mono muted" style={{ fontSize: 10.5, lineHeight: 1.6, marginTop: 20 }}>{t.disclaimer}</p>
        <Link to="/" className="mono muted" style={{ fontSize: 11, display: 'inline-block', marginTop: 18 }}>{t.back}</Link>
      </div>
    </div>
  );
}
