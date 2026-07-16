import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pick, useLang } from '../i18n';
import { LangSwitcher } from './LangSwitcher';
import { useBalance } from '../api/hooks';

const T = {
  en: { reports: 'Reports', newReport: 'New report', credits: 'Credits', logout: 'Log out', credit: 'credits' },
  es: { reports: 'Reportes', newReport: 'Nuevo reporte', credits: 'Créditos', logout: 'Salir', credit: 'créditos' },
  fr: { reports: 'Rapports', newReport: 'Nouveau rapport', credits: 'Crédits', logout: 'Déconnexion', credit: 'crédits' },
  pt: { reports: 'Relatórios', newReport: 'Novo relatório', credits: 'Créditos', logout: 'Sair', credit: 'créditos' },
};

const BRAND = 'FloridaBizLab';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  const nav = useNavigate();
  const balance = useBalance();
  const t = pick(T, lang);

  return (
    <div>
      <header className="hdr">
        <div className="container">
          <Link className="brand" to="/">{BRAND}<span className="dot">.</span></Link>
          <nav className="nav">
            <NavLink to="/app" end className={({ isActive }) => (isActive ? 'active' : '')}>{t.reports}</NavLink>
            <NavLink to="/app/new" className={({ isActive }) => (isActive ? 'active' : '')}>{t.newReport}</NavLink>
            <NavLink to="/app/credits" className={({ isActive }) => (isActive ? 'active' : '')}>{t.credits}</NavLink>
          </nav>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/app/credits" className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
              {balance.data ? `${balance.data.balance} ${t.credit}` : '…'}
            </Link>
            <LangSwitcher />
            <span className="mono muted" style={{ fontSize: 11 }}>{user?.email}</span>
            <button className="btn btn--outline btn--sm" onClick={() => { logout(); nav('/'); }}>{t.logout}</button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <div className="container"><Outlet /></div>
      </main>
    </div>
  );
}
