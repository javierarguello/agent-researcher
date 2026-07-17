import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { ApiError, resetPassword } from '../api/client';

const MARK = '/icons/favicon.svg';
const T = {
  en: { title: 'Choose a new password', sub: 'Enter a new password for your account.', label: 'New password', ph: '••••••••', submit: 'Reset password', busy: 'Please wait…', missing: 'This reset link is missing its token.', invalid: 'This reset link is invalid or has expired.', login: 'Back to sign in', tooShort: 'Password must be at least 8 characters.' },
  es: { title: 'Elige una nueva contraseña', sub: 'Ingresa una nueva contraseña para tu cuenta.', label: 'Nueva contraseña', ph: '••••••••', submit: 'Restablecer contraseña', busy: 'Espera…', missing: 'A este enlace le falta su token.', invalid: 'Este enlace es inválido o expiró.', login: 'Volver al ingreso', tooShort: 'La contraseña debe tener al menos 8 caracteres.' },
  fr: { title: 'Choisissez un nouveau mot de passe', sub: 'Saisissez un nouveau mot de passe pour votre compte.', label: 'Nouveau mot de passe', ph: '••••••••', submit: 'Réinitialiser', busy: 'Patientez…', missing: 'Ce lien n’a pas son jeton.', invalid: 'Ce lien est invalide ou a expiré.', login: 'Retour à la connexion', tooShort: 'Le mot de passe doit contenir au moins 8 caractères.' },
  pt: { title: 'Escolha uma nova senha', sub: 'Digite uma nova senha para sua conta.', label: 'Nova senha', ph: '••••••••', submit: 'Redefinir senha', busy: 'Aguarde…', missing: 'Falta o token neste link.', invalid: 'Este link é inválido ou expirou.', login: 'Voltar ao login', tooShort: 'A senha deve ter pelo menos 8 caracteres.' },
};

export function ResetPassword() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const { lang } = useLang();
  const t = pick(T, lang);
  const { applySession } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t.missing);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError(t.tooShort); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await resetPassword(token, password);
      applySession(res);
      nav('/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? t.invalid : err instanceof ApiError ? err.message : t.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-mini">
      <div className="card auth-mini__card" style={{ textAlign: 'left', maxWidth: 400 }}>
        <img className="brand-mark" src={MARK} alt="" width="30" height="30" style={{ marginBottom: 16 }} />
        <h2 style={{ fontSize: 24, letterSpacing: '-0.02em', margin: '0 0 6px' }}>{t.title}</h2>
        <p className="soft" style={{ fontSize: 14, marginBottom: 20 }}>{t.sub}</p>
        {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 14, lineHeight: 1.6 }}>{error}</div>}
        {token && (
          <form onSubmit={onSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="np">{t.label}</label>
              <input id="np" className="input" type="password" autoComplete="new-password" placeholder={t.ph} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn--black btn--block" style={{ marginTop: 4 }} disabled={busy}>{busy ? t.busy : t.submit}</button>
          </form>
        )}
        <Link to="/login" className="mono muted" style={{ fontSize: 11, display: 'inline-block', marginTop: 16 }}>← {t.login}</Link>
      </div>
    </div>
  );
}
