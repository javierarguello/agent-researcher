import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { useCreateJob, useTemplates } from '../api/hooks';
import { ApiError } from '../api/client';
import { JsonSchemaForm, defaultsFor, type JsonSchema } from '../components/JsonSchemaForm';

const T = {
  en: { title: 'New market report', sub: 'Configure your research. The credit cost of your chosen tier is charged when you launch.', model: 'Research model', launch: 'Generate report', noCredits: 'Not enough credits — top up in Credits.' },
  es: { title: 'Nuevo reporte de mercado', sub: 'Configura tu research. Se cobra el costo en créditos del tier elegido al lanzar.', model: 'Modelo de research', launch: 'Generar reporte', noCredits: 'Créditos insuficientes — recarga en Créditos.' },
  fr: { title: 'Nouveau rapport de marché', sub: 'Configurez votre research. Le coût en crédits du niveau choisi est débité au lancement.', model: 'Modèle de research', launch: 'Générer le rapport', noCredits: 'Crédits insuffisants — rechargez dans Crédits.' },
  pt: { title: 'Novo relatório de mercado', sub: 'Configure seu research. O custo em créditos do tier escolhido é cobrado ao lançar.', model: 'Modelo de research', launch: 'Gerar relatório', noCredits: 'Créditos insuficientes — recarregue em Créditos.' },
};

export function NewReport() {
  const { lang } = useLang();
  const t = pick(T, lang);
  const templates = useTemplates(lang);
  const create = useCreateJob();
  const nav = useNavigate();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const list = templates.data?.templates ?? [];
  const selected = useMemo(() => list.find((x) => x.id === (templateId ?? list[0]?.id)) ?? null, [list, templateId]);
  const schema = selected?.paramsSchema as JsonSchema | undefined;

  useEffect(() => { if (schema) setParams(defaultsFor(schema)); }, [schema]);

  async function submit() {
    if (!selected) return;
    setError(null);
    try {
      const res = await create.mutateAsync({ template: selected.id, params });
      nav(`/app/jobs/${res.jobId}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 402 ? t.noCredits : err instanceof ApiError ? err.message : 'Failed.');
    }
  }

  return (
    <div className="stack" style={{ gap: 22, maxWidth: 760 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">{t.title}</span>
        <p className="soft" style={{ fontSize: 14 }}>{t.sub}</p>
      </div>

      {list.length > 1 && (
        <div className="field">
          <label>{t.model}</label>
          <select className="select" value={selected?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
            {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {selected && schema && (
        <div className="card" style={{ padding: 24 }}>
          <p className="soft" style={{ fontSize: 13.5, marginBottom: 18 }}>{selected.description}</p>
          <JsonSchemaForm schema={schema} ui={selected.paramsUi} modes={selected.modes} value={params} onChange={setParams} />
        </div>
      )}

      {error && <div className="mono risk" style={{ fontSize: 12.5 }}>{error}</div>}
      <div><button className="btn btn--black" onClick={submit} disabled={!selected || create.isPending}>{t.launch}</button></div>
    </div>
  );
}
