import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { verifyEmail } from '../api/client';

const MARK = '/icons/favicon.svg';
const T = {
  en: { title: 'Verifying your email…', ok: 'Email verified. Taking you in…', fail: 'This verification link is invalid or has expired.', login: 'Go to sign in', missing: 'This link is missing its token.' },
  es: { title: 'Verificando tu email…', ok: 'Email verificado. Entrando…', fail: 'Este enlace de verificación es inválido o expiró.', login: 'Ir al ingreso', missing: 'A este enlace le falta su token.' },
  fr: { title: 'Vérification de votre email…', ok: 'Email vérifié. Connexion…', fail: 'Ce lien de vérification est invalide ou a expiré.', login: 'Aller à la connexion', missing: 'Ce lien n’a pas son jeton.' },
  pt: { title: 'Verificando seu email…', ok: 'Email verificado. Entrando…', fail: 'Este link de verificação é inválido ou expirou.', login: 'Ir para o login', missing: 'Falta o token neste link.' },
};

export function VerifyEmail() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const { lang } = useLang();
  const t = pick(T, lang);
  const { applySession } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState<'working' | 'ok' | 'fail'>(token ? 'working' : 'fail');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verifyEmail(token)
      .then((res) => { applySession(res); setState('ok'); setTimeout(() => nav('/app', { replace: true }), 800); })
      .catch(() => setState('fail'));
  }, [token, applySession, nav]);

  return (
    <div className="auth-mini">
      <div className="card auth-mini__card">
        <img className="brand-mark" src={MARK} alt="" width="30" height="30" style={{ marginBottom: 16 }} />
        {state === 'working' && <div className="row" style={{ gap: 10 }}><span className="pdf-spin" /><span className="soft">{t.title}</span></div>}
        {state === 'ok' && <p className="soft" style={{ fontSize: 15 }}>{t.ok}</p>}
        {state === 'fail' && (
          <div className="stack" style={{ gap: 16 }}>
            <p className="soft" style={{ fontSize: 15 }}>{token ? t.fail : t.missing}</p>
            <Link className="btn btn--black btn--sm" to="/login">{t.login}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
