import { useState } from 'react';
import { useLang, pick } from '../i18n';
import { ensureReportPdf, ApiError } from '../api/client';

const T = {
  en: { pdf: 'PDF', download: 'Download PDF', preparing: 'Preparing PDF…', retry: 'Try again' },
  es: { pdf: 'PDF', download: 'Descargar PDF', preparing: 'Preparando PDF…', retry: 'Reintentar' },
  fr: { pdf: 'PDF', download: 'Télécharger le PDF', preparing: 'Préparation du PDF…', retry: 'Réessayer' },
  pt: { pdf: 'PDF', download: 'Baixar PDF', preparing: 'Preparando PDF…', retry: 'Tentar de novo' },
};

/**
 * Downloads a report's PDF (generated once on the server, then reused). Handles the
 * on-demand render: shows "Preparing PDF…" while it's being generated, then streams
 * the file. `variant="link"` is the compact form for report-list rows; `"button"`
 * the emphasized form for the detail page. `token` routes an admin read-only link.
 */
export function DownloadPdf({
  jobId,
  filename,
  token,
  variant = 'button',
  label,
}: {
  jobId: string;
  filename: string;
  token?: string;
  variant?: 'button' | 'link';
  label?: string;
}) {
  const { lang } = useLang();
  const t = pick(T, lang);
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');

  async function run(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'working') return;
    setState('working');
    try {
      await ensureReportPdf(jobId, filename, { token });
      setState('idle');
    } catch (err) {
      setState('error');
      if (err instanceof ApiError && err.status === 401) return; // session handled globally
    }
  }

  const text = state === 'working' ? t.preparing : state === 'error' ? t.retry : (label ?? (variant === 'link' ? t.pdf : t.download));

  if (variant === 'link') {
    return (
      <button className="mono accent pdf-link" onClick={run} disabled={state === 'working'} type="button">
        {state === 'working' ? <span className="pdf-spin" /> : '↓ '}{text}
      </button>
    );
  }
  return (
    <button className="btn btn--outline btn--sm pdf-btn" onClick={run} disabled={state === 'working'} type="button">
      {state === 'working' && <span className="pdf-spin" />}{text}
    </button>
  );
}
