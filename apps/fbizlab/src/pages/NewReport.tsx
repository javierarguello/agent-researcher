import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { Turnstile, type TurnstileHandle } from '../components/Turnstile';
import { captchaConfigured } from '../auth/captcha';
import { useBalance, useCreateJob, useMyStats, usePreflight, useTemplates, type PreflightResult } from '../api/hooks';
import { ApiError, DRAFT_KEY, clearDraftId, draftId } from '../api/client';
import type { DirectiveFieldInfo, ParamsUi } from '../api/types';

type Props = Record<string, unknown>;

const T = {
  en: {
    sModel: 'Research model', sModelH: 'Which kind of report to produce.',
    dash: 'Dashboard', crumb: 'New dossier', title: 'New dossier.',
    s1: 'What & where', s1h: "Define what you're hunting for.",
    s2: 'Dossier mode', s2h: 'How deep you want it.',
    s3: 'Deal filters', s3h: 'All optional — leave blank if not relevant.',
    s4: 'In your own words', s4h: 'Tell us what you’re after. We turn it into your preferences and keywords for you to confirm — the text itself is not part of the request.',
    proposalsTitle: 'Suggested from your notes', applyProposals: 'Apply suggestions', kw: 'Keywords',
    sd: 'Your preferences', sdh: 'Optional. Tells the analysts what to weigh — it never shortens the dossier.', sdCap: 'pick up to',
    s5: 'Advanced', show: '+ Show', hide: '− Hide', step: 'Step', of: 'of', back: 'Back', next: 'Next',
    reportLanguage: 'Dossier language', reportLangHelp: 'The language the final dossier is written in.',
    f: { industry: 'Industry', location: 'Location', askingPriceMin: 'Asking price · Min', askingPriceMax: 'Asking price · Max', minRevenue: 'Min revenue', minCashFlow: 'Min cash flow', keywords: 'Keywords', preferredSources: 'Preferred sources' } as Record<string, string>,
    sba: 'SBA friendly', realEstate: 'Include real estate',
    optionalUseful: 'Optional but very useful', add: 'Add and press Enter',
    industryWarn: 'No industry set — add one, or at least one keyword under Advanced, so the analysts know what to hunt for.',
    summary: 'Summary', pickIndustry: 'Pick an industry', mode: 'Mode', language: 'Language',
    cost: 'Cost', credits: 'credits', generate: 'Generate dossier', delivered: 'Delivered in 2–8 min',
    review: 'Review', confirmTitle: 'Confirm and generate', confirmSub: 'Review your dossier request before we start the research.', goBack: 'Go back', confirmGenerate: 'Confirm & generate',
    youHave: 'You have', creditsLeft: 'credits',
    notEnough: 'Not enough credits — buy more first.', buyCredits: 'Buy credits', alreadyRunning: 'You already have a dossier in progress — wait for it to finish before starting another.',
    rejected: 'Your request couldn’t be submitted:', tooMany: 'Too many requests just now. Nothing was charged — wait a moment and try again.', blockedNote: 'Your account is blocked:', captchaFailed: 'We couldn’t confirm you’re human. Reload the page and try again.', enqueueFailed: 'We couldn’t start your dossier just now. Please try again in a moment.', emailNotice: 'We’ll email you when your dossier is ready.',
    validateContinue: 'Validate & continue', preparing: 'Preparing summary…',
    whatWeWillSearch: 'What we’ll search', findingsTitle: 'Worth checking before you spend credits', fixesTitle: 'Suggested fixes', applyFixes: 'Apply suggested fixes', assistOff: 'Assisted review',
    noCredits: 'Not enough credits — buy more first.', yes: 'Yes',
    modeDesc: { essential: 'Core sections. Roughly half the cost. Great for early scanning.', comprehensive: 'Full long-form dossier: valuations, comparables, diligence, playbook.' } as Record<string, string>,
  },
  es: {
    sModel: 'Modelo de investigación', sModelH: 'Qué tipo de informe producir.',
    dash: 'Panel', crumb: 'Nuevo dossier', title: 'Nuevo dossier.',
    s1: 'Qué y dónde', s1h: 'Define qué estás buscando.',
    s2: 'Modo del dossier', s2h: 'Qué tan a fondo lo quieres.',
    s3: 'Filtros del deal', s3h: 'Todos opcionales — deja en blanco si no aplica.',
    s4: 'En tus palabras', s4h: 'Cuéntanos qué buscas. Lo convertimos en tus preferencias y palabras clave para que las confirmes — el texto en sí no forma parte del pedido.',
    proposalsTitle: 'Sugerido a partir de tus notas', applyProposals: 'Aplicar sugerencias', kw: 'Palabras clave',
    sd: 'Tus preferencias', sdh: 'Opcional. Le dice a los analistas qué priorizar — nunca acorta el dossier.', sdCap: 'elige hasta',
    s5: 'Avanzado', show: '+ Mostrar', hide: '− Ocultar', step: 'Paso', of: 'de', back: 'Atrás', next: 'Siguiente',
    reportLanguage: 'Idioma del dossier', reportLangHelp: 'El idioma en que se escribe el dossier final.',
    f: { industry: 'Industria', location: 'Ubicación', askingPriceMin: 'Precio · Mín', askingPriceMax: 'Precio · Máx', minRevenue: 'Ingreso mín', minCashFlow: 'Flujo de caja mín', keywords: 'Palabras clave', preferredSources: 'Fuentes preferidas' } as Record<string, string>,
    sba: 'Apto SBA', realEstate: 'Incluir inmueble',
    optionalUseful: 'Opcional pero muy útil', add: 'Escribe y presiona Enter',
    industryWarn: 'Sin industria — indica una, o al menos una palabra clave en Avanzado, para que los analistas sepan qué buscar.',
    summary: 'Resumen', pickIndustry: 'Elige una industria', mode: 'Modo', language: 'Idioma',
    cost: 'Costo', credits: 'créditos', generate: 'Generar dossier', delivered: 'Listo en 2–8 min',
    review: 'Revisar', confirmTitle: 'Confirma y genera', confirmSub: 'Revisa tu solicitud de dossier antes de empezar la investigación.', goBack: 'Volver', confirmGenerate: 'Confirmar y generar',
    youHave: 'Tienes', creditsLeft: 'créditos',
    notEnough: 'Créditos insuficientes — compra más primero.', buyCredits: 'Comprar créditos', alreadyRunning: 'Ya tienes un dossier en progreso — espera a que termine antes de iniciar otro.',
    rejected: 'No pudimos enviar tu solicitud:', tooMany: 'Demasiadas solicitudes ahora mismo. No se te cobró nada — espera un momento e inténtalo de nuevo.', blockedNote: 'Tu cuenta está bloqueada:', captchaFailed: 'No pudimos confirmar que eres una persona. Recarga la página e inténtalo de nuevo.', enqueueFailed: 'No pudimos iniciar tu dossier ahora mismo. Inténtalo de nuevo en un momento.', emailNotice: 'Te enviaremos un email cuando tu dossier esté listo.',
    validateContinue: 'Validar y continuar', preparing: 'Preparando resumen…',
    whatWeWillSearch: 'Lo que buscaremos', findingsTitle: 'Vale la pena revisar antes de gastar créditos', fixesTitle: 'Correcciones sugeridas', applyFixes: 'Aplicar correcciones', assistOff: 'Revisión asistida',
    noCredits: 'Créditos insuficientes — compra más primero.', yes: 'Sí',
    modeDesc: { essential: 'Secciones núcleo. Aproximadamente la mitad del costo. Ideal para explorar.', comprehensive: 'Dossier largo completo: valoraciones, comparables, due diligence, playbook.' } as Record<string, string>,
  },
  fr: {
    sModel: 'Modèle de recherche', sModelH: 'Quel type de rapport produire.',
    dash: 'Tableau de bord', crumb: 'Nouveau dossier', title: 'Nouveau dossier.',
    s1: 'Quoi et où', s1h: 'Définissez ce que vous cherchez.',
    s2: 'Mode du dossier', s2h: 'Le niveau de profondeur.',
    s3: 'Filtres du deal', s3h: 'Tous optionnels — laissez vide si non pertinent.',
    s4: 'Avec vos mots', s4h: 'Dites-nous ce que vous cherchez. Nous le traduisons en préférences et en mots-clés que vous confirmez — le texte lui-même ne fait pas partie de la demande.',
    proposalsTitle: 'Suggéré d’après vos notes', applyProposals: 'Appliquer les suggestions', kw: 'Mots-clés',
    sd: 'Vos préférences', sdh: 'Optionnel. Indique aux analystes quoi privilégier — cela ne raccourcit jamais le dossier.', sdCap: 'choisissez jusqu’à',
    s5: 'Avancé', show: '+ Afficher', hide: '− Masquer', step: 'Étape', of: 'de', back: 'Retour', next: 'Suivant',
    reportLanguage: 'Langue du dossier', reportLangHelp: 'La langue de rédaction du dossier final.',
    f: { industry: 'Secteur', location: 'Localisation', askingPriceMin: 'Prix · Min', askingPriceMax: 'Prix · Max', minRevenue: 'Revenu min', minCashFlow: 'Cash-flow min', keywords: 'Mots-clés', preferredSources: 'Sources préférées' } as Record<string, string>,
    sba: 'Compatible SBA', realEstate: "Inclure l'immobilier",
    optionalUseful: 'Optionnel mais très utile', add: 'Saisissez et appuyez sur Entrée',
    industryWarn: 'Aucun secteur — indiquez-en un, ou au moins un mot-clé dans Avancé, pour que les analystes sachent quoi chercher.',
    summary: 'Résumé', pickIndustry: 'Choisissez un secteur', mode: 'Mode', language: 'Langue',
    cost: 'Coût', credits: 'crédits', generate: 'Générer le dossier', delivered: 'Livré en 2–8 min',
    review: 'Vérifier', confirmTitle: 'Confirmer et générer', confirmSub: 'Vérifiez votre demande de dossier avant de lancer la recherche.', goBack: 'Retour', confirmGenerate: 'Confirmer et générer',
    youHave: 'Vous avez', creditsLeft: 'crédits',
    notEnough: 'Crédits insuffisants — achetez-en d’abord.', buyCredits: 'Acheter des crédits', alreadyRunning: 'Vous avez déjà un dossier en cours — attendez qu’il se termine avant d’en lancer un autre.',
    rejected: 'Votre demande n’a pas pu être envoyée :', tooMany: 'Trop de requêtes en ce moment. Rien ne vous a été facturé — attendez un instant et réessayez.', blockedNote: 'Votre compte est bloqué :', captchaFailed: 'Nous n’avons pas pu confirmer que vous êtes une personne. Rechargez la page et réessayez.', enqueueFailed: 'Nous n’avons pas pu lancer votre dossier pour l’instant. Réessayez dans un moment.', emailNotice: 'Nous vous enverrons un email quand votre dossier sera prêt.',
    validateContinue: 'Valider et continuer', preparing: 'Préparation du résumé…',
    whatWeWillSearch: 'Ce que nous chercherons', findingsTitle: 'À vérifier avant de dépenser des crédits', fixesTitle: 'Corrections suggérées', applyFixes: 'Appliquer les corrections', assistOff: 'Relecture assistée',
    noCredits: 'Crédits insuffisants — achetez-en d’abord.', yes: 'Oui',
    modeDesc: { essential: 'Sections clés. Environ moitié du coût. Idéal pour un premier tri.', comprehensive: 'Dossier long complet : valorisations, comparables, due diligence, playbook.' } as Record<string, string>,
  },
  pt: {
    sModel: 'Modelo de pesquisa', sModelH: 'Que tipo de relatório produzir.',
    dash: 'Painel', crumb: 'Novo dossiê', title: 'Novo dossiê.',
    s1: 'O quê e onde', s1h: 'Defina o que você procura.',
    s2: 'Modo do dossiê', s2h: 'O quão a fundo você quer.',
    s3: 'Filtros do deal', s3h: 'Todos opcionais — deixe em branco se não se aplica.',
    s4: 'Com suas palavras', s4h: 'Conte o que você procura. Transformamos isso em preferências e palavras-chave para você confirmar — o texto em si não faz parte do pedido.',
    proposalsTitle: 'Sugerido a partir das suas notas', applyProposals: 'Aplicar sugestões', kw: 'Palavras-chave',
    sd: 'Suas preferências', sdh: 'Opcional. Diz aos analistas o que priorizar — nunca encurta o dossiê.', sdCap: 'escolha até',
    s5: 'Avançado', show: '+ Mostrar', hide: '− Ocultar', step: 'Passo', of: 'de', back: 'Voltar', next: 'Próximo',
    reportLanguage: 'Idioma do dossiê', reportLangHelp: 'O idioma em que o dossiê final é escrito.',
    f: { industry: 'Setor', location: 'Localização', askingPriceMin: 'Preço · Mín', askingPriceMax: 'Preço · Máx', minRevenue: 'Receita mín', minCashFlow: 'Fluxo de caixa mín', keywords: 'Palavras-chave', preferredSources: 'Fontes preferidas' } as Record<string, string>,
    sba: 'Compatível SBA', realEstate: 'Incluir imóvel',
    optionalUseful: 'Opcional mas muito útil', add: 'Digite e pressione Enter',
    industryWarn: 'Sem setor — indique um, ou ao menos uma palavra-chave em Avançado, para que os analistas saibam o que buscar.',
    summary: 'Resumo', pickIndustry: 'Escolha um setor', mode: 'Modo', language: 'Idioma',
    cost: 'Custo', credits: 'créditos', generate: 'Gerar dossiê', delivered: 'Pronto em 2–8 min',
    review: 'Revisar', confirmTitle: 'Confirme e gere', confirmSub: 'Revise sua solicitação de dossiê antes de começar a pesquisa.', goBack: 'Voltar', confirmGenerate: 'Confirmar e gerar',
    youHave: 'Você tem', creditsLeft: 'créditos',
    notEnough: 'Créditos insuficientes — compre mais primeiro.', buyCredits: 'Comprar créditos', alreadyRunning: 'Você já tem um dossiê em andamento — aguarde ele terminar antes de iniciar outro.',
    rejected: 'Não foi possível enviar sua solicitação:', tooMany: 'Muitas solicitações agora. Nada foi cobrado — aguarde um instante e tente novamente.', blockedNote: 'Sua conta está bloqueada:', captchaFailed: 'Não conseguimos confirmar que você é uma pessoa. Recarregue a página e tente novamente.', enqueueFailed: 'Não conseguimos iniciar seu dossiê agora. Tente novamente em instantes.', emailNotice: 'Enviaremos um email quando seu dossiê estiver pronto.',
    validateContinue: 'Validar e continuar', preparing: 'Preparando resumo…',
    whatWeWillSearch: 'O que vamos buscar', findingsTitle: 'Vale revisar antes de gastar créditos', fixesTitle: 'Correções sugeridas', applyFixes: 'Aplicar correções', assistOff: 'Revisão assistida',
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

/** How much the "in your own words" box takes — the API reads at most this much. */
const FREE_TEXT_MAX = 2000;
/** Apply what the assist proposed on top of a params object — mirrors the API's `applyProposals`. */
function mergeProposals(params: Props, proposals: { directives: Record<string, unknown>; keywords: string[] }, dirKey: string): Props {
  const out: Props = { ...params };
  if (Object.keys(proposals.directives).length) out[dirKey] = { ...((params[dirKey] as Record<string, unknown> | undefined) ?? {}), ...proposals.directives };
  if (proposals.keywords.length) {
    const have = ((params.keywords as unknown[]) ?? []).filter((k): k is string => typeof k === 'string');
    out.keywords = [...have, ...proposals.keywords.filter((k) => !have.some((h) => h.toLowerCase() === k.toLowerCase()))];
  }
  return out;
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
  // Whether the user keeps the proposed corrections (on by default, one click to drop).
  const [applyFixes, setApplyFixes] = useState(true);
  // Whether the user keeps what the assist proposed from their notes (on by default, one click to drop).
  const [applyProposals, setApplyProposals] = useState(true);
  // What the user typed in their own words. NOT a param: it goes to the preflight,
  // which reads it and proposes preferences and keywords; the job never sees it.
  const [freeText, setFreeText] = useState('');
  // One widget for the dialog. Preflight and generate are two protected calls, and
  // a Turnstile token is single-use, so each one solves separately.
  const captcha = useRef<TurnstileHandle>(null);
  const [captchaReady, setCaptchaReady] = useState(!captchaConfigured());
  const isMobile = useIsMobile();
  const [step, setStep] = useState(0);
  // On mobile, only the current wizard step's section(s) are shown. Groups:
  // 0=What&where, 1=Report mode, 2=Deal filters, 3=Instructions+Advanced.
  const stepOf = (g: number) => (!isMobile || g === step ? undefined : ({ display: 'none' } as const));

  /**
   * Which model this form is for.
   *
   * `?model=` when given, otherwise the first the API offers. A picker is rendered
   * only when there is more than one — with a single-model catalog it would be a
   * control with nothing to choose. This used to be `templates[0]` with no way to
   * reach anything else, so a second model was unreachable from the buyer app.
   */
  const [sp, setSp] = useSearchParams();
  const wanted = sp.get('model');
  const catalog = templates.data?.templates ?? [];
  const model = catalog.find((m) => m.id === wanted) ?? catalog[0];
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
    // The UI language only if the MODEL writes in it. `d.language = lang` was
    // unconditional, several lines above where the accepted set is read — so a
    // French visitor on a model whose enum is ['en','pt'] submitted `fr`, got a
    // raw English Zod error on a French page, and the preflight catch treated the
    // 400 as advisory and submitted again for a second one.
    const accepted = (schema.properties?.language?.enum as string[] | undefined) ?? [];
    d.language = accepted.length === 0 || accepted.includes(lang) ? lang : (schema.properties?.language?.default as string) ?? accepted[0] ?? 'en';
    setParams(d);
  }, [schema, model?.modes, lang]);

  const modes = model?.modes ?? [];
  const mode = (params.mode as string) ?? modes[0]?.key;
  const cost = modes.find((m) => m.key === mode)?.credits ?? 0;
  const langOpts = props.language?.enum ?? ['en'];
  const langLabels = (ui?.fields?.language?.optionLabels ?? {}) as Record<string, string>;
  const help = (k: string) => ui?.fields?.[k]?.help;
  const ph = (k: string) => ui?.fields?.[k]?.placeholder;
  /**
   * What a field is CALLED, from the manifest.
   *
   * `t.f[k]` is a four-language map keyed by this model's field names, kept only
   * as a fallback for a template that has not declared labels yet. It is why a
   * second catalog model drew `maxHeadcount` as its own label in all four
   * languages: nothing about a form should have to know which model it is.
   */
  const label = (k: string) => ui?.fields?.[k]?.label ?? t.f[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

  /**
   * The fields this form lays out itself, in the manifest's order.
   *
   * `mode`, `language` and the directives blob each have their own section;
   * `hidden` and `advanced` are the manifest's own instructions about where
   * things go. Everything left is a plain input, and it used to be Florida's six,
   * written out as JSX. (The "in your own words" box is NOT a param — it feeds
   * the preflight assist, which proposes params from it.)
   */
  const ownKeys = new Set(
    [
      model?.directivesKey ?? 'directives',
      'mode',
      'language',
      ...(ui?.hidden ?? []),
      ...(ui?.advanced ?? []),
    ].filter(Boolean),
  );
  const ordered = [...new Set([...(ui?.rows ?? []).flat(), ...Object.keys(props)])].filter((k) => props[k] && !ownKeys.has(k));
  const isNumeric = (k: string) => props[k]?.type === 'number' || props[k]?.type === 'integer';
  const isBoolean = (k: string) => props[k]?.type === 'boolean';
  /** Text-ish first (what & where), then the filters. Same split Florida had. */
  const primaryKeys = ordered.filter((k) => !isNumeric(k) && !isBoolean(k));
  const filterKeys = ordered.filter((k) => isNumeric(k) || isBoolean(k));
  const advancedKeys = (ui?.advanced ?? []).filter((k) => props[k]);
  /**
   * The field the "no subject" warning hangs off.
   *
   * It is the model's FIRST primary field — for this model, `industry` — rather
   * than the literal name, which is what made the rule Florida-specific.
   */
  const subjectKey = primaryKeys[0];
  const subject = String(params[primaryKeys[0] ?? ''] ?? '');
  const keywordCount = Array.isArray(params.keywords) ? (params.keywords as unknown[]).length : 0;
  // Industry is optional; without it, at least one keyword is (mirrors the API).
  const needsSubject = !subject.trim() && keywordCount === 0;
  const bal = balance.data?.balance;
  // Only one report may be in flight per user (until it finishes or fails).
  const hasLive = (stats.data?.inProgress ?? 0) >= 1;
  const blocked = stats.data?.blocked ?? false;
  // --- Structured directives -------------------------------------------------
  // Every label, help line and option name below comes from the manifest, already
  // localized. Nothing about them is declared here on purpose: a new directive
  // field (or a new language for an existing one) is a template change, and this
  // form picks it up without a deploy of its own.
  const directives = model?.directives ?? [];
  const dirKey = model?.directivesKey ?? 'directives';
  const dirVals = (params[dirKey] as Record<string, unknown>) ?? {};
  const setDir = (k: string, v: unknown) => {
    const next: Record<string, unknown> = { ...dirVals };
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    setParams((p) => ({ ...p, [dirKey]: next }));
  };
  const dirField = (f: DirectiveFieldInfo) => {
    if (f.kind === 'boolean') {
      return (
        <label className="checkcard" key={f.key}>
          <input type="checkbox" checked={!!dirVals[f.key]} onChange={(e) => setDir(f.key, e.target.checked || undefined)} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{f.label}</div>
            {f.description && <div className="desc" style={{ marginTop: 3 }}>{f.description}</div>}
          </div>
        </label>
      );
    }
    const picked = f.kind === 'multi' ? ((dirVals[f.key] as string[]) ?? []) : [];
    const atCap = f.kind === 'multi' && f.maxSelected != null && picked.length >= f.maxSelected;
    return (
      <div className="field" key={f.key}>
        <label>
          {f.label}
          {f.kind === 'multi' && f.maxSelected != null && (
            <span className="mono muted" style={{ marginLeft: 8, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
              ({t.sdCap} {f.maxSelected})
            </span>
          )}
        </label>
        <div className="chips">
          {(f.options ?? []).map((o) => {
            const on = f.kind === 'multi' ? picked.includes(o.value) : dirVals[f.key] === o.value;
            return (
              <button
                type="button"
                key={o.value}
                className={`chip ${on ? 'sel' : ''}`}
                // At the cap, an unpicked option is disabled rather than silently
                // ignored — a click that does nothing reads as a broken form.
                disabled={!on && atCap}
                onClick={() =>
                  f.kind === 'multi'
                    ? setDir(f.key, on ? picked.filter((x) => x !== o.value) : [...picked, o.value])
                    : setDir(f.key, on ? undefined : o.value) // clicking the picked one clears it
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {f.description && <div className="desc">{f.description}</div>}
      </div>
    );
  };

  const cleanParams = (): Props => {
    const c: Props = { ...params };
    Object.keys(c).forEach((k) => { if (c[k] === undefined || c[k] === '') delete c[k]; });
    // An untouched directive set is absent, not empty: it keeps the request (and
    // the key the preflight cache is built from) identical to never having opened
    // the section at all.
    const d = c[dirKey] as Record<string, unknown> | undefined;
    if (d && Object.keys(d).length === 0) delete c[dirKey];
    return c;
  };
  // The NOTES are part of what was previewed. They are separate state and were not
  // in this key, so a buyer who rewrote them after the preview got the dialog's
  // "Generate" button: the preflight was never called again, the new text never left
  // the browser, and the proposals of the sentence they had DELETED were ordered and
  // paid for (round 7, R7-7). Trimmed and clipped exactly as `runPreflight` sends
  // them, so trailing whitespace does not spend an assisted attempt.
  const previewText = freeText.trim().slice(0, FREE_TEXT_MAX);
  const paramsKey = JSON.stringify([cleanParams(), previewText]);
  const validated = validatedKey === paramsKey && pf != null; // already previewed these exact params + notes
  const canGo = !needsSubject && !hasLive && !blocked && !create.isPending && !preflight.isPending;
  const insufficient = typeof bal === 'number' && bal < cost;
  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(params)); } catch { /* ignore */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  // Not enough credits → keep every input and send them to buy; they come back here.
  const goBuy = () => { saveDraft(); setConfirming(false); nav('/app/credits'); };

  /**
   * A plain text/tags input, inferred from the schema.
   *
   * Array → tag entry, string → a line input with the manifest's suggestion chips.
   * The chips used to be rendered untranslated: thirteen English words under the
   * first field of a Spanish form, and clicking one submitted the English string
   * as the research subject.
   */
  const textField = (key: string) => {
    const prop = props[key];
    const val = params[key];
    const sugg = ui?.fields?.[key]?.suggestions ?? [];
    const isArray = prop?.type === 'array';
    return (
      <div className="field" key={key}>
        <label>{label(key)}</label>
        {isArray ? (
          <Tags value={(val as string[]) ?? []} onChange={(v) => set(key, v)} suggestions={sugg} placeholder={t.add} />
        ) : (
          <>
            <input
              className="input"
              maxLength={prop?.maxLength ?? 200}
              placeholder={ph(key)}
              value={(val as string) ?? ''}
              onChange={(e) => set(key, e.target.value)}
            />
            {sugg.length > 0 && (
              <div className="chips">
                {sugg.map((sg) => (
                  <button type="button" key={sg} className={`chip ${val === sg ? 'sel' : ''}`} onClick={() => set(key, sg)}>{sg}</button>
                ))}
              </div>
            )}
          </>
        )}
        {help(key) && <div className="desc">{help(key)}</div>}
        {key === subjectKey && needsSubject && <div className="nr-warn">{t.industryWarn}</div>}
      </div>
    );
  };

  /** Advanced fields — same inference, no special cases. */
  const advField = (key: string) => textField(key);

  const numField = (key: string) => {
    const v = params[key];
    return (
      <div className="field" key={key}>
        <label>{label(key)}</label>
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
  const checkField = (key: string) => (
    <label className="checkcard" key={key}>
      <input type="checkbox" checked={!!params[key]} onChange={(e) => set(key, e.target.checked)} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label(key)}</div>
        {help(key) && <div className="desc" style={{ marginTop: 3 }}>{help(key)}</div>}
      </div>
    </label>
  );

  // Step 1: moderation + the pre-flight review. The deterministic half always
  // produces a summary, so there is normally something to show; if the call itself
  // fails we generate anyway — the review is advisory and must never block.
  async function runPreflight() {
    setError(null);
    try {
      const text = previewText;
      const res = await preflight.mutateAsync({ template: model!.id, params: cleanParams(), ...(text ? { freeText: text } : {}), draftId: draftId(), captcha: await captcha.current?.getToken() });
      const useful = (res.summary?.trim().length ?? 0) > 0 || res.issues.length > 0 || res.corrections.length > 0 || !!res.proposals;
      if (useful) {
        setPf(res);
        setValidatedKey(paramsKey);
        setApplyFixes(res.corrections.length > 0); // proposed fixes are opt-out, not silent
        setApplyProposals(!!res.proposals);
      } else {
        // Nothing to review — but the PREVIOUS review may still be in state, and
        // submitting with it would apply proposals derived from text this request no
        // longer carries. Passed explicitly: `setPf(null)` does not land before the
        // call below reads it.
        setPf(null);
        setApplyProposals(false);
        await submit(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setConfirming(false);
        setError(`${t.rejected} ${err.message}`);
      } else if (err instanceof ApiError && err.code === 'captcha_failed') {
        // NOT a block. Turnstile tokens are single-use and expire in minutes, and
        // the widget deliberately lets the form through when its script is blocked,
        // so this 403 is an expected outcome for an ordinary user on a slow form or
        // a second tab. Telling them their account is blocked is both false and
        // frightening — and it was the message they got.
        setConfirming(false);
        setError(t.captchaFailed);
      } else if (err instanceof ApiError && err.status === 403) {
        setConfirming(false);
        // The API's blocked copy is a full sentence in the user's language now, so
        // the old `${t.blockedNote} ${err.message}` would say it twice.
        setError(err.code === 'account_blocked' ? err.message : `${t.blockedNote} ${err.message}`);
        stats.refetch();
      } else if (err instanceof ApiError && err.status === 429) {
        // NOT the generate-anyway path. The person clicked "Validate & continue"
        // to SEE the review — the summary, the proposed corrections, the findings
        // — and falling through to `submit()` created the job, spent their credits
        // and navigated them to a job page they never asked to start. The comment
        // below justifies the fallback for a 5xx or a dropped connection; a 429 is
        // neither, and it is the one case where the right answer is to say so and
        // let them press again.
        setConfirming(false);
        setError(t.tooMany);
      } else {
        // The review is advisory, so a 5xx/network failure generates anyway — but
        // the preflight call already spent this token at siteverify, and replaying
        // it fails as a duplicate. Reset FIRST: the `finally` below runs after this
        // await, which is exactly why the fallback never worked.
        captcha.current?.reset();
        await submit();
      }
    } finally {
      captcha.current?.reset(); // the generate call needs its own token
    }
  }

  // Step 2: actually create the job (moderation runs again server-side). When the
  // user kept the suggested fixes, we submit the corrected set the API returned.
  async function submit(review: typeof pf | null = pf) {
    setError(null);
    try {
      const base = applyFixes && review?.correctedParams ? review.correctedParams : cleanParams();
      // The proposals ride on top of whichever base the user kept. When both are
      // kept the API's `proposedParams` is exactly that; otherwise merge here.
      const params = applyProposals && review?.proposals
        ? (applyFixes && review.proposedParams ? review.proposedParams : mergeProposals(base, review.proposals, dirKey))
        : base;
      const res = await create.mutateAsync({ template: model!.id, params, captcha: await captcha.current?.getToken() });
      clearDraft();
      clearDraftId(); // this report is done; the next one gets its own allowance
      nav(`/app/jobs/${res.jobId}`);
    } catch (err) {
      setConfirming(false); // surface the error on the form, not the dialog
      setError(
        err instanceof ApiError && err.status === 402 ? t.noCredits
          : err instanceof ApiError && err.status === 409 ? t.alreadyRunning
            : err instanceof ApiError && err.status === 422 ? `${t.rejected} ${err.message}`
              : err instanceof ApiError && err.code === 'captcha_failed' ? t.captchaFailed
                : err instanceof ApiError && err.status === 429 ? (err.message || t.tooMany)
              : err instanceof ApiError && err.code === 'enqueue_failed' ? t.enqueueFailed
                  : err instanceof ApiError && err.status === 403 ? (err.code === 'account_blocked' ? err.message : `${t.blockedNote} ${err.message}`)
                  : err instanceof ApiError ? err.message : 'Failed.',
      );
      if (err instanceof ApiError && err.status === 403) stats.refetch();
    } finally {
      captcha.current?.reset();
    }
  }


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

            {/* 00 Which model — only when there is a choice to make. */}
            {catalog.length > 1 && (
              <section className="nr-sec" style={stepOf(0)}>
                <SecHead n="00" title={t.sModel} hint={t.sModelH} />
                <div className="chips">
                  {catalog.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className={`chip ${m.id === model?.id ? 'sel' : ''}`}
                      onClick={() => { inited.current = false; setParams({}); setSp({ model: m.id }); }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 01 What & where */}
            <section className="nr-sec" style={stepOf(0)}>
              <SecHead n="01" title={t.s1} hint={t.s1h} />
              <div className="nr-row">{primaryKeys.map(textField)}</div>
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
              <div className="nr-row">{filterKeys.filter(isNumeric).map((k) => numField(k))}</div>
              <div className="nr-row">{filterKeys.filter(isBoolean).map((k) => checkField(k))}</div>
            </section>

            {/* 04 Your preferences (structured directives) */}
            {directives.length > 0 && (
              <section className="nr-sec" style={stepOf(2)}>
                <SecHead n="04" title={t.sd} hint={t.sdh} />
                <div className="stack" style={{ gap: 18 }}>{directives.map(dirField)}</div>
              </section>
            )}

            {/* 05 In your own words — feeds the assist; never a param */}
            <section className="nr-sec" style={stepOf(3)}>
              <SecHead n={directives.length ? '05' : '04'} title={t.s4} hint={t.s4h} />
              <textarea className="textarea" rows={6} maxLength={FREE_TEXT_MAX} value={freeText} onChange={(e) => setFreeText(e.target.value)} data-testid="free-text" />
              <div className="between" style={{ marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{t.optionalUseful}</span>
                <span className="mono muted" style={{ fontSize: 10.5 }}>{freeText.length} / {FREE_TEXT_MAX}</span>
              </div>
            </section>

            {/* 06 Advanced */}
            <section className="nr-sec" style={stepOf(3)}>
              <SecHead n={directives.length ? '06' : '05'} title={t.s5} right={<button type="button" className="nr-hint" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setAdvOpen((o) => !o)}>{advOpen ? t.hide : t.show}</button>} />
              {advOpen && (
                <div className="stack" style={{ gap: 16, paddingTop: 4 }}>
                  {advancedKeys.map(advField)}
                </div>
              )}
            </section>

            {isMobile && step === WIZARD_STEPS - 1 && (hasLive || error) && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--risk)', marginTop: 12, lineHeight: 1.5 }}>
                {hasLive ? t.alreadyRunning : error}
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
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', marginTop: 10 }}>{subject.trim() || t.pickIndustry}</div>
              <div className="mono muted" style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 4 }}>{String(params[primaryKeys[1] ?? ''] ?? '') || '—'}</div>

              <div className="nr-sumrows">
                <div><span>{t.mode}</span><b>{modes.find((m) => m.key === mode)?.label ?? '—'}</b></div>
                <div><span>{t.language}</span><b>{langLabels[params.language as string] ?? (params.language as string) ?? '—'}</b></div>
                {/* The model's own switches, by its own labels. */}
                {filterKeys.filter(isBoolean).map((k) => (
                  <div key={k}><span>{label(k)}</span><b>{params[k] ? t.yes : '—'}</b></div>
                ))}
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
              {preflight.isPending || create.isPending ? (
                <div className="pf-prep">
                  <div className="pf-dots"><span /><span style={{ animationDelay: '.15s' }} /><span style={{ animationDelay: '.3s' }} /></div>
                  <div className="soft" style={{ marginTop: 14 }}>{t.preparing}</div>
                </div>
              ) : validated && pf ? (
                <div className="pf-result">
                  <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 8 }}>{t.whatWeWillSearch}</div>
                  <p className="soft" style={{ fontSize: 14, lineHeight: 1.6 }}>{pf.summary || t.confirmSub}</p>

                  {/* Proposed corrections, as a diff the user can decline. */}
                  {(pf.corrections?.length ?? 0) > 0 && (
                    <div className="pf-suggest">
                      <div className="rev__k" style={{ marginBottom: 8 }}>{t.fixesTitle}</div>
                      <ul>
                        {pf.corrections!.map((c) => (
                          <li key={c.field}>
                            <span className="mono muted">{t.f[c.field] ?? c.field}: </span>
                            <s className="muted">{c.from}</s> <span aria-hidden>→</span> <b>{c.to}</b>
                          </li>
                        ))}
                      </ul>
                      <label className="checkcard" style={{ marginTop: 10 }}>
                        <input type="checkbox" checked={applyFixes} onChange={(e) => setApplyFixes(e.target.checked)} />
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.applyFixes}</div>
                      </label>
                    </div>
                  )}

                  {/* What the assist read out of the user's own words — a diff to accept. */}
                  {pf.proposals && (
                    <div className="pf-suggest" data-testid="proposals">
                      <div className="rev__k" style={{ marginBottom: 8 }}>{t.proposalsTitle}</div>
                      <ul>
                        {Object.entries(pf.proposals.directives).map(([k, v]) => {
                          const field = directives.find((d) => d.key === k);
                          const labelOf = (x: unknown) => field?.options?.find((o) => o.value === x)?.label ?? String(x);
                          const shown = Array.isArray(v) ? v.map(labelOf).join(', ') : typeof v === 'boolean' ? (v ? t.yes : '—') : labelOf(v);
                          return <li key={k}><span className="mono muted">{field?.label ?? k}: </span><b>{shown}</b></li>;
                        })}
                        {pf.proposals.keywords.length > 0 && (
                          <li><span className="mono muted">{t.kw}: </span>{pf.proposals.keywords.map((k) => <span key={k} className="chip sel" style={{ marginRight: 6 }}>{k}</span>)}</li>
                        )}
                      </ul>
                      <label className="checkcard" style={{ marginTop: 10 }}>
                        <input type="checkbox" checked={applyProposals} onChange={(e) => setApplyProposals(e.target.checked)} />
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.applyProposals}</div>
                      </label>
                    </div>
                  )}

                  {(pf.issues?.length ?? 0) > 0 && (
                    <div className="pf-suggest">
                      <div className="rev__k" style={{ marginBottom: 8 }}>{t.findingsTitle}</div>
                      <ul>{pf.issues!.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
                    </div>
                  )}

                  {/* Why the assisted layer didn't run — informational, never an error. */}
                  {pf.assist?.message && (
                    <div className="mono muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
                      {t.assistOff}: {pf.assist.message}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rev">
                  {/* The model's own primary fields, in its own order — this used to
                      name Florida's two, so a second model's review step showed
                      empty rows for fields it does not have. */}
                  {primaryKeys.map((k) => (
                    <div key={k}><div className="rev__k">{label(k)}</div><div className="rev__v">{String(params[k] ?? '') || '—'}</div></div>
                  ))}
                  <div><div className="rev__k">{t.mode}</div><div className="rev__v">{modes.find((m) => m.key === mode)?.label ?? '—'}</div></div>
                  <div><div className="rev__k">{t.language}</div><div className="rev__v">{langLabels[params.language as string] ?? (params.language as string) ?? '—'}</div></div>
                  {filterKeys.filter(isBoolean).map((k) => (
                    <div key={k}><div className="rev__k">{label(k)}</div><div className="rev__v">{params[k] ? t.yes : '—'}</div></div>
                  ))}
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
                  <button className="btn btn--black" disabled={create.isPending || (!captchaReady && !insufficient)} onClick={insufficient ? goBuy : () => submit()}>{insufficient ? t.buyCredits : t.generate}</button>
                ) : (
                  <button className="btn btn--black" disabled={preflight.isPending || (!captchaReady && !insufficient)} onClick={insufficient ? goBuy : runPreflight}>{insufficient ? t.buyCredits : t.validateContinue}</button>
                )}
              </div>
              {/* Below the actions: normally invisible, and a challenge appears
                  without pushing the buttons around. */}
              <Turnstile ref={captcha} onReady={setCaptchaReady} />
              <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'center', marginTop: 12 }}>{t.delivered}</div>
              <div className="soft" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>✉ {t.emailNotice}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
