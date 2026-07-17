import { Link, useParams } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { useJob, useJobReport, useTemplate } from '../api/hooks';
import { ReportViewer } from '../components/ReportViewer';
import { shortDate } from '../lib/format';
import type { JobStatus, StepInfo, TemplateManifest } from '../api/types';

const T = {
  en: { back: '← Reports', working: 'Generating your dossier…', failed: 'This report could not be completed.', download: 'Download', files: 'Files', warnings: 'Notes', partial: 'Some sections were delivered partial.' },
  es: { back: '← Reportes', working: 'Generando tu dossier…', failed: 'Este reporte no pudo completarse.', download: 'Descargar', files: 'Archivos', warnings: 'Notas', partial: 'Algunas secciones se entregaron parciales.' },
  fr: { back: '← Rapports', working: 'Génération de votre dossier…', failed: 'Ce rapport n’a pas pu être terminé.', download: 'Télécharger', files: 'Fichiers', warnings: 'Notes', partial: 'Certaines sections ont été livrées partielles.' },
  pt: { back: '← Relatórios', working: 'Gerando seu dossiê…', failed: 'Este relatório não pôde ser concluído.', download: 'Baixar', files: 'Arquivos', warnings: 'Notas', partial: 'Algumas seções foram entregues parciais.' },
};
const STATUS_LABEL: Record<string, Record<JobStatus, string>> = {
  en: { queued: 'Queued', running: 'Running', completed: 'Ready', failed: 'Failed', incomplete: 'Paused' },
  es: { queued: 'En cola', running: 'Corriendo', completed: 'Listo', failed: 'Falló', incomplete: 'En pausa' },
  fr: { queued: 'En file', running: 'En cours', completed: 'Prêt', failed: 'Échec', incomplete: 'En pause' },
  pt: { queued: 'Na fila', running: 'Rodando', completed: 'Pronto', failed: 'Falhou', incomplete: 'Em pausa' },
};

export function JobView() {
  const { jobId = '' } = useParams();
  const { lang } = useLang();
  const t = pick(T, lang);
  const sl = STATUS_LABEL[lang] ?? STATUS_LABEL.en!;
  const { data: job } = useJob(jobId);
  const template = useTemplate(job?.template ?? null, lang);
  const report = useJobReport(jobId, job?.status === 'completed');

  if (!job) return <div className="mono muted">…</div>;
  const live = job.status === 'queued' || job.status === 'running' || job.status === 'incomplete';
  const stepsById: Record<string, StepInfo> = Object.fromEntries((template.data?.steps ?? []).map((s) => [s.id, s]));
  const step = job.progress ? stepsById[job.progress.phase] : undefined;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <Link to="/app" className="mono muted" style={{ fontSize: 11 }}>{t.back}</Link>
      {job.status !== 'completed' && (
        <div className="between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 26 }}>{job.title ?? job.template}</h2>
            {job.shortDescription && <p className="soft" style={{ fontSize: 14 }}>{job.shortDescription}</p>}
          </div>
          <span className={`badge ${job.status}`}>{sl[job.status] ?? job.status}</span>
        </div>
      )}

      {live && (
        <div className="card" style={{ padding: 22 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} className="rise" />
            <span style={{ fontWeight: 700 }}>{step?.label ?? t.working}</span>
          </div>
          {step?.description && <p className="soft" style={{ fontSize: 14, margin: '6px 0 0' }}>{step.description}</p>}
          {job.progress?.message && <p className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>{job.progress.message}</p>}
        </div>
      )}

      {live && job.params && <RequestParams params={job.params} manifest={template.data} lang={lang} />}

      {job.status === 'failed' && <div className="card" style={{ padding: 18, borderColor: '#e6c3bd' }}><span className="risk">{t.failed}</span></div>}

      {job.summary?.warnings && job.summary.warnings.length > 0 && (
        <div className="card" style={{ padding: 16, background: 'var(--accent-tint)', borderColor: '#efdcb8' }}>
          <div className="eyebrow" style={{ color: 'var(--muted)', marginBottom: 6 }}>{t.warnings}</div>
          {job.summary.warnings.map((w, i) => <div key={i} className="soft" style={{ fontSize: 13.5 }}>{w}</div>)}
        </div>
      )}

      {job.status === 'completed' && report.data && (
        <ReportViewer report={report.data.report} sections={template.data?.sections} title={job.title ?? undefined} lang={lang} />
      )}

      {job.status === 'completed' && job.files && job.files.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ color: 'var(--muted)', marginBottom: 10 }}>{t.files}</div>
          <div className="stack" style={{ gap: 8 }}>
            {job.files.filter((f) => f.name.endsWith('.md') || f.name === 'report.json').map((f) => (
              <div key={f.name} className="between"><span className="mono" style={{ fontSize: 13 }}>{f.name}</span><a className="mono accent" style={{ fontSize: 12 }} href={f.url} target="_blank" rel="noreferrer">{t.download} ↓</a></div>
            ))}
          </div>
          <p className="mono muted" style={{ fontSize: 10.5, marginTop: 10 }}>{shortDate(job.finishedAt)}</p>
        </div>
      )}
    </div>
  );
}

const PL: Record<string, Record<string, string>> = {
  en: { title: 'What you asked for', industry: 'Industry', location: 'Location', mode: 'Mode', language: 'Report language', askingPrice: 'Asking price', minRevenue: 'Min revenue', minCashFlow: 'Min cash flow', sbaFriendly: 'SBA friendly', includeRealEstate: 'Include real estate', keywords: 'Keywords', preferredSources: 'Preferred sources', instructions: 'Instructions', yes: 'Yes' },
  es: { title: 'Lo que pediste', industry: 'Industria', location: 'Ubicación', mode: 'Modo', language: 'Idioma del reporte', askingPrice: 'Precio', minRevenue: 'Ingreso mín', minCashFlow: 'Flujo de caja mín', sbaFriendly: 'Apto SBA', includeRealEstate: 'Incluir inmueble', keywords: 'Palabras clave', preferredSources: 'Fuentes preferidas', instructions: 'Instrucciones', yes: 'Sí' },
  fr: { title: 'Ce que vous avez demandé', industry: 'Secteur', location: 'Localisation', mode: 'Mode', language: 'Langue du rapport', askingPrice: 'Prix', minRevenue: 'Revenu min', minCashFlow: 'Cash-flow min', sbaFriendly: 'Compatible SBA', includeRealEstate: "Inclure l'immobilier", keywords: 'Mots-clés', preferredSources: 'Sources préférées', instructions: 'Instructions', yes: 'Oui' },
  pt: { title: 'O que você pediu', industry: 'Setor', location: 'Localização', mode: 'Modo', language: 'Idioma do relatório', askingPrice: 'Preço', minRevenue: 'Receita mín', minCashFlow: 'Fluxo de caixa mín', sbaFriendly: 'Compatível SBA', includeRealEstate: 'Incluir imóvel', keywords: 'Palavras-chave', preferredSources: 'Fontes preferidas', instructions: 'Instruções', yes: 'Sim' },
};

function RequestParams({ params, manifest, lang }: { params: Record<string, unknown>; manifest?: TemplateManifest; lang: string }) {
  const l = PL[lang] ?? PL.en!;
  const p = params;
  const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString(lang)}` : null);
  const modeLabel = manifest?.modes?.find((m) => m.key === p.mode)?.label ?? (p.mode as string | undefined);
  const langLabel = (manifest?.paramsUi?.fields?.language?.optionLabels as Record<string, string> | undefined)?.[p.language as string] ?? (p.language as string | undefined);
  const priceMin = money(p.askingPriceMin);
  const priceMax = money(p.askingPriceMax);
  const price = priceMin && priceMax ? `${priceMin} – ${priceMax}` : priceMin ? `≥ ${priceMin}` : priceMax ? `≤ ${priceMax}` : null;

  const rows: Array<[string, string]> = [];
  const push = (k: string, v: string | null | undefined) => { if (v) rows.push([l[k] ?? k, v]); };
  push('industry', p.industry as string);
  push('location', p.location as string);
  push('mode', modeLabel);
  push('language', langLabel);
  push('askingPrice', price);
  push('minRevenue', money(p.minRevenue));
  push('minCashFlow', money(p.minCashFlow));
  if (p.sbaFriendly) rows.push([l.sbaFriendly!, l.yes!]);
  if (p.includeRealEstate) rows.push([l.includeRealEstate!, l.yes!]);
  if (Array.isArray(p.keywords) && p.keywords.length) rows.push([l.keywords!, (p.keywords as string[]).join(', ')]);
  if (Array.isArray(p.preferredSources) && p.preferredSources.length) rows.push([l.preferredSources!, (p.preferredSources as string[]).join(', ')]);
  const instructions = typeof p.instructions === 'string' ? p.instructions : '';

  if (!rows.length && !instructions) return null;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 12 }}>{l.title}</div>
      <div className="nr-sumrows" style={{ margin: 0, borderTop: 0 }}>
        {rows.map(([k, v]) => <div key={k}><span>{k}</span><b style={{ textAlign: 'right', maxWidth: '60%' }}>{v}</b></div>)}
      </div>
      {instructions && (
        <div style={{ marginTop: 14 }}>
          <div className="rv-flabel">{l.instructions}</div>
          <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{instructions}</p>
        </div>
      )}
    </div>
  );
}
