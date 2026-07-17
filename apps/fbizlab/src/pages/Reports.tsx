import { Link, useNavigate } from 'react-router-dom';
import { pick, useLang, type Lang } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useBalance, useJobs, useMyStats } from '../api/hooks';
import type { JobStatus } from '../api/types';

const T = {
  en: {
    dashboard: 'Dashboard', hi: 'Hi, ',
    sub: 'Generate new dossiers, track running ones, and manage your credits.',
    buyCredits: 'Buy credits', newReport: 'New report',
    creditsLbl: 'Credits', creditsSub: 'Available',
    totalLbl: 'Total reports', totalSub: 'All-time',
    readyLbl: 'Ready', readySub: 'Ready to review',
    progressLbl: 'In progress', progressSub: 'Processing or queued',
    yourBalance: 'Your balance', creditsAvailable: 'credits available', buyMore: 'Buy more',
    yourReports: 'Your business opportunities', total: 'total', empty: 'No reports yet — create your first dossier.',
    open: 'Open', processing: 'Processing…', retry: 'Retry',
  },
  es: {
    dashboard: 'Panel', hi: 'Hola, ',
    sub: 'Genera nuevos dossiers, sigue los que están corriendo y administra tus créditos.',
    buyCredits: 'Comprar créditos', newReport: 'Nuevo reporte',
    creditsLbl: 'Créditos', creditsSub: 'Disponibles',
    totalLbl: 'Reportes totales', totalSub: 'Histórico',
    readyLbl: 'Listos', readySub: 'Listos para revisar',
    progressLbl: 'En proceso', progressSub: 'Procesando o en cola',
    yourBalance: 'Tu saldo', creditsAvailable: 'créditos disponibles', buyMore: 'Comprar más',
    yourReports: 'Tus oportunidades de negocio', total: 'en total', empty: 'Aún no tienes reportes — crea tu primer dossier.',
    open: 'Abrir', processing: 'Procesando…', retry: 'Reintentar',
  },
  fr: {
    dashboard: 'Tableau de bord', hi: 'Bonjour, ',
    sub: 'Générez de nouveaux dossiers, suivez ceux en cours et gérez vos crédits.',
    buyCredits: 'Acheter des crédits', newReport: 'Nouveau rapport',
    creditsLbl: 'Crédits', creditsSub: 'Disponibles',
    totalLbl: 'Rapports au total', totalSub: 'Depuis le début',
    readyLbl: 'Prêts', readySub: 'Prêts à consulter',
    progressLbl: 'En cours', progressSub: 'En traitement ou en file',
    yourBalance: 'Votre solde', creditsAvailable: 'crédits disponibles', buyMore: 'Acheter plus',
    yourReports: 'Vos opportunités d’affaires', total: 'au total', empty: 'Aucun rapport — créez votre premier dossier.',
    open: 'Ouvrir', processing: 'En cours…', retry: 'Réessayer',
  },
  pt: {
    dashboard: 'Painel', hi: 'Olá, ',
    sub: 'Gere novos dossiês, acompanhe os que estão rodando e administre seus créditos.',
    buyCredits: 'Comprar créditos', newReport: 'Novo relatório',
    creditsLbl: 'Créditos', creditsSub: 'Disponíveis',
    totalLbl: 'Relatórios no total', totalSub: 'Desde o início',
    readyLbl: 'Prontos', readySub: 'Prontos para revisar',
    progressLbl: 'Em andamento', progressSub: 'Processando ou na fila',
    yourBalance: 'Seu saldo', creditsAvailable: 'créditos disponíveis', buyMore: 'Comprar mais',
    yourReports: 'Suas oportunidades de negócio', total: 'no total', empty: 'Nenhum relatório ainda — crie seu primeiro dossiê.',
    open: 'Abrir', processing: 'Processando…', retry: 'Tentar de novo',
  },
};

const STATUS_LABEL: Record<Lang, Record<JobStatus, string>> = {
  en: { queued: 'Queued', running: 'Processing', completed: 'Ready', failed: 'Failed', incomplete: 'Partial' },
  es: { queued: 'En cola', running: 'Procesando', completed: 'Listo', failed: 'Falló', incomplete: 'Parcial' },
  fr: { queued: 'En file', running: 'En cours', completed: 'Prêt', failed: 'Échec', incomplete: 'Partiel' },
  pt: { queued: 'Na fila', running: 'Processando', completed: 'Pronto', failed: 'Falhou', incomplete: 'Parcial' },
};

const TERMINAL: JobStatus[] = ['completed', 'incomplete'];
const LIVE: JobStatus[] = ['queued', 'running'];

const shortId = (jobId: string) => `#${jobId.slice(0, 6).toUpperCase()}`;
function fmtDate(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
}
function firstName(name: string | null | undefined, email: string | undefined): string {
  const n = name?.trim().split(/\s+/)[0];
  if (n) return n;
  const local = email?.split('@')[0] ?? '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
}

export function Reports() {
  const { lang } = useLang();
  const { user } = useAuth();
  const t = pick(T, lang);
  const sl = STATUS_LABEL[lang] ?? STATUS_LABEL.en;
  const jobs = useJobs();
  const balance = useBalance();
  const stats = useMyStats();
  const nav = useNavigate();

  const list = jobs.data?.jobs ?? [];
  // Stat tiles come from the server-side per-user aggregate (accurate over ALL
  // jobs), falling back to the loaded list only until it arrives.
  const total = stats.data?.total ?? list.length;
  const ready = stats.data?.ready ?? list.filter((j) => TERMINAL.includes(j.status)).length;
  const inProgress = stats.data?.inProgress ?? list.filter((j) => LIVE.includes(j.status)).length;
  const bal = balance.data?.balance;

  return (
    <div className="stack" style={{ gap: 30 }}>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow" style={{ color: 'var(--accent)' }}>{t.dashboard}</span>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)', letterSpacing: '-0.03em', fontWeight: 800, lineHeight: 1.04 }}>
            {t.hi}{firstName(user?.name, user?.email)}<span className="accent">.</span>
          </h1>
          <p className="soft" style={{ fontSize: 14.5, maxWidth: 470 }}>{t.sub}</p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Link className="btn btn--outline" to="/app/credits">{t.buyCredits}</Link>
          <Link className="btn btn--black" to="/app/new">+ {t.newReport}</Link>
        </div>
      </div>

      <div className="dash-stats">
        <div>
          <div className="dash-stat__lbl">{t.creditsLbl}</div>
          <div className="dash-stat__val accent">{bal ?? '…'}</div>
          <div className="dash-stat__sub">{t.creditsSub}</div>
        </div>
        <div>
          <div className="dash-stat__lbl">{t.totalLbl}</div>
          <div className="dash-stat__val">{total}</div>
          <div className="dash-stat__sub">{t.totalSub}</div>
        </div>
        <div>
          <div className="dash-stat__lbl">{t.readyLbl}</div>
          <div className="dash-stat__val">{ready}</div>
          <div className="dash-stat__sub">{t.readySub}</div>
        </div>
        <div>
          <div className="dash-stat__lbl">{t.progressLbl}</div>
          <div className="dash-stat__val">{inProgress}</div>
          <div className="dash-stat__sub">{t.progressSub}</div>
        </div>
      </div>

      <div className="card dash-balance">
        <div>
          <div className="eyebrow" style={{ color: 'var(--accent)' }}>{t.yourBalance}</div>
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{bal ?? '…'}</span>{' '}
            <span className="soft" style={{ fontSize: 14 }}>{t.creditsAvailable}</span>
          </div>
        </div>
        <Link className="btn btn--black" to="/app/credits">{t.buyMore}</Link>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="between" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{t.yourReports}</h2>
          <span className="mono muted" style={{ fontSize: 11 }}>{total} {t.total}</span>
        </div>

        {jobs.isLoading && <div className="mono muted">…</div>}
        {!jobs.isLoading && list.length === 0 && (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <p className="soft" style={{ marginBottom: 16 }}>{t.empty}</p>
            <Link className="btn btn--black" to="/app/new">+ {t.newReport}</Link>
          </div>
        )}

        <div className="dash-list">
          {list.map((j) => {
            const open = () => nav(`/app/jobs/${j.jobId}`);
            const meta = [j.shortDescription, fmtDate(j.createdAt, lang)].filter(Boolean).join(' · ');
            return (
              <div className="dash-row" key={j.jobId} onClick={open} role="button" tabIndex={0}>
                <div className="dash-row__main">
                  <div className="dash-row__id">
                    <span className="mono muted">{shortId(j.jobId)}</span>
                    <span className={`badge ${j.status}`}>{sl[j.status] ?? j.status}</span>
                  </div>
                  <div className="dash-row__title">{j.title ?? j.jobId.slice(0, 8)}</div>
                  {meta && <div className="dash-row__meta mono">{meta}</div>}
                  {j.status === 'running' && <div className="dash-row__bar"><span /></div>}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  {TERMINAL.includes(j.status) && <button className="btn btn--black btn--sm" onClick={open}>{t.open}</button>}
                  {LIVE.includes(j.status) && <button className="btn btn--outline btn--sm" onClick={open}>{t.processing}</button>}
                  {j.status === 'failed' && <button className="btn btn--outline btn--sm" onClick={() => nav('/app/new')}>{t.retry}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
