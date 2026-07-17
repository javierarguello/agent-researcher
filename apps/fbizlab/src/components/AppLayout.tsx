import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { LangSwitcher } from './LangSwitcher';
import { useBalance } from '../api/hooks';

const T = {
  en: { reports: 'Dossiers', newReport: 'New dossier', credits: 'Credits', logout: 'Log out', credit: 'credits' },
  es: { reports: 'Dossiers', newReport: 'Nuevo dossier', credits: 'Créditos', logout: 'Salir', credit: 'créditos' },
  fr: { reports: 'Dossiers', newReport: 'Nouveau dossier', credits: 'Crédits', logout: 'Déconnexion', credit: 'crédits' },
  pt: { reports: 'Dossiês', newReport: 'Novo dossiê', credits: 'Créditos', logout: 'Sair', credit: 'créditos' },
};

const BRAND = 'Florida Biz Labs';
const navCls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

export function AppLayout() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  const nav = useNavigate();
  const balance = useBalance();
  const t = pick(T, lang);
  const [menuOpen, setMenuOpen] = useState(false);
  const home = lang === 'en' ? '/' : `/${lang}`;
  const doLogout = () => { setMenuOpen(false); logout(); nav('/'); };
  const close = () => setMenuOpen(false);

  return (
    <div>
      <header className="hdr">
        <div className="container">
          <Link className="brand" to={home}><img className="brand-mark" src="/icons/favicon.svg" alt="" width="26" height="26" />{BRAND}</Link>
          <nav className="nav">
            <NavLink to="/app" end className={navCls}>{t.reports}</NavLink>
            <NavLink to="/app/new" className={navCls}>{t.newReport}</NavLink>
            <NavLink to="/app/credits" className={navCls}>{t.credits}</NavLink>
          </nav>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/app/credits" className="mono" style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
              {balance.data ? `${balance.data.balance} ${t.credit}` : '…'}
            </Link>
            <div className="hdr-desktop">
              <LangSwitcher />
              <span className="mono muted hdr-email" style={{ fontSize: 11 }}>{user?.email}</span>
              <button className="btn btn--outline btn--sm" onClick={doLogout}>{t.logout}</button>
            </div>
            <button className="hdr-burger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <span /><span /><span />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="hdr-menu">
            <NavLink to="/app" end className={navCls} onClick={close}>{t.reports}</NavLink>
            <NavLink to="/app/new" className={navCls} onClick={close}>{t.newReport}</NavLink>
            <NavLink to="/app/credits" className={navCls} onClick={close}>{t.credits}</NavLink>
            <hr className="divider" style={{ margin: '4px 0' }} />
            <div className="between" style={{ alignItems: 'center' }}>
              <LangSwitcher />
              <span className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</span>
            </div>
            <button className="btn btn--outline btn--sm btn--block" onClick={doLogout}>{t.logout}</button>
          </div>
        )}
      </header>
      <main className="app-main">
        <div className="container"><Outlet /></div>
      </main>
    </div>
  );
}
