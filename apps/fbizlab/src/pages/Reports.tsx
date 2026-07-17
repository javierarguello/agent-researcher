import { Link, useNavigate } from 'react-router-dom';
import { pick, useLang, type Lang } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useBalance, useJobs, useMyStats, useTemplates } from '../api/hooks';
import type { JobStatus } from '../api/types';
import { DownloadPdf } from '../components/DownloadPdf';

const T = {
  en: {
    dashboard: 'Dashboard', hi: 'Hi, ',
    sub: 'Generate new dossiers, track running ones, and manage your credits.',
    buyCredits: 'Buy credits', newReport: 'New dossier',
    creditsLbl: 'Credits', creditsSub: 'Available',
    totalLbl: 'Total dossiers', totalSub: 'All-time',
    readyLbl: 'Ready', readySub: 'Ready to review',
    progressLbl: 'In progress', progressSub: 'Processing or queued',
    yourBalance: 'Your balance', creditsAvailable: 'credits available', buyMore: 'Buy more', blockedTitle: 'Account blocked', blockedBody: 'Your account has been blocked by content moderation for inappropriate requests. You can still view your previous dossiers, but you can’t generate new ones.',
    yourReports: 'Your business opportunities', total: 'total', empty: 'No dossiers yet — create your first one.',
    open: 'Open', processing: 'Processing…', retry: 'Retry',
  },
  es: {
    dashboard: 'Panel', hi: 'Hola, ',
    sub: 'Genera nuevos dossiers, sigue los que están corriendo y administra tus créditos.',
    buyCredits: 'Comprar créditos', newReport: 'Nuevo dossier',
    creditsLbl: 'Créditos', creditsSub: 'Disponibles',
    totalLbl: 'Dossiers totales', totalSub: 'Histórico',
    readyLbl: 'Listos', readySub: 'Listos para revisar',
    progressLbl: 'En proceso', progressSub: 'Procesando o en cola',
    yourBalance: 'Tu saldo', creditsAvailable: 'créditos disponibles', buyMore: 'Comprar más', blockedTitle: 'Cuenta bloqueada', blockedBody: 'Tu cuenta fue bloqueada por moderación de contenido por solicitudes inapropiadas. Puedes ver tus dossiers anteriores, pero no generar nuevos.',
    yourReports: 'Tus oportunidades de negocio', total: 'en total', empty: 'Aún no tienes dossiers — crea el primero.',
    open: 'Abrir', processing: 'Procesando…', retry: 'Reintentar',
  },
  fr: {
    dashboard: 'Tableau de bord', hi: 'Bonjour, ',
    sub: 'Générez de nouveaux dossiers, suivez ceux en cours et gérez vos crédits.',
    buyCredits: 'Acheter des crédits', newReport: 'Nouveau dossier',
    creditsLbl: 'Crédits', creditsSub: 'Disponibles',
    totalLbl: 'Dossiers au total', totalSub: 'Depuis le début',
    readyLbl: 'Prêts', readySub: 'Prêts à consulter',
    progressLbl: 'En cours', progressSub: 'En traitement ou en file',
    yourBalance: 'Votre solde', creditsAvailable: 'crédits disponibles', buyMore: 'Acheter plus', blockedTitle: 'Compte bloqué', blockedBody: 'Votre compte a été bloqué par la modération de contenu pour des demandes inappropriées. Vous pouvez consulter vos dossiers précédents, mais pas en générer de nouveaux.',
    yourReports: 'Vos opportunités d’affaires', total: 'au total', empty: 'Aucun dossier — créez le premier.',
    open: 'Ouvrir', processing: 'En cours…', retry: 'Réessayer',
  },
  pt: {
    dashboard: 'Painel', hi: 'Olá, ',
    sub: 'Gere novos dossiês, acompanhe os que estão rodando e administre seus créditos.',
    buyCredits: 'Comprar créditos', newReport: 'Novo dossiê',
    creditsLbl: 'Créditos', creditsSub: 'Disponíveis',
    totalLbl: 'Dossiês no total', totalSub: 'Desde o início',
    readyLbl: 'Prontos', readySub: 'Prontos para revisar',
    progressLbl: 'Em andamento', progressSub: 'Processando ou na fila',
    yourBalance: 'Seu saldo', creditsAvailable: 'créditos disponíveis', buyMore: 'Comprar mais', blockedTitle: 'Conta bloqueada', blockedBody: 'Sua conta foi bloqueada pela moderação de conteúdo por solicitações inadequadas. Você pode ver seus dossiês anteriores, mas não gerar novos.',
    yourReports: 'Suas oportunidades de negócio', total: 'no total', empty: 'Nenhum dossiê ainda — crie o primeiro.',
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
  const templates = useTemplates(lang);
  const nav = useNavigate();
  // Map a live job's progress phase → its localized step label (from the manifest).
  const stepMap: Record<string, string> = Object.fromEntries((templates.data?.templates?.[0]?.steps ?? []).map((s) => [s.id, s.label]));
  const modeLabels: Record<string, string> = Object.fromEntries((templates.data?.templates?.[0]?.modes ?? []).map((m) => [m.key, m.label]));
  const blocked = stats.data?.blocked ?? false;

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
          {!blocked && <Link className="btn btn--black" to="/app/new">+ {t.newReport}</Link>}
        </div>
      </div>

      {blocked && (
        <div className="card blocked-banner">
          <div className="blocked-banner__t">⚠ {t.blockedTitle}</div>
          <p>{t.blockedBody}</p>
          {stats.data?.blockedReason && <p className="mono muted" style={{ fontSize: 11.5, marginTop: 8 }}>{stats.data.blockedReason}</p>}
        </div>
      )}

      <div className="dash-stats">
        <div className="dash-stat--credits">
          <div className="dash-stat__lbl">{t.creditsLbl}</div>
          <div className="dash-stat__val accent">{bal ?? '…'}</div>
          <div className="dash-stat__sub">{t.creditsSub}</div>
          {!blocked && <Link className="btn btn--black btn--sm" to="/app/credits" style={{ marginTop: 14 }}>{t.buyMore}</Link>}
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
                    {j.mode && <span className="rtag">{modeLabels[j.mode] ?? j.mode}</span>}
                    {j.creditsSpent != null && <span className="rtag rtag--cr">◆ {j.creditsSpent}</span>}
                  </div>
                  <div className="dash-row__title">{j.title ?? j.jobId.slice(0, 8)}</div>
                  {meta && <div className="dash-row__meta mono">{meta}</div>}
                  {LIVE.includes(j.status) && (
                    <>
                      {j.progress && <div className="dash-row__step">{stepMap[j.progress.phase] ?? j.progress.phase}</div>}
                      <div className="dash-row__bar"><span /></div>
                    </>
                  )}
                </div>
                <div className="dash-row__actions" onClick={(e) => e.stopPropagation()}>
                  {TERMINAL.includes(j.status) && <button className="btn btn--black btn--sm" onClick={open}>{t.open}</button>}
                  {LIVE.includes(j.status) && <button className="btn btn--outline btn--sm" onClick={open}>{t.processing}</button>}
                  {j.status === 'failed' && <button className="btn btn--outline btn--sm" onClick={() => nav('/app/new')}>{t.retry}</button>}
                  {j.status === 'completed' && (
                    <DownloadPdf jobId={j.jobId} filename={`${(j.title ?? 'report').replace(/[^\w\- ]+/g, '').trim() || 'report'}.pdf`} variant="link" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
