/**
 * Pre-flight spec for the `florida-business-for-sale` model: how a request is
 * reviewed in the confirm step, before any credit is spent.
 *
 * `describePlan` is the user-facing summary. It is a PURE FUNCTION of the
 * validated params — that is what lets the confirm dialog show "here's exactly
 * what we'll look for" without a model writing a single word of it, and what
 * makes the same request always read the same way.
 *
 * Nothing the user typed in their own words is quoted back here: the summary is
 * a rendering of structured fields only, so it can be safely shown anywhere
 * (dialog, email, admin) without carrying user-authored text along. (The free
 * text a buyer writes fills the structured fields through the assist; it is not
 * a param and never reaches a prompt.)
 */
import type { Lang } from '../moderation/copy.js';
import type { PreflightSpec } from './types.js';

type Params = Record<string, unknown>;

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

/** A location that covers the whole state rather than a county/city. */
function isStatewide(location: string): boolean {
  return !location || /^(the\s+)?state of florida|^florida\b|^fl$|todo el estado|estado de florida/i.test(location);
}

/** The model only covers Florida — flag anything that doesn't look like it. */
function looksFlorida(location: string): boolean {
  return !location || /florida|,\s*fl\b|\bfl\b|\bflorida\b/i.test(location);
}

// --- Localized sentence fragments -------------------------------------------

interface PlanCopy {
  head: (subject: string, place: string) => string;
  anyBusiness: string;
  allFlorida: string;
  filtersLead: string;
  and: string;
  priceBand: (min: string, max: string) => string;
  priceMax: (max: string) => string;
  priceMin: (min: string) => string;
  revenue: (v: string) => string;
  cashFlow: (v: string) => string;
  sba: string;
  realEstate: string;
  noRealEstate: string;
  keywords: (v: string) => string;
  tail: (mode: string) => string;
}

const PLAN: Record<Lang, PlanCopy> = {
  en: {
    head: (s, p) => `We'll search Florida marketplaces and broker listings for ${s} currently for sale in ${p}`,
    anyBusiness: 'businesses',
    allFlorida: 'the State of Florida',
    filtersLead: 'Filtered to',
    and: 'and',
    priceBand: (min, max) => `an asking price between ${min} and ${max}`,
    priceMax: (max) => `an asking price up to ${max}`,
    priceMin: (min) => `an asking price from ${min}`,
    revenue: (v) => `at least ${v} in annual revenue`,
    cashFlow: (v) => `at least ${v} in annual cash flow (SDE)`,
    sba: 'deals likely to qualify for SBA 7(a) financing',
    realEstate: 'deals that include the real estate',
    noRealEstate: 'business-only deals (no real estate)',
    keywords: (v) => `listings matching ${v}`,
    tail: (mode) => `You'll get a ${mode} report: market and competition, a shortlist of real listings with prices and figures, in-depth profiles, valuation benchmarks, risks and next steps.`,
  },
  es: {
    head: (s, p) => `Buscaremos en marketplaces y brokers de Florida ${s} en venta en ${p}`,
    anyBusiness: 'negocios',
    allFlorida: 'todo el estado de Florida',
    filtersLead: 'Filtrado a',
    and: 'y',
    priceBand: (min, max) => `un precio de venta entre ${min} y ${max}`,
    priceMax: (max) => `un precio de venta de hasta ${max}`,
    priceMin: (min) => `un precio de venta desde ${min}`,
    revenue: (v) => `al menos ${v} de ingresos anuales`,
    cashFlow: (v) => `al menos ${v} de flujo de caja anual (SDE)`,
    sba: 'operaciones con probabilidad de calificar para financiamiento SBA 7(a)',
    realEstate: 'operaciones que incluyan el inmueble',
    noRealEstate: 'operaciones solo del negocio (sin inmueble)',
    keywords: (v) => `avisos que coincidan con ${v}`,
    tail: (mode) => `Recibirás un reporte ${mode}: mercado y competencia, una lista corta de negocios reales con precios y cifras, perfiles a fondo, múltiplos de valoración, riesgos y próximos pasos.`,
  },
  fr: {
    head: (s, p) => `Nous chercherons sur les places de marché et chez les brokers de Floride ${s} à vendre à ${p}`,
    anyBusiness: 'des entreprises',
    allFlorida: 'l’État de Floride',
    filtersLead: 'Filtré sur',
    and: 'et',
    priceBand: (min, max) => `un prix demandé entre ${min} et ${max}`,
    priceMax: (max) => `un prix demandé jusqu’à ${max}`,
    priceMin: (min) => `un prix demandé à partir de ${min}`,
    revenue: (v) => `au moins ${v} de chiffre d’affaires annuel`,
    cashFlow: (v) => `au moins ${v} de flux de trésorerie annuel (SDE)`,
    sba: 'des dossiers susceptibles d’obtenir un financement SBA 7(a)',
    realEstate: 'des dossiers incluant l’immobilier',
    noRealEstate: 'des dossiers portant seulement sur l’activité (sans immobilier)',
    keywords: (v) => `des annonces correspondant à ${v}`,
    tail: (mode) => `Vous recevrez un rapport ${mode} : marché et concurrence, une liste d’annonces réelles avec prix et chiffres, des profils détaillés, des multiples de valorisation, les risques et les prochaines étapes.`,
  },
  pt: {
    head: (s, p) => `Vamos buscar em marketplaces e brokers da Flórida ${s} à venda em ${p}`,
    anyBusiness: 'negócios',
    allFlorida: 'todo o estado da Flórida',
    filtersLead: 'Filtrado para',
    and: 'e',
    priceBand: (min, max) => `um preço de venda entre ${min} e ${max}`,
    priceMax: (max) => `um preço de venda de até ${max}`,
    priceMin: (min) => `um preço de venda a partir de ${min}`,
    revenue: (v) => `pelo menos ${v} de receita anual`,
    cashFlow: (v) => `pelo menos ${v} de fluxo de caixa anual (SDE)`,
    sba: 'negócios com chance de qualificar para financiamento SBA 7(a)',
    realEstate: 'negócios que incluam o imóvel',
    noRealEstate: 'negócios apenas da operação (sem imóvel)',
    keywords: (v) => `anúncios que correspondam a ${v}`,
    tail: (mode) => `Você receberá um relatório ${mode}: mercado e concorrência, uma lista curta de anúncios reais com preços e números, perfis detalhados, múltiplos de avaliação, riscos e próximos passos.`,
  },
};

/** Join clauses as "a, b and c" in the requested language. */
function joinClauses(parts: string[], and: string): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;
}

export const floridaPreflight: PreflightSpec<Params> = {
  assistPrompt:
    'a buy-side research report on businesses currently for sale in the State of Florida (market, real ' +
    'listings with prices and financials, deep-dive profiles, valuation, risks, next steps)',

  // Only the two identity fields may be corrected. Numbers, booleans and enums are
  // already constrained by the schema, and free-text instructions are never rewritten.
  correctable: [
    { field: 'location', maxLength: 200 },
    { field: 'industry', maxLength: 120 },
  ],

  rules: [
    {
      code: 'missing_subject',
      field: 'industry',
      severity: 'info',
      when: (p) => !str(p.industry),
    },
    {
      code: 'no_narrowing_filter',
      severity: 'info',
      when: (p) =>
        num(p.askingPriceMax) == null &&
        num(p.minRevenue) == null &&
        num(p.minCashFlow) == null &&
        !list(p.keywords).length,
    },
    {
      code: 'scope_too_broad',
      field: 'location',
      severity: 'info',
      when: (p) => isStatewide(str(p.location)) && num(p.askingPriceMax) == null,
    },
    {
      code: 'location_outside_florida',
      field: 'location',
      severity: 'warn',
      when: (p) => !looksFlorida(str(p.location)),
    },
    {
      code: 'price_band_very_wide',
      field: 'askingPriceMax',
      severity: 'info',
      when: (p) => {
        const min = num(p.askingPriceMin) ?? 0;
        const max = num(p.askingPriceMax);
        return max != null && max - min >= 2_000_000;
      },
    },
  ],

  issueCopy: {
    location_outside_florida: {
      en: 'This model only covers businesses for sale in Florida. The location you entered does not look like a Florida area.',
      es: 'Este modelo solo cubre negocios en venta en Florida. La ubicación que ingresaste no parece ser una zona de Florida.',
      fr: 'Ce modèle ne couvre que les entreprises à vendre en Floride. Le lieu saisi ne semble pas se trouver en Floride.',
      pt: 'Este modelo cobre apenas negócios à venda na Flórida. O local informado não parece ser uma região da Flórida.',
    },
    price_band_very_wide: {
      en: 'The asking-price range is very wide, so the shortlist will mix very different deals. A tighter band gives more comparable targets.',
      es: 'El rango de precio es muy amplio, así que la lista corta mezclará operaciones muy distintas. Un rango más ajustado da objetivos más comparables.',
      fr: 'La fourchette de prix est très large : la liste mêlera des dossiers très différents. Une fourchette plus serrée donne des cibles comparables.',
      pt: 'A faixa de preço é muito ampla, então a lista curta misturará negócios bem diferentes. Uma faixa menor traz alvos mais comparáveis.',
    },
  },

  describePlan: (p, { lang, modeLabel }) => {
    const t = PLAN[lang] ?? PLAN.en;
    const subject = str(p.industry) || t.anyBusiness;
    const place = str(p.location) && !isStatewide(str(p.location)) ? str(p.location) : t.allFlorida;

    const clauses: string[] = [];
    const min = num(p.askingPriceMin);
    const max = num(p.askingPriceMax);
    if (min != null && max != null) clauses.push(t.priceBand(usd(min), usd(max)));
    else if (max != null) clauses.push(t.priceMax(usd(max)));
    else if (min != null) clauses.push(t.priceMin(usd(min)));
    const revenue = num(p.minRevenue);
    if (revenue != null) clauses.push(t.revenue(usd(revenue)));
    const cashFlow = num(p.minCashFlow);
    if (cashFlow != null) clauses.push(t.cashFlow(usd(cashFlow)));
    if (p.sbaFriendly === true) clauses.push(t.sba);
    if (p.includeRealEstate === true) clauses.push(t.realEstate);
    if (p.includeRealEstate === false) clauses.push(t.noRealEstate);
    const keywords = list(p.keywords);
    if (keywords.length) clauses.push(t.keywords(keywords.join(', ')));

    const filters = clauses.length ? ` ${t.filtersLead} ${joinClauses(clauses, t.and)}.` : '.';
    return `${t.head(subject, place)}${filters} ${t.tail(modeLabel)}`;
  },
};
