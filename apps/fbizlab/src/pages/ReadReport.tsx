import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useLang } from '../i18n';
import { ReportViewer } from '../components/ReportViewer';
import { DownloadPdf } from '../components/DownloadPdf';
import type { JobDetail, JobReport, TemplateManifest } from '../api/types';

/**
 * Admin "view report in app": a read-only page reached with a short-lived `?rt=`
 * token that the API scopes to reading THIS one report only. No session, no
 * navigation into the app — just the rendered report, exactly as the user sees it.
 * When the token expires (or the link is reused later) the API 401/403s and we
 * show an expired-link notice instead of the report.
 */
const T = {
  en: { banner: 'Read-only preview', missing: 'This link is missing its access token.', expired: 'This read-only link has expired or is no longer valid.', loading: 'Loading dossier…' },
  es: { banner: 'Vista de solo lectura', missing: 'Este enlace no tiene su token de acceso.', expired: 'Este enlace de solo lectura expiró o ya no es válido.', loading: 'Cargando dossier…' },
  fr: { banner: 'Aperçu en lecture seule', missing: "Ce lien n'a pas son jeton d'accès.", expired: "Ce lien en lecture seule a expiré ou n'est plus valide.", loading: 'Chargement du dossier…' },
  pt: { banner: 'Prévia somente leitura', missing: 'Este link não tem seu token de acesso.', expired: 'Este link somente leitura expirou ou não é mais válido.', loading: 'Carregando dossiê…' },
};

export function ReadReport() {
  const { jobId = '' } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('rt') ?? '';
  const { lang } = useLang();
  const t = T[lang as keyof typeof T] ?? T.en;

  const job = useQuery({
    queryKey: ['read-job', jobId, token],
    enabled: !!token && !!jobId,
    retry: false,
    queryFn: () => api<JobDetail>(`/research/${encodeURIComponent(jobId)}`, { token }),
  });
  const template = useQuery({
    queryKey: ['read-template', job.data?.template, lang, token],
    enabled: !!token && !!job.data?.template,
    retry: false,
    queryFn: () => api<TemplateManifest>(`/templates/${encodeURIComponent(job.data!.template)}?lang=${lang}`, { token }),
  });
  const report = useQuery({
    queryKey: ['read-report', jobId, token],
    enabled: !!token && job.data?.status === 'completed',
    staleTime: Infinity,
    retry: false,
    queryFn: () => api<JobReport>(`/research/${encodeURIComponent(jobId)}/report`, { token }),
  });

  const expired = [job.error, report.error, template.error].some((e) => e instanceof ApiError && (e.status === 401 || e.status === 403));

  return (
    <div className="read-shell">
      <div className="read-banner mono">
        <span>{t.banner} · Florida Biz Labs</span>
        {token && !expired && report.data && (
          <DownloadPdf jobId={jobId} token={token} filename={`${(job.data?.title ?? 'report').replace(/[^\w\- ]+/g, '').trim() || 'report'}.pdf`} variant="link" />
        )}
      </div>
      <div className="read-body">
        {!token && <Notice text={t.missing} />}
        {token && expired && <Notice text={t.expired} />}
        {token && !expired && !report.data && <Notice text={t.loading} live />}
        {token && !expired && report.data && (
          <ReportViewer
            report={report.data.report}
            sections={template.data?.sections}
            title={job.data?.title ?? undefined}
            lang={lang}
            meta={report.data.meta}
            request={{
              modeLabel: template.data?.modes?.find((m) => m.key === (job.data?.params?.mode))?.label
                ?? (job.data?.params?.mode as string | undefined) ?? null,
              languageLabel: (template.data?.paramsUi?.fields?.language?.optionLabels as Record<string, string> | undefined)?.[job.data?.params?.language as string]
                ?? (job.data?.params?.language as string | undefined) ?? null,
              sourcesFound: job.data?.summary?.sourcesFound ?? null,
              creditsSpent: job.data?.creditsSpent
                ?? template.data?.modes?.find((m) => m.key === (job.data?.params?.mode))?.credits ?? null,
            }}
          />
        )}
      </div>
    </div>
  );
}

function Notice({ text, live }: { text: string; live?: boolean }) {
  return (
    <div className="card" style={{ padding: 22, maxWidth: 620, margin: '40px auto' }}>
      <div className="row" style={{ gap: 10 }}>
        {live && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} className="rise" />}
        <span className="soft">{text}</span>
      </div>
    </div>
  );
}
