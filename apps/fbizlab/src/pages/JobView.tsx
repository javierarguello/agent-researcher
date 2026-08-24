import { Link, useParams } from 'react-router-dom';
import { pick, useLang, LANGS, type Lang } from '../i18n';
import { useJob, useJobReport, useTemplate } from '../api/hooks';
import { downloadFile } from '../api/client';
import { ReportViewer } from '../components/ReportViewer';
import { DownloadPdf } from '../components/DownloadPdf';
import { shortDate } from '../lib/format';
import { progressLine } from '../lib/progress-copy';
import type { JobStatus, StepInfo, TemplateManifest } from '../api/types';

/** Exported for `copy-parity.test.tsx`: every language must carry every key. */
export const T = {
  en: { back: '← Dossiers', working: 'Generating your dossier…', loadingReport: 'Loading dossier…', failed: 'This dossier could not be completed.', download: 'Download', files: 'Files', warnings: 'Notes', partial: 'Some sections were delivered partial.', closeOk: 'You can relax and close this page — we’ll email you as soon as your dossier is ready.' },
  es: { back: '← Dossiers', working: 'Generando tu dossier…', loadingReport: 'Cargando dossier…', failed: 'Este dossier no pudo completarse.', download: 'Descargar', files: 'Archivos', warnings: 'Notas', partial: 'Algunas secciones se entregaron parciales.', closeOk: 'Puedes cerrar esta página con tranquilidad: te avisamos por correo apenas tu dossier esté listo.' },
  fr: { back: '← Dossiers', working: 'Génération de votre dossier…', loadingReport: 'Chargement du dossier…', failed: 'Ce dossier n’a pas pu être terminé.', download: 'Télécharger', files: 'Fichiers', warnings: 'Notes', partial: 'Certaines sections ont été livrées partielles.', closeOk: 'Vous pouvez fermer cette page l’esprit tranquille : nous vous préviendrons par e-mail dès que votre dossier sera prêt.' },
  pt: { back: '← Dossiês', working: 'Gerando seu dossiê…', loadingReport: 'Carregando dossiê…', failed: 'Este dossiê não pôde ser concluído.', download: 'Baixar', files: 'Arquivos', warnings: 'Notas', partial: 'Algumas seções foram entregues parciais.', closeOk: 'Você pode fechar esta página tranquilo: avisamos por e-mail assim que seu dossiê estiver pronto.' },
};
const STATUS_LABEL: Record<string, Record<JobStatus, string>> = {
  en: { queued: 'Queued', running: 'Running', completed: 'Ready', failed: 'Failed', incomplete: 'Paused', held: 'Under review' },
  es: { queued: 'En cola', running: 'Corriendo', completed: 'Listo', failed: 'Falló', incomplete: 'En pausa', held: 'En revisión' },
  fr: { queued: 'En file', running: 'En cours', completed: 'Prêt', failed: 'Échec', incomplete: 'En pause', held: 'En révision' },
  pt: { queued: 'Na fila', running: 'Rodando', completed: 'Pronto', failed: 'Falhou', incomplete: 'Em pausa', held: 'Em revisão' },
};

export function JobView() {
  const { jobId = '' } = useParams();
  const { lang } = useLang();
  const t = pick(T, lang);
  const sl = STATUS_LABEL[lang] ?? STATUS_LABEL.en!;
  const { data: job } = useJob(jobId);
  /**
   * The report's language, not the reader's current toggle.
   *
   * The body was written once, at generation, in the language the buyer asked for.
   * The section titles come from the manifest and were being fetched in the UI
   * language — so switching the switcher put English headings over Spanish prose,
   * while the PDF of that same job (which reads `job.params.language`) kept Spanish
   * ones. A delivered document has to agree with itself; the chrome around it —
   * buttons, badges, status — still follows the UI.
   */
  const reportLang = (job?.params?.language as string | undefined) ?? lang;
  const template = useTemplate(job?.template ?? null, reportLang);
  const report = useJobReport(jobId, job?.status === 'completed');

  if (!job) return <div className="mono muted">…</div>;
  const live = job.status === 'queued' || job.status === 'running' || job.status === 'incomplete' || job.status === 'held';
  const stepsById: Record<string, StepInfo> = Object.fromEntries((template.data?.steps ?? []).map((s) => [s.id, s]));
  const step = job.progress ? stepsById[job.progress.phase] : undefined;

  // Request context folded into the report's right-rail Mandate card (no duplicate top card).
  const p = job.params ?? {};
  const modeInfo = template.data?.modes?.find((m) => m.key === p.mode);
  const modeLabel = modeInfo?.label ?? (p.mode as string | undefined) ?? null;
  const langLabel = (template.data?.paramsUi?.fields?.language?.optionLabels as Record<string, string> | undefined)?.[p.language as string] ?? (p.language as string | undefined) ?? null;
  // Fallback to the mode's standard cost for legacy jobs created before creditsSpent was stored.
  const requestCtx = { modeLabel, languageLabel: langLabel, sourcesFound: job.summary?.sourcesFound ?? null, creditsSpent: job.creditsSpent ?? modeInfo?.credits ?? null };

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
          {(() => {
            // The engine's English sentence never reaches this client; the API hands
            // it the KIND of step (and a search's query), rendered in the language of
            // the card it sits in.
            //
            // `reportLang`, not `lang`: the bold step label above comes from the
            // manifest, which is fetched in the REPORT's language, so a buyer who
            // switched the UI mid-wait read the label in one language and this line
            // in another, in the same card (round 7, R7-23). The same argument as
            // the request card below.
            const line = progressLine(job.progress, (LANGS as readonly string[]).includes(reportLang) ? (reportLang as Lang) : lang);
            return line ? <p className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>{line}</p> : null;
          })()}
          {/* A comprehensive run takes about twenty minutes, and until now this card
              said nothing about what happens if you close it — so the buyer's
              reasonable model was "if I leave, I lose it", and they watched a
              progress line for twenty minutes. The completion email has existed all
              along (`apps/worker/src/index.ts`, `notifyReportReady`).

              Gated on `job.notify`, which the API sets from the SAME condition the
              worker sends on (`emailFrom` AND `webUrl` on the app record). Without
              the gate this sentence would be a promise that happens to be true for
              one app by coincidence, and silently false for the next one — and the
              cost of that error falls on the buyer, who closes the tab and waits for
              a mail nobody sends. `lang`, not `reportLang`: this is chrome, the
              reader is being addressed right now, and it follows the switcher like
              the badge and the buttons above it. */}
          {job.notify && <p className="soft" style={{ fontSize: 13, margin: '10px 0 0' }}>{t.closeOk}</p>}
        </div>
      )}

      {/* `reportLang`, not `lang`: this card's VALUES (mode label, report language)
          come from the manifest, which is now fetched in the report's language,
          while its labels came from the UI's. Switching the switcher mid-wait
          rendered the two halves in different languages. */}
      {job.status !== 'completed' && job.params && <RequestParams params={job.params} manifest={template.data} lang={reportLang} creditsSpent={job.creditsSpent ?? modeInfo?.credits ?? null} />}

      {/* `job.error`, not a static string. The API sends this field specifically
          for the buyer, and it is where an admin's decision is explained — "and
          the credits were returned", written only once the money actually moved,
          in the buyer's language. Nothing rendered it, so a refunded buyer and a
          dismissed one read the identical sentence and neither learned anything.
          The static line stays as the fallback for a job that failed on its own. */}
      {job.status === 'failed' && <div className="card" style={{ padding: 18, borderColor: '#e6c3bd' }}><span className="risk">{job.error ?? t.failed}</span></div>}

      {job.summary?.notice && (
        <div className="card" style={{ padding: 16, background: 'var(--accent-tint)', borderColor: '#efdcb8' }}>
          <div className="eyebrow" style={{ color: 'var(--muted)', marginBottom: 6 }}>{t.warnings}</div>
          <div className="soft" style={{ fontSize: 13.5 }}>{job.summary.notice}</div>
        </div>
      )}

      {job.status === 'completed' && !report.data && (
        <div className="card" style={{ padding: 22 }}>
          <div className="row" style={{ gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} className="rise" />
            <span className="soft">{t.loadingReport}</span>
          </div>
        </div>
      )}

      {job.status === 'completed' && report.data && (
        <>
          <div className="between" style={{ alignItems: 'center' }}>
            <span className="badge completed">{sl.completed}</span>
            <DownloadPdf jobId={jobId} filename={`${(job.title ?? 'report').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'report'}.pdf`} />
          </div>
          <ReportViewer currency={template.data?.currency} cover={template.data?.cover} coverLabels={template.data?.coverLabels} report={report.data.report} sections={template.data?.sections} title={job.title ?? undefined} lang={reportLang} meta={report.data.meta} request={requestCtx} />
        </>
      )}

      {job.status === 'completed' && report.data && job.files && job.files.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div className="eyebrow" style={{ color: 'var(--muted)', marginBottom: 10 }}>{t.files}</div>
          <div className="stack" style={{ gap: 8 }}>
            {job.files.filter((f) => f.name.endsWith('.md') || f.name === 'report.json').map((f) => (
              <div key={f.name} className="between"><span className="mono" style={{ fontSize: 13 }}>{f.name}</span><button className="mono accent" style={{ fontSize: 12, background: 'none', border: 0, cursor: 'pointer' }} onClick={() => downloadFile(f.url, f.name).catch(() => {})}>{t.download} ↓</button></div>
            ))}
          </div>
          <p className="mono muted" style={{ fontSize: 10.5, marginTop: 10 }}>{shortDate(job.finishedAt, reportLang)}</p>
        </div>
      )}
    </div>
  );
}

const PL: Record<string, Record<string, string>> = {
  en: { title: 'What you asked for', industry: 'Industry', location: 'Location', mode: 'Mode', creditsSpent: 'Credits spent', language: 'Dossier language', askingPrice: 'Asking price', minRevenue: 'Min revenue', minCashFlow: 'Min cash flow', sbaFriendly: 'SBA friendly', includeRealEstate: 'Include real estate', keywords: 'Keywords', preferredSources: 'Preferred sources', instructions: 'Instructions', yes: 'Yes' },
  es: { title: 'Lo que pediste', industry: 'Industria', location: 'Ubicación', mode: 'Modo', creditsSpent: 'Créditos gastados', language: 'Idioma del dossier', askingPrice: 'Precio', minRevenue: 'Ingreso mín', minCashFlow: 'Flujo de caja mín', sbaFriendly: 'Apto SBA', includeRealEstate: 'Incluir inmueble', keywords: 'Palabras clave', preferredSources: 'Fuentes preferidas', instructions: 'Instrucciones', yes: 'Sí' },
  fr: { title: 'Ce que vous avez demandé', industry: 'Secteur', location: 'Localisation', mode: 'Mode', creditsSpent: 'Crédits dépensés', language: 'Langue du dossier', askingPrice: 'Prix', minRevenue: 'Revenu min', minCashFlow: 'Cash-flow min', sbaFriendly: 'Compatible SBA', includeRealEstate: "Inclure l'immobilier", keywords: 'Mots-clés', preferredSources: 'Sources préférées', instructions: 'Instructions', yes: 'Oui' },
  pt: { title: 'O que você pediu', industry: 'Setor', location: 'Localização', mode: 'Modo', creditsSpent: 'Créditos gastos', language: 'Idioma do dossiê', askingPrice: 'Preço', minRevenue: 'Receita mín', minCashFlow: 'Fluxo de caixa mín', sbaFriendly: 'Compatível SBA', includeRealEstate: 'Incluir imóvel', keywords: 'Palavras-chave', preferredSources: 'Fontes preferidas', instructions: 'Instruções', yes: 'Sim' },
};

function RequestParams({ params, manifest, lang, creditsSpent }: { params: Record<string, unknown>; manifest?: TemplateManifest; lang: string; creditsSpent?: number | null }) {
  const l = PL[lang] ?? PL.en!;
  const p = params;
  const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString(lang)}` : null);
  const modeLabel = manifest?.modes?.find((m) => m.key === p.mode)?.label ?? (p.mode as string | undefined);
  const langLabel = (manifest?.paramsUi?.fields?.language?.optionLabels as Record<string, string> | undefined)?.[p.language as string] ?? (p.language as string | undefined);

  const rows: Array<[string, string]> = [];
  const push = (k: string, v: string | null | undefined) => { if (v) rows.push([l[k] ?? k, v]); };
  /**
   * The model's OWN params, by the labels its manifest gave them.
   *
   * This block used to name Florida's eleven fields one by one, against a second
   * four-language map keyed by them — so a buyer of any other model saw a card
   * with nothing in it but the mode and the credits.
   */
  const fields = manifest?.paramsUi?.fields ?? {};
  const label = (k: string) => fields[k]?.label ?? l[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  // Jobs written before 2026-08-17 carry a free-text `instructions` param; newer ones do not.
  const instrKey = 'instructions';
  const ownRows = new Set(['mode', 'language', instrKey, manifest?.directivesKey ?? 'directives', ...(manifest?.paramsUi?.hidden ?? [])]);
  // A declared range renders as ONE row, the way the form collects it.
  const ranges = manifest?.paramsUi?.ranges ?? [];
  const inRange = new Set(ranges.flatMap((r) => [r.minKey, r.maxKey]));

  push('mode', modeLabel);
  if (typeof creditsSpent === 'number') rows.push([l.creditsSpent!, `◆ ${creditsSpent}`]);
  push('language', langLabel);
  for (const r of ranges) {
    const lo = money(p[r.minKey]);
    const hi = money(p[r.maxKey]);
    const span = lo && hi ? `${lo} – ${hi}` : lo ? `≥ ${lo}` : hi ? `≤ ${hi}` : null;
    if (span) rows.push([r.label, span]);
  }
  for (const [k, v] of Object.entries(p)) {
    if (ownRows.has(k) || inRange.has(k) || v == null || v === '') continue;
    if (typeof v === 'boolean') { if (v) rows.push([label(k), l.yes!]); continue; }
    if (Array.isArray(v)) { if (v.length) rows.push([label(k), v.join(', ')]); continue; }
    rows.push([label(k), typeof v === 'number' ? (money(v) ?? String(v)) : String(v)]);
  }
  const instructions = typeof p[instrKey] === 'string' ? (p[instrKey] as string) : '';

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
