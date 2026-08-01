import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { verifyEmail } from '../api/client';

const MARK = '/icons/favicon.svg';
const T = {
  en: {
    title: 'Confirm your password to finish signing up',
    sub: 'Enter the password you chose when you created the account.',
    pw: 'Password', submit: 'Verify my email', working: 'Verifying…',
    ok: 'Email verified — sign in to continue.',
    wrong: 'That password does not match the one chosen when this account was created.',
    fail: 'This verification link is invalid or has expired.',
    login: 'Go to sign in', missing: 'This link is missing its token.',
  },
  es: {
    title: 'Confirma tu contraseña para terminar el registro',
    sub: 'Ingresa la contraseña que elegiste al crear la cuenta.',
    pw: 'Contraseña', submit: 'Verificar mi email', working: 'Verificando…',
    ok: 'Email verificado — ingresa para continuar.',
    wrong: 'Esa contraseña no coincide con la que se eligió al crear esta cuenta.',
    fail: 'Este enlace de verificación es inválido o expiró.',
    login: 'Ir al ingreso', missing: 'A este enlace le falta su token.',
  },
  fr: {
    title: 'Confirmez votre mot de passe pour terminer l’inscription',
    sub: 'Saisissez le mot de passe choisi lors de la création du compte.',
    pw: 'Mot de passe', submit: 'Vérifier mon email', working: 'Vérification…',
    ok: 'Email vérifié — connectez-vous pour continuer.',
    wrong: 'Ce mot de passe ne correspond pas à celui choisi à la création du compte.',
    fail: 'Ce lien de vérification est invalide ou a expiré.',
    login: 'Aller à la connexion', missing: 'Ce lien n’a pas son jeton.',
  },
  pt: {
    title: 'Confirme sua senha para concluir o cadastro',
    sub: 'Digite a senha escolhida ao criar a conta.',
    pw: 'Senha', submit: 'Verificar meu email', working: 'Verificando…',
    ok: 'Email verificado — entre para continuar.',
    wrong: 'Essa senha não corresponde à escolhida quando esta conta foi criada.',
    fail: 'Este link de verificação é inválido ou expirou.',
    login: 'Ir para o login', missing: 'Falta o token neste link.',
  },
};

/**
 * Verifying asks for the password, and does not run on load.
 *
 * Anyone can register an address they do not own, so a click proves only that you
 * read the mail — not that you are the person who signed up. Auto-verifying on
 * load meant a victim who merely opened the link activated a password a stranger
 * had chosen. Someone who never registered cannot get past this form.
 */
export function VerifyEmail() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const { lang } = useLang();
  const t = pick(T, lang);
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'ok' | 'wrong' | 'fail'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || state === 'working') return;
    setState('working');
    try {
      await verifyEmail(token, password);
      setState('ok');
      setTimeout(() => nav('/login', { replace: true }), 1200);
    } catch (err) {
      // A wrong password leaves the link usable — one typo must not cost a
      // legitimate user their registration.
      setState((err as { status?: number }).status === 401 ? 'wrong' : 'fail');
    }
  }

  return (
    <div className="auth-mini">
      <div className="card auth-mini__card">
        <img className="brand-mark" src={MARK} alt="" width="30" height="30" style={{ marginBottom: 16 }} />

        {!token && (
          <div className="stack" style={{ gap: 16 }}>
            <p className="soft" style={{ fontSize: 15 }}>{t.missing}</p>
            <Link className="btn btn--black btn--sm" to="/login">{t.login}</Link>
          </div>
        )}

        {token && state === 'ok' && (
          <div className="stack" style={{ gap: 16 }}>
            <p className="soft" style={{ fontSize: 15 }}>{t.ok}</p>
            <Link className="btn btn--black btn--sm" to="/login">{t.login}</Link>
          </div>
        )}

        {token && state === 'fail' && (
          <div className="stack" style={{ gap: 16 }}>
            <p className="soft" style={{ fontSize: 15 }}>{t.fail}</p>
            <Link className="btn btn--black btn--sm" to="/login">{t.login}</Link>
          </div>
        )}

        {token && (state === 'idle' || state === 'working' || state === 'wrong') && (
          <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
            <h1 style={{ fontSize: 19, margin: 0 }}>{t.title}</h1>
            <p className="soft" style={{ fontSize: 14, margin: 0 }}>{t.sub}</p>
            <label className="stack" style={{ gap: 6 }}>
              <span className="rv__k">{t.pw}</span>
              <input
                type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required
              />
            </label>
            {state === 'wrong' && <p className="soft" style={{ fontSize: 14, color: 'var(--danger, #b4453c)' }}>{t.wrong}</p>}
            <button className="btn btn--black btn--sm" type="submit" disabled={state === 'working' || !password}>
              {state === 'working' ? t.working : t.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
