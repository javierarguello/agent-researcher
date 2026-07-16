import { Link, useNavigate } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { useJobs } from '../api/hooks';
import { relative } from '../lib/format';
import type { JobStatus } from '../api/types';

const T = {
  en: { title: 'Your reports', sub: 'AI market research dossiers you’ve generated.', empty: 'No reports yet.', create: 'New report', report: 'Report', model: 'Model', status: 'Status', created: 'Created' },
  es: { title: 'Tus reportes', sub: 'Dossiers de research de mercado con IA que has generado.', empty: 'Aún no tienes reportes.', create: 'Nuevo reporte', report: 'Reporte', model: 'Modelo', status: 'Estado', created: 'Creado' },
  fr: { title: 'Vos rapports', sub: 'Dossiers de research de marché IA que vous avez générés.', empty: 'Aucun rapport pour l’instant.', create: 'Nouveau rapport', report: 'Rapport', model: 'Modèle', status: 'Statut', created: 'Créé' },
  pt: { title: 'Seus relatórios', sub: 'Dossiês de research de mercado com IA que você gerou.', empty: 'Nenhum relatório ainda.', create: 'Novo relatório', report: 'Relatório', model: 'Modelo', status: 'Status', created: 'Criado' },
};
const STATUS_LABEL: Record<string, Record<JobStatus, string>> = {
  en: { queued: 'Queued', running: 'Running', completed: 'Ready', failed: 'Failed', incomplete: 'Paused' },
  es: { queued: 'En cola', running: 'Corriendo', completed: 'Listo', failed: 'Falló', incomplete: 'En pausa' },
  fr: { queued: 'En file', running: 'En cours', completed: 'Prêt', failed: 'Échec', incomplete: 'En pause' },
  pt: { queued: 'Na fila', running: 'Rodando', completed: 'Pronto', failed: 'Falhou', incomplete: 'Em pausa' },
};

export function Reports() {
  const { lang } = useLang();
  const t = pick(T, lang);
  const sl = STATUS_LABEL[lang] ?? STATUS_LABEL.en!;
  const jobs = useJobs();
  const nav = useNavigate();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{t.title}</span>
          <p className="soft" style={{ fontSize: 14 }}>{t.sub}</p>
        </div>
        <Link className="btn btn--black btn--sm" to="/app/new">{t.create}</Link>
      </div>

      {jobs.isLoading && <div className="mono muted">…</div>}
      {jobs.data && jobs.data.jobs.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="soft" style={{ marginBottom: 16 }}>{t.empty}</p>
          <Link className="btn btn--black" to="/app/new">{t.create}</Link>
        </div>
      )}
      {jobs.data && jobs.data.jobs.length > 0 && (
        <div className="tablecard">
          <table className="tbl">
            <thead><tr><th>{t.report}</th><th>{t.model}</th><th>{t.status}</th><th style={{ textAlign: 'right' }}>{t.created}</th></tr></thead>
            <tbody>
              {jobs.data.jobs.map((j) => (
                <tr key={j.jobId} onClick={() => nav(`/app/jobs/${j.jobId}`)}>
                  <td><div style={{ fontWeight: 600 }}>{j.title ?? j.jobId.slice(0, 8)}</div>{j.shortDescription && <div className="muted" style={{ fontSize: 12.5 }}>{j.shortDescription}</div>}</td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{j.template}</td>
                  <td><span className={`badge ${j.status}`}>{sl[j.status] ?? j.status}</span></td>
                  <td style={{ textAlign: 'right' }} className="muted mono">{relative(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
