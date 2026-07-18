import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { useBalance, useCreateJob, useMyStats, usePreflight, useTemplates, type PreflightResult } from '../api/hooks';
import { ApiError, DRAFT_KEY } from '../api/client';
import type { ParamsUi } from '../api/types';

type Props = Record<string, unknown>;

const T = {
  en: {
    dash: 'Dashboard', crumb: 'New dossier', title: 'New AI dossier.',
    s1: 'What & where', s1h: "Define what you're hunting for.",
    s2: 'Dossier mode', s2h: 'How deep you want it.',
    s3: 'Deal filters', s3h: 'All optional — leave blank if not relevant.',
    s4: 'Instructions for the analyst', s4h: "Free-form guidance for the analysts (lower authority than the model's base rules).",
    s5: 'Advanced', show: '+ Show', hide: '− Hide', step: 'Step', of: 'of', back: 'Back', next: 'Next',
    reportLanguage: 'Dossier language', reportLangHelp: 'The language the final dossier is written in.',
    f: { industry: 'Industry', location: 'Location', askingPriceMin: 'Asking price · Min', askingPriceMax: 'Asking price · Max', minRevenue: 'Min revenue', minCashFlow: 'Min cash flow', keywords: 'Keywords', preferredSources: 'Preferred sources' } as Record<string, string>,
    sba: 'SBA friendly', realEstate: 'Include real estate',
    optionalUseful: 'Optional but very useful', add: 'Add and press Enter',
    industryWarn: 'No industry set — tell the analysts what to research in the Instructions below (at least 40 characters).', instrReq: 'Required — no industry set', charsToGo: 'more characters needed',
    summary: 'Summary', pickIndustry: 'Pick an industry', mode: 'Mode', language: 'Language',
    cost: 'Cost', credits: 'credits', generate: 'Generate dossier', delivered: 'Delivered in 2–8 min',
    review: 'Review', confirmTitle: 'Confirm and generate', confirmSub: 'Review your dossier request before we start the research.', goBack: 'Go back', confirmGenerate: 'Confirm & generate',
    youHave: 'You have', creditsLeft: 'credits',
    notEnough: 'Not enough credits — buy more first.', buyCredits: 'Buy credits', alreadyRunning: 'You already have a dossier in progress — wait for it to finish before starting another.',
    rejected: 'Your request couldn’t be submitted:', blockedNote: 'Your account is blocked:', emailNotice: 'We’ll email you when your dossier is ready.',
    validateContinue: 'Validate & continue', preparing: 'Preparing summary…', whatWeWillSearch: 'What we’ll search', suggestionsTitle: 'Suggestions to sharpen your results', rateLimited: 'You’ve run too many previews without generating a report.', tryAgainIn: 'Try again in',
    noCredits: 'Not enough credits — buy more first.', yes: 'Yes',
    modeDesc: { essential: 'Core sections. Roughly half the cost. Great for early scanning.', comprehensive: 'Full long-form dossier: valuations, comparables, diligence, playbook.' } as Record<string, string>,
  },
  es: {
    dash: 'Panel', crumb: 'Nuevo dossier', title: 'Nuevo dossier con IA.',
    s1: 'Qué y dónde', s1h: 'Define qué estás buscando.',
    s2: 'Modo del dossier', s2h: 'Qué tan a fondo lo quieres.',
    s3: 'Filtros del deal', s3h: 'Todos opcionales — deja en blanco si no aplica.',
    s4: 'Instrucciones para el analista', s4h: 'Guía libre para los analistas (menor autoridad que las reglas base del modelo).',
    s5: 'Avanzado', show: '+ Mostrar', hide: '− Ocultar', step: 'Paso', of: 'de', back: 'Atrás', next: 'Siguiente',
    reportLanguage: 'Idioma del dossier', reportLangHelp: 'El idioma en que se escribe el dossier final.',
    f: { industry: 'Industria', location: 'Ubicación', askingPriceMin: 'Precio · Mín', askingPriceMax: 'Precio · Máx', minRevenue: 'Ingreso mín', minCashFlow: 'Flujo de caja mín', keywords: 'Palabras clave', preferredSources: 'Fuentes preferidas' } as Record<string, string>,
    sba: 'Apto SBA', realEstate: 'Incluir inmueble',
    optionalUseful: 'Opcional pero muy útil', add: 'Escribe y presiona Enter',
    industryWarn: 'Sin industria — dile a los analistas qué investigar en las Instrucciones abajo (al menos 40 caracteres).', instrReq: 'Requerido — sin industria', charsToGo: 'caracteres más',
    summary: 'Resumen', pickIndustry: 'Elige una industria', mode: 'Modo', language: 'Idioma',
    cost: 'Costo', credits: 'créditos', generate: 'Generar dossier', delivered: 'Listo en 2–8 min',
    review: 'Revisar', confirmTitle: 'Confirma y genera', confirmSub: 'Revisa tu solicitud de dossier antes de empezar la investigación.', goBack: 'Volver', confirmGenerate: 'Confirmar y generar',
    youHave: 'Tienes', creditsLeft: 'créditos',
    notEnough: 'Créditos insuficientes — compra más primero.', buyCredits: 'Comprar créditos', alreadyRunning: 'Ya tienes un dossier en progreso — espera a que termine antes de iniciar otro.',
    rejected: 'No pudimos enviar tu solicitud:', blockedNote: 'Tu cuenta está bloqueada:', emailNotice: 'Te enviaremos un email cuando tu dossier esté listo.',
    validateContinue: 'Validar y continuar', preparing: 'Preparando resumen…', whatWeWillSearch: 'Lo que buscaremos', suggestionsTitle: 'Sugerencias para afinar tus resultados', rateLimited: 'Hiciste demasiadas vistas previas sin generar un reporte.', tryAgainIn: 'Intenta de nuevo en',
    noCredits: 'Créditos insuficientes — compra más primero.', yes: 'Sí',
    modeDesc: { essential: 'Secciones núcleo. Aproximadamente la mitad del costo. Ideal para explorar.', comprehensive: 'Dossier largo completo: valoraciones, comparables, due diligence, playbook.' } as Record<string, string>,
  },
  fr: {
    dash: 'Tableau de bord', crumb: 'Nouveau dossier', title: 'Nouveau dossier IA.',
    s1: 'Quoi et où', s1h: 'Définissez ce que vous cherchez.',
    s2: 'Mode du dossier', s2h: 'Le niveau de profondeur.',
    s3: 'Filtres du deal', s3h: 'Tous optionnels — laissez vide si non pertinent.',
    s4: "Instructions pour l'analyste", s4h: "Consignes libres pour les analystes (autorité inférieure aux règles de base du modèle).",
    s5: 'Avancé', show: '+ Afficher', hide: '− Masquer', step: 'Étape', of: 'de', back: 'Retour', next: 'Suivant',
    reportLanguage: 'Langue du dossier', reportLangHelp: 'La langue de rédaction du dossier final.',
    f: { industry: 'Secteur', location: 'Localisation', askingPriceMin: 'Prix · Min', askingPriceMax: 'Prix · Max', minRevenue: 'Revenu min', minCashFlow: 'Cash-flow min', keywords: 'Mots-clés', preferredSources: 'Sources préférées' } as Record<string, string>,
    sba: 'Compatible SBA', realEstate: "Inclure l'immobilier",
    optionalUseful: 'Optionnel mais très utile', add: 'Saisissez et appuyez sur Entrée',
    industryWarn: 'Aucun secteur — indiquez aux analystes quoi rechercher dans les Instructions ci-dessous (au moins 40 caractères).', instrReq: 'Requis — aucun secteur', charsToGo: 'caractères manquants',
    summary: 'Résumé', pickIndustry: 'Choisissez un secteur', mode: 'Mode', language: 'Langue',
    cost: 'Coût', credits: 'crédits', generate: 'Générer le dossier', delivered: 'Livré en 2–8 min',
    review: 'Vérifier', confirmTitle: 'Confirmer et générer', confirmSub: 'Vérifiez votre demande de dossier avant de lancer la recherche.', goBack: 'Retour', confirmGenerate: 'Confirmer et générer',
    youHave: 'Vous avez', creditsLeft: 'crédits',
    notEnough: 'Crédits insuffisants — achetez-en d’abord.', buyCredits: 'Acheter des crédits', alreadyRunning: 'Vous avez déjà un dossier en cours — attendez qu’il se termine avant d’en lancer un autre.',
    rejected: 'Votre demande n’a pas pu être envoyée :', blockedNote: 'Votre compte est bloqué :', emailNotice: 'Nous vous enverrons un email quand votre dossier sera prêt.',
    validateContinue: 'Valider et continuer', preparing: 'Préparation du résumé…', whatWeWillSearch: 'Ce que nous chercherons', suggestionsTitle: 'Suggestions pour affiner vos résultats', rateLimited: 'Vous avez lancé trop d’aperçus sans générer de rapport.', tryAgainIn: 'Réessayez dans',
    noCredits: 'Crédits insuffisants — achetez-en d’abord.', yes: 'Oui',
    modeDesc: { essential: 'Sections clés. Environ moitié du coût. Idéal pour un premier tri.', comprehensive: 'Dossier long complet : valorisations, comparables, due diligence, playbook.' } as Record<string, string>,
  },
  pt: {
    dash: 'Painel', crumb: 'Novo dossiê', title: 'Novo dossiê com IA.',
    s1: 'O quê e onde', s1h: 'Defina o que você procura.',
    s2: 'Modo do dossiê', s2h: 'O quão a fundo você quer.',
    s3: 'Filtros do deal', s3h: 'Todos opcionais — deixe em branco se não se aplica.',
    s4: 'Instruções para o analista', s4h: 'Orientação livre para os analistas (autoridade menor que as regras base do modelo).',
    s5: 'Avançado', show: '+ Mostrar', hide: '− Ocultar', step: 'Passo', of: 'de', back: 'Voltar', next: 'Próximo',
    reportLanguage: 'Idioma do dossiê', reportLangHelp: 'O idioma em que o dossiê final é escrito.',
    f: { industry: 'Setor', location: 'Localização', askingPriceMin: 'Preço · Mín', askingPriceMax: 'Preço · Máx', minRevenue: 'Receita mín', minCashFlow: 'Fluxo de caixa mín', keywords: 'Palavras-chave', preferredSources: 'Fontes preferidas' } as Record<string, string>,
    sba: 'Compatível SBA', realEstate: 'Incluir imóvel',
    optionalUseful: 'Opcional mas muito útil', add: 'Digite e pressione Enter',
    industryWarn: 'Sem setor — diga aos analistas o que pesquisar nas Instruções abaixo (ao menos 40 caracteres).', instrReq: 'Obrigatório — sem setor', charsToGo: 'caracteres a mais',
    summary: 'Resumo', pickIndustry: 'Escolha um setor', mode: 'Modo', language: 'Idioma',
    cost: 'Custo', credits: 'créditos', generate: 'Gerar dossiê', delivered: 'Pronto em 2–8 min',
    review: 'Revisar', confirmTitle: 'Confirme e gere', confirmSub: 'Revise sua solicitação de dossiê antes de começar a pesquisa.', goBack: 'Voltar', confirmGenerate: 'Confirmar e gerar',
    youHave: 'Você tem', creditsLeft: 'créditos',
    notEnough: 'Créditos insuficientes — compre mais primeiro.', buyCredits: 'Comprar créditos', alreadyRunning: 'Você já tem um dossiê em andamento — aguarde ele terminar antes de iniciar outro.',
    rejected: 'Não foi possível enviar sua solicitação:', blockedNote: 'Sua conta está bloqueada:', emailNotice: 'Enviaremos um email quando seu dossiê estiver pronto.',
    validateContinue: 'Validar e continuar', preparing: 'Preparando resumo…', whatWeWillSearch: 'O que vamos buscar', suggestionsTitle: 'Sugestões para refinar seus resultados', rateLimited: 'Você fez pré-visualizações demais sem gerar um relatório.', tryAgainIn: 'Tente novamente em',
    noCredits: 'Créditos insuficientes — compre mais primeiro.', yes: 'Sim',
    modeDesc: { essential: 'Seções principais. Cerca da metade do custo. Ótimo para triagem inicial.', comprehensive: 'Dossiê longo completo: valuations, comparáveis, due diligence, playbook.' } as Record<string, string>,
  },
};

/** Section header: NN · Title ............ hint */
function SecHead({ n, title, hint, right }: { n: string; title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="nr-sechead">
      <div className="nr-sectitle"><span className="nr-num">{n}</span>{title}</div>
      {right ?? (hint && <span className="nr-hint">{hint}</span>)}
    </div>
  );
}

/** Minimal tags input for the advanced arrays. */
function Tags({ value, onChange, suggestions, placeholder }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = (s: string) => { const v = s.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div className="tags">
      {value.map((tag) => (
        <span key={tag} className="badge" style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((x) => x !== tag))}>{tag} ✕</span>
      ))}
      <input list="nr-sugg" value={draft} placeholder={value.length ? '' : placeholder} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } }} />
      {suggestions && <datalist id="nr-sugg">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

interface Prop { type?: string; enum?: string[]; maxLength?: number; default?: unknown; }
type Schema = { properties?: Record<string, Prop>; required?: string[] };

/** When no industry is given, instructions must be at least this long (mirrors the API). */
const MIN_INSTR = 40;

/** Compact "2h 05m" / "8m" / "45s" duration for rate-limit wait messages. */
function fmtWait(secs: number): string {
  if (secs >= 3600) { const h = Math.floor(secs / 3600); const m = Math.round((secs % 3600) / 60); return `${h}h ${String(m).padStart(2, '0')}m`; }
  if (secs >= 60) return `${Math.round(secs / 60)}m`;
  return `${Math.max(1, Math.round(secs))}s`;
}
/** On mobile the long form becomes a step-by-step wizard. */
const WIZARD_STEPS = 4;

function useIsMobile(query = '(max-width: 860px)'): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export function NewReport() {
  const { lang } = useLang();
  const t = pick(T, lang);
  const templates = useTemplates(lang);
  const balance = useBalance();
  const stats = useMyStats();
  const create = useCreateJob();
  const preflight = usePreflight();
  const nav = useNavigate();
  const [params, setParams] = useState<Props>({});
  const [advOpen, setAdvOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-flight validation: the result + the exact params it was run for (so editing
  // re-triggers validation, but re-opening the dialog for the same params does not).
  const [pf, setPf] = useState<PreflightResult | null>(null);
  const [validatedKey, setValidatedKey] = useState<string | null>(null);
  // A rate-limit "wait until" (epoch ms) + reason — disables Generate meanwhile.
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const isMobile = useIsMobile();
  const [step, setStep] = useState(0);
  // On mobile, only the current wizard step's section(s) are shown. Groups:
  // 0=What&where, 1=Report mode, 2=Deal filters, 3=Instructions+Advanced.
  const stepOf = (g: number) => (!isMobile || g === step ? undefined : ({ display: 'none' } as const));

  const model = templates.data?.templates?.[0];
  const schema = model?.paramsSchema as Schema | undefined;
  const ui: ParamsUi | undefined = model?.paramsUi;
  const props = schema?.properties ?? {};
  const set = (k: string, v: unknown) => setParams((p) => ({ ...p, [k]: v }));

  // Initialise once: restore a saved draft (returning from buying credits) so no
  // input is lost; otherwise schema defaults with report language = UI language.
  const inited = useRef(false);
  useEffect(() => {
    if (!schema || inited.current) return;
    inited.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) { setParams(JSON.parse(raw)); return; }
    } catch { /* ignore a corrupt draft */ }
    const d: Props = {};
    for (const [k, p] of Object.entries(schema.properties ?? {})) if (p.default !== undefined) d[k] = p.default;
    d.mode = d.mode ?? model?.modes?.[0]?.key ?? 'essential';
    d.language = lang;
    setParams(d);
  }, [schema, model?.modes, lang]);

  // While rate-limited, tick so the countdown updates and the button re-enables.
  useEffect(() => {
    if (waitUntil == null || waitUntil <= Date.now()) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitUntil]);

  const modes = model?.modes ?? [];
  const mode = (params.mode as string) ?? modes[0]?.key;
  const cost = modes.find((m) => m.key === mode)?.credits ?? 0;
  const langOpts = props.language?.enum ?? ['en'];
  const langLabels = (ui?.fields?.language?.optionLabels ?? {}) as Record<string, string>;
  const help = (k: string) => ui?.fields?.[k]?.help;
  const ph = (k: string) => ui?.fields?.[k]?.placeholder;
  const industry = (params.industry as string) ?? '';
  const instrText = ((params.instructions as string) ?? '').trim();
  // Industry is optional; without it, instructions must carry enough context.
  const needsInstr = !industry.trim();
  const instrOk = !needsInstr || instrText.length >= MIN_INSTR;
  const bal = balance.data?.balance;
  // Only one report may be in flight per user (until it finishes or fails).
  const hasLive = (stats.data?.inProgress ?? 0) >= 1;
  const blocked = stats.data?.blocked ?? false;
  const cleanParams = (): Props => {
    const c: Props = { ...params };
    Object.keys(c).forEach((k) => { if (c[k] === undefined || c[k] === '') delete c[k]; });
    return c;
  };
  const paramsKey = JSON.stringify(cleanParams());
  const validated = validatedKey === paramsKey && pf != null; // already previewed these exact params
  const waitSecs = waitUntil != null ? Math.max(0, Math.ceil((waitUntil - nowTick) / 1000)) : 0;
  const rateLimited = waitSecs > 0;
  const canGo = instrOk && !hasLive && !blocked && !rateLimited && !create.isPending && !preflight.isPending;
  const insufficient = typeof bal === 'number' && bal < cost;
  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(params)); } catch { /* ignore */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  // Not enough credits → keep every input and send them to buy; they come back here.
  const goBuy = () => { saveDraft(); setConfirming(false); nav('/app/credits'); };

  const numField = (key: string) => {
    const v = params[key];
    return (
      <div className="field">
        <label>{t.f[key] ?? key}</label>
        <div className="nr-money">
          <span>$</span>
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="0"
            value={v == null ? '' : String(v)}
            onChange={(e) => set(key, e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0))} />
        </div>
        {help(key) && <div className="desc">{help(key)}</div>}
      </div>
    );
  };
  const checkField = (key: string, label: string) => (
    <label className="checkcard">
      <input type="checkbox" checked={!!params[key]} onChange={(e) => set(key, e.target.checked)} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        {help(key) && <div className="desc" style={{ marginTop: 3 }}>{help(key)}</div>}
      </div>
    </label>
  );

  const startWait = (secs: number) => setWaitUntil(Date.now() + Math.max(1, secs) * 1000);

  // Step 1: moderation + AI validation preview. Shown in the dialog (once per params).
  async function runPreflight() {
    setError(null);
    try {
      const res = await preflight.mutateAsync({ template: model!.id, params: cleanParams() });
      setPf(res);
      setValidatedKey(paramsKey);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setConfirming(false);
        startWait(err.retryAfterSeconds ?? 8 * 3600);
        setError(`${t.rateLimited} ${t.tryAgainIn} ${fmtWait(err.retryAfterSeconds ?? 8 * 3600)}.`);
      } else if (err instanceof ApiError && err.status === 422) {
        setConfirming(false);
        setError(`${t.rejected} ${err.message}`);
      } else if (err instanceof ApiError && err.status === 403) {
        setConfirming(false);
        setError(`${t.blockedNote} ${err.message}`);
        stats.refetch();
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed.');
      }
    }
  }

  // Step 2: actually create the job (moderation runs again server-side).
  async function submit() {
    setError(null);
    try {
      const res = await create.mutateAsync({ template: model!.id, params: cleanParams() });
      clearDraft();
      nav(`/app/jobs/${res.jobId}`);
    } catch (err) {
      setConfirming(false); // surface the error on the form, not the dialog
      if (err instanceof ApiError && err.status === 429) {
        startWait(err.retryAfterSeconds ?? 3600);
        setError(`${err.message}`);
      } else {
        setError(
          err instanceof ApiError && err.status === 402 ? t.noCredits
            : err instanceof ApiError && err.status === 409 ? t.alreadyRunning
              : err instanceof ApiError && err.status === 422 ? `${t.rejected} ${err.message}`
                : err instanceof ApiError && err.status === 403 ? `${t.blockedNote} ${err.message}`
                  : err instanceof ApiError ? err.message : 'Failed.',
        );
        if (err instanceof ApiError && err.status === 403) stats.refetch();
      }
    }
  }

  const instrMax = props.instructions?.maxLength ?? 2000;
  const instr = (params.instructions as string) ?? '';

  return (
    <div className="nr">
      <div className="nr-hero">
        <Link to="/app" className="nr-crumb"><span className="mono muted">← {t.dash}</span> <span className="mono" style={{ color: 'var(--accent)' }}>/ {t.crumb}</span></Link>
        <h1 className="nr-title">{t.title}</h1>
        {model?.description && <p className="nr-desc">{model.description}</p>}
      </div>

      <div className="nr-grid">
          <div className="nr-form">
            {isMobile && (
              <div className="wiz-top">
                <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>{t.step} {step + 1} {t.of} {WIZARD_STEPS}</span>
                <div className="wiz-bar"><span style={{ width: `${((step + 1) / WIZARD_STEPS) * 100}%` }} /></div>
              </div>
            )}

            {/* 01 What & where */}
            <section className="nr-sec" style={stepOf(0)}>
              <SecHead n="01" title={t.s1} hint={t.s1h} />
              <div className="nr-row">
                <div className="field">
                  <label>{t.f.industry}</label>
                  <input className="input" maxLength={props.industry?.maxLength ?? 120} placeholder={ph('industry')} value={industry} onChange={(e) => set('industry', e.target.value)} />
                  <div className="chips">
                    {(ui?.fields?.industry?.suggestions ?? []).map((s) => (
                      <button type="button" key={s} className={`chip ${industry === s ? 'sel' : ''}`} onClick={() => set('industry', s)}>{s}</button>
                    ))}
                  </div>
                  {help('industry') && <div className="desc">{help('industry')}</div>}
                  {needsInstr && <div className="nr-warn">{t.industryWarn}</div>}
                </div>
                <div className="field">
                  <label>{t.f.location}</label>
                  <input className="input" maxLength={props.location?.maxLength ?? 200} placeholder={ph('location')} value={(params.location as string) ?? ''} onChange={(e) => set('location', e.target.value)} />
                  {help('location') && <div className="desc">{help('location')}</div>}
                </div>
              </div>
            </section>

            {/* 02 Report mode */}
            <section className="nr-sec" style={stepOf(1)}>
              <SecHead n="02" title={t.s2} hint={t.s2h} />
              <div className="modecards">
                {modes.map((m) => (
                  <button type="button" key={m.key} className={`modecard ${mode === m.key ? 'sel' : ''}`} onClick={() => set('mode', m.key)}>
                    <div className="between" style={{ alignItems: 'center' }}>
                      <div style={{ fontWeight: 800, fontSize: 18 }}>{m.label}</div>
                      <span className={`modecard__cr ${mode === m.key ? 'on' : ''}`}>{m.credits} {t.credits}</span>
                    </div>
                    <p className="desc" style={{ marginTop: 8 }}>{t.modeDesc[m.key] ?? ''}</p>
                  </button>
                ))}
              </div>
              <div className="field" style={{ marginTop: 20 }}>
                <label>{t.reportLanguage}</label>
                <div className="langtoggle">
                  {langOpts.map((l) => (
                    <button type="button" key={l} className={params.language === l ? 'sel' : ''} onClick={() => set('language', l)}>{langLabels[l] ?? l}</button>
                  ))}
                </div>
                <div className="desc">{t.reportLangHelp}</div>
              </div>
            </section>

            {/* 03 Deal filters */}
            <section className="nr-sec" style={stepOf(2)}>
              <SecHead n="03" title={t.s3} hint={t.s3h} />
              <div className="nr-row">{numField('askingPriceMin')}{numField('askingPriceMax')}</div>
              <div className="nr-row">{numField('minRevenue')}{numField('minCashFlow')}</div>
              <div className="nr-row">{checkField('sbaFriendly', t.sba)}{checkField('includeRealEstate', t.realEstate)}</div>
            </section>

            {/* 04 Instructions */}
            <section className="nr-sec" style={stepOf(3)}>
              <SecHead n="04" title={needsInstr ? `${t.s4} *` : t.s4} hint={t.s4h} />
              <textarea className="textarea" rows={6} maxLength={instrMax} placeholder={ph('instructions')} value={instr} onChange={(e) => set('instructions', e.target.value)} />
              <div className="between" style={{ marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: needsInstr && !instrOk ? 'var(--risk)' : 'var(--muted)' }}>{needsInstr ? t.instrReq : t.optionalUseful}</span>
                <span className="mono muted" style={{ fontSize: 10.5 }}>
                  {needsInstr && !instrOk ? `${MIN_INSTR - instrText.length} ${t.charsToGo}` : `${instr.length} / ${instrMax}`}
                </span>
              </div>
            </section>

            {/* 05 Advanced */}
            <section className="nr-sec" style={stepOf(3)}>
              <SecHead n="05" title={t.s5} right={<button type="button" className="nr-hint" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setAdvOpen((o) => !o)}>{advOpen ? t.hide : t.show}</button>} />
              {advOpen && (
                <div className="stack" style={{ gap: 16, paddingTop: 4 }}>
                  <div className="field">
                    <label>{t.f.keywords}</label>
                    <Tags value={(params.keywords as string[]) ?? []} onChange={(v) => set('keywords', v)} suggestions={ui?.fields?.keywords?.suggestions} placeholder={t.add} />
                    {help('keywords') && <div className="desc">{help('keywords')}</div>}
                  </div>
                  <div className="field">
                    <label>{t.f.preferredSources}</label>
                    <Tags value={(params.preferredSources as string[]) ?? []} onChange={(v) => set('preferredSources', v)} suggestions={ui?.fields?.preferredSources?.suggestions} placeholder={t.add} />
                    {help('preferredSources') && <div className="desc">{help('preferredSources')}</div>}
                  </div>
                </div>
              )}
            </section>

            {isMobile && step === WIZARD_STEPS - 1 && (rateLimited || hasLive || error) && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--risk)', marginTop: 12, lineHeight: 1.5 }}>
                {rateLimited ? <>{t.rateLimited} {t.tryAgainIn} <b>{fmtWait(waitSecs)}</b>.</> : hasLive ? t.alreadyRunning : error}
              </div>
            )}
            {isMobile && (
              <div className="wiz-nav">
                <button className="btn btn--outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{t.back}</button>
                {step < WIZARD_STEPS - 1 ? (
                  <button className="btn btn--black" onClick={() => setStep((s) => Math.min(WIZARD_STEPS - 1, s + 1))}>{t.next}</button>
                ) : (
                  <button className="btn btn--black" disabled={!canGo} onClick={() => setConfirming(true)}>{t.generate}</button>
                )}
              </div>
            )}
          </div>

          {/* Sticky summary — hidden on mobile; the confirm dialog reviews everything. */}
          {!isMobile && (
          <aside className="nr-summary">
            <div className="nr-sumcard">
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>{t.summary}</div>
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', marginTop: 10 }}>{industry.trim() || t.pickIndustry}</div>
              <div className="mono muted" style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 4 }}>{(params.location as string) || '—'}</div>

              <div className="nr-sumrows">
                <div><span>{t.mode}</span><b>{modes.find((m) => m.key === mode)?.label ?? '—'}</b></div>
                <div><span>{t.language}</span><b>{langLabels[params.language as string] ?? (params.language as string) ?? '—'}</b></div>
                <div><span>{t.sba}</span><b>{params.sbaFriendly ? t.yes : '—'}</b></div>
                <div><span>{t.realEstate}</span><b>{params.includeRealEstate ? t.yes : '—'}</b></div>
              </div>

              <div className="nr-cost">
                <span className="mono muted" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' }}>{t.cost}</span>
                <span><b className="accent" style={{ fontSize: 30, fontWeight: 800 }}>{cost}</b> <span className="mono muted" style={{ fontSize: 12 }}>{t.credits}</span></span>
              </div>
              {bal != null && <div className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2, color: insufficient ? 'var(--risk)' : 'var(--muted)' }}>{t.youHave} {bal} {t.creditsLeft}</div>}

              {insufficient && (
                <>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--risk)', marginTop: 10, lineHeight: 1.5 }}>{t.notEnough}</div>
                  <button className="btn btn--outline btn--block" style={{ marginTop: 10 }} onClick={goBuy}>{t.buyCredits}</button>
                </>
              )}

              {hasLive && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--risk)', marginTop: 12, lineHeight: 1.5 }}>
                  {t.alreadyRunning} <Link to="/app" className="accent">→</Link>
                </div>
              )}

              {rateLimited && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--risk)', marginTop: 12, lineHeight: 1.5 }}>
                  {t.rateLimited} {t.tryAgainIn} <b>{fmtWait(waitSecs)}</b>.
                </div>
              )}

              {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginTop: 12 }}>{error}</div>}

              <button className="btn btn--black btn--block" style={{ marginTop: 16 }} disabled={!canGo} onClick={() => setConfirming(true)}>{t.generate}</button>
              <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'center', marginTop: 12 }}>{t.delivered}</div>
            </div>
          </aside>
          )}
        </div>

      {confirming && (
        <div className="modal-overlay" onClick={() => !create.isPending && !preflight.isPending && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>{t.review}</div>
              <h2 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', margin: '8px 0 6px' }}>{t.confirmTitle}</h2>
              <p className="soft" style={{ fontSize: 14 }}>{t.confirmSub}</p>
            </div>
            <div className="modal__body">
              {preflight.isPending ? (
                <div className="pf-prep">
                  <div className="pf-dots"><span /><span style={{ animationDelay: '.15s' }} /><span style={{ animationDelay: '.3s' }} /></div>
                  <div className="soft" style={{ marginTop: 14 }}>{t.preparing}</div>
                </div>
              ) : validated && pf ? (
                <div className="pf-result">
                  <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 8 }}>{t.whatWeWillSearch}</div>
                  <p className="soft" style={{ fontSize: 14, lineHeight: 1.6 }}>{pf.summary || t.confirmSub}</p>
                  {pf.suggestions.length > 0 && (
                    <div className="pf-suggest">
                      <div className="rev__k" style={{ marginBottom: 8 }}>{t.suggestionsTitle}</div>
                      <ul>{pf.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rev">
                  <div><div className="rev__k">{t.f.industry}</div><div className="rev__v">{industry.trim() || '—'}</div></div>
                  <div><div className="rev__k">{t.f.location}</div><div className="rev__v">{(params.location as string) || '—'}</div></div>
                  <div><div className="rev__k">{t.mode}</div><div className="rev__v">{modes.find((m) => m.key === mode)?.label ?? '—'}</div></div>
                  <div><div className="rev__k">{t.language}</div><div className="rev__v">{langLabels[params.language as string] ?? (params.language as string) ?? '—'}</div></div>
                  <div><div className="rev__k">{t.sba}</div><div className="rev__v">{params.sbaFriendly ? t.yes : '—'}</div></div>
                  <div><div className="rev__k">{t.realEstate}</div><div className="rev__v">{params.includeRealEstate ? t.yes : '—'}</div></div>
                </div>
              )}
            </div>
            <div className="modal__foot">
              <div className="between" style={{ alignItems: 'center', marginBottom: 16 }}>
                <span className="mono muted" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' }}>{t.cost}</span>
                <span><b className="accent" style={{ fontSize: 26, fontWeight: 800 }}>{cost}</b> <span className="mono muted" style={{ fontSize: 12 }}>{t.credits}</span></span>
              </div>
              {insufficient && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 12 }}>{t.notEnough}</div>}
              {error && <div className="mono" style={{ fontSize: 12, color: 'var(--risk)', marginBottom: 12 }}>{error}</div>}
              <div className="modal__actions">
                <button className="btn btn--outline" disabled={create.isPending || preflight.isPending} onClick={() => setConfirming(false)}>{t.goBack}</button>
                {validated ? (
                  <button className="btn btn--black" disabled={create.isPending} onClick={insufficient ? goBuy : submit}>{insufficient ? t.buyCredits : t.generate}</button>
                ) : (
                  <button className="btn btn--black" disabled={preflight.isPending} onClick={insufficient ? goBuy : runPreflight}>{insufficient ? t.buyCredits : t.validateContinue}</button>
                )}
              </div>
              <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'center', marginTop: 12 }}>{t.delivered}</div>
              <div className="soft" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>✉ {t.emailNotice}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
