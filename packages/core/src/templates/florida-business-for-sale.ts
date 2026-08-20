import { z } from 'zod';
import { modeParamSchema } from '../mode.js';
import { LANGUAGE_LABELS } from '../languages.js';
import { dedupeSources } from '../tools/sources.js';
import { chartSchema } from './chart.js';
import { metricSchema, riskItemSchema, projectionTableSchema } from './blocks.js';
import { floridaPreflight } from './florida-preflight.js';
import { directivesSchema } from './directives.js';
import type { AgentSpec, DirectiveField, ReportSection, ResearchTemplate } from './types.js';

// --- Client params -----------------------------------------------------------

// Bounded so a hostile client can't bloat the LLM prompt or the report cost:
// every string is length-capped, every array item-capped, every number ceiling-capped.
const PRICE_MAX = 1_000_000_000; // $1B ceiling — well above any lower-middle-market deal.

/**
 * Structured directives — what a buyer can tell the analysts, as a closed
 * vocabulary rather than prose.
 *
 * Each value is a research instruction we can act on ("prioritise retirement
 * sales", "the buyer wants an absentee business") and none of them can express a
 * quantity, so none can make a section's schema unsatisfiable. Every field is
 * optional: an untouched form adds nothing to the prompt.
 *
 * Note what is deliberately absent: SBA eligibility and "real estate included"
 * already have their own params (`sbaFriendly`, `includeRealEstate`). Repeating
 * them here would let one request say both yes and no.
 */
const DIRECTIVE_FIELDS: DirectiveField[] = [
  {
    key: 'reasonForSale',
    kind: 'multi',
    maxSelected: 4,
    values: [
      'owner_retiring', 'health_or_family', 'relocation', 'partnership_split',
      'burnout', 'new_venture', 'financial_distress', 'estate_sale',
    ],
    promptLabel: 'Reasons for sale the buyer wants prioritised',
    text: {
      en: {
        label: 'Reason for sale',
        description: 'Why the current owner is selling. Retirement sales are usually the cleanest.',
        valueLabels: {
          owner_retiring: 'Owner retiring',
          health_or_family: 'Health or family reasons',
          relocation: 'Owner relocating',
          partnership_split: 'Partnership split',
          burnout: 'Owner burnout',
          new_venture: 'Moving on to a new venture',
          financial_distress: 'Financial distress',
          estate_sale: 'Estate sale',
        },
      },
      es: {
        label: 'Motivo de venta',
        description: 'Por qué vende el dueño actual. Las ventas por jubilación suelen ser las más limpias.',
        valueLabels: {
          owner_retiring: 'El dueño se jubila',
          health_or_family: 'Motivos de salud o familiares',
          relocation: 'El dueño se muda',
          partnership_split: 'Disolución de la sociedad',
          burnout: 'Desgaste del dueño',
          new_venture: 'Pasa a un nuevo emprendimiento',
          financial_distress: 'Dificultades financieras',
          estate_sale: 'Venta por sucesión',
        },
      },
      fr: {
        label: 'Motif de la vente',
        description: 'Pourquoi le propriétaire actuel vend. Les départs à la retraite sont en général les dossiers les plus sains.',
        valueLabels: {
          owner_retiring: 'Le propriétaire part à la retraite',
          health_or_family: 'Raisons de santé ou familiales',
          relocation: 'Le propriétaire déménage',
          partnership_split: 'Séparation des associés',
          burnout: 'Épuisement du propriétaire',
          new_venture: 'Il se lance dans un nouveau projet',
          financial_distress: 'Difficultés financières',
          estate_sale: 'Vente successorale',
        },
      },
      pt: {
        label: 'Motivo da venda',
        description: 'Por que o dono atual está vendendo. Vendas por aposentadoria costumam ser as mais limpas.',
        valueLabels: {
          owner_retiring: 'O dono vai se aposentar',
          health_or_family: 'Motivos de saúde ou familiares',
          relocation: 'O dono vai se mudar',
          partnership_split: 'Dissolução da sociedade',
          burnout: 'Desgaste do dono',
          new_venture: 'Vai tocar um novo negócio',
          financial_distress: 'Dificuldades financeiras',
          estate_sale: 'Venda por inventário',
        },
      },
    },
  },
  {
    key: 'ownerInvolvement',
    kind: 'single',
    values: ['absentee', 'semi_absentee', 'owner_operator', 'any'],
    promptLabel: 'Day-to-day owner involvement the buyer wants',
    text: {
      en: {
        label: 'Owner involvement',
        description: 'How much of your own time the business should need.',
        valueLabels: {
          absentee: 'Absentee — a manager runs it',
          semi_absentee: 'Semi-absentee — part-time',
          owner_operator: 'Owner-operator — full-time',
          any: 'No preference',
        },
      },
      es: {
        label: 'Participación del dueño',
        description: 'Cuánto de tu tiempo debería requerir el negocio.',
        valueLabels: {
          absentee: 'Ausente — lo dirige un gerente',
          semi_absentee: 'Semi-ausente — medio tiempo',
          owner_operator: 'Dueño-operador — tiempo completo',
          any: 'Sin preferencia',
        },
      },
      fr: {
        label: 'Implication du propriétaire',
        description: 'Le temps que l’affaire doit vous demander.',
        valueLabels: {
          absentee: 'Absent — un gérant s’en occupe',
          semi_absentee: 'Semi-absent — à temps partiel',
          owner_operator: 'Exploitant — à plein temps',
          any: 'Sans préférence',
        },
      },
      pt: {
        label: 'Envolvimento do dono',
        description: 'Quanto do seu tempo o negócio deve exigir.',
        valueLabels: {
          absentee: 'Ausente — um gerente toca o negócio',
          semi_absentee: 'Semi-ausente — meio período',
          owner_operator: 'Dono-operador — tempo integral',
          any: 'Sem preferência',
        },
      },
    },
  },
  {
    key: 'dealStructure',
    kind: 'multi',
    maxSelected: 3,
    values: ['seller_financing', 'earnout', 'asset_purchase', 'stock_purchase', 'all_cash'],
    promptLabel: 'Deal structures the buyer prefers',
    text: {
      en: {
        label: 'Preferred deal structure',
        description: 'How you would rather pay for the business.',
        valueLabels: {
          seller_financing: 'Seller financing',
          earnout: 'Earn-out tied to performance',
          asset_purchase: 'Asset purchase',
          stock_purchase: 'Stock purchase',
          all_cash: 'All cash',
        },
      },
      es: {
        label: 'Estructura de la operación',
        description: 'Cómo preferirías pagar el negocio.',
        valueLabels: {
          seller_financing: 'Financiamiento del vendedor',
          earnout: 'Earn-out ligado al desempeño',
          asset_purchase: 'Compra de activos',
          stock_purchase: 'Compra de acciones',
          all_cash: 'Pago de contado',
        },
      },
      fr: {
        label: 'Montage souhaité',
        description: 'Comment vous préférez payer l’affaire.',
        valueLabels: {
          seller_financing: 'Crédit vendeur',
          earnout: 'Complément de prix lié aux résultats',
          asset_purchase: 'Achat d’actifs',
          stock_purchase: 'Achat de titres',
          all_cash: 'Paiement comptant',
        },
      },
      pt: {
        label: 'Estrutura da operação',
        description: 'Como você prefere pagar pelo negócio.',
        valueLabels: {
          seller_financing: 'Financiamento do vendedor',
          earnout: 'Earn-out atrelado ao desempenho',
          asset_purchase: 'Compra de ativos',
          stock_purchase: 'Compra de quotas/ações',
          all_cash: 'Pagamento à vista',
        },
      },
    },
  },
  {
    key: 'buyerProfile',
    kind: 'single',
    values: ['first_time_buyer', 'experienced_operator', 'strategic_addon', 'passive_investor'],
    promptLabel: 'Who the buyer is — calibrate how much is explained and how risk is framed',
    text: {
      en: {
        label: 'Buyer profile',
        description: 'Who is buying — this sets how much the report explains.',
        valueLabels: {
          first_time_buyer: 'First-time buyer',
          experienced_operator: 'Experienced operator',
          strategic_addon: 'Add-on to a business I already own',
          passive_investor: 'Passive investor',
        },
      },
      es: {
        label: 'Perfil del comprador',
        description: 'Quién compra — define cuánto explica el reporte.',
        valueLabels: {
          first_time_buyer: 'Comprador primerizo',
          experienced_operator: 'Operador con experiencia',
          strategic_addon: 'Complemento de un negocio que ya tengo',
          passive_investor: 'Inversionista pasivo',
        },
      },
      fr: {
        label: 'Profil de l’acquéreur',
        description: 'Qui achète — cela règle le niveau d’explication du rapport.',
        valueLabels: {
          first_time_buyer: 'Premier achat',
          experienced_operator: 'Exploitant expérimenté',
          strategic_addon: 'Complément d’une affaire que je détiens déjà',
          passive_investor: 'Investisseur passif',
        },
      },
      pt: {
        label: 'Perfil do comprador',
        description: 'Quem compra — isso define o quanto o relatório explica.',
        valueLabels: {
          first_time_buyer: 'Primeira aquisição',
          experienced_operator: 'Operador experiente',
          strategic_addon: 'Complemento de um negócio que já tenho',
          passive_investor: 'Investidor passivo',
        },
      },
    },
  },
  {
    key: 'timeline',
    kind: 'single',
    values: ['immediate', 'within_3_months', 'within_12_months', 'exploring'],
    promptLabel: "The buyer's acquisition timeline",
    text: {
      en: {
        label: 'Timeline',
        description: 'When you want to close.',
        valueLabels: {
          immediate: 'Ready to close now',
          within_3_months: 'Within 3 months',
          within_12_months: 'Within 12 months',
          exploring: 'Exploring the market',
        },
      },
      es: {
        label: 'Plazo',
        description: 'Para cuándo quieres cerrar.',
        valueLabels: {
          immediate: 'Listo para cerrar ahora',
          within_3_months: 'En menos de 3 meses',
          within_12_months: 'En menos de 12 meses',
          exploring: 'Explorando el mercado',
        },
      },
      fr: {
        label: 'Échéance',
        description: 'Quand vous souhaitez conclure.',
        valueLabels: {
          immediate: 'Prêt à conclure maintenant',
          within_3_months: 'Sous 3 mois',
          within_12_months: 'Sous 12 mois',
          exploring: 'J’explore le marché',
        },
      },
      pt: {
        label: 'Prazo',
        description: 'Para quando você quer fechar.',
        valueLabels: {
          immediate: 'Pronto para fechar agora',
          within_3_months: 'Em até 3 meses',
          within_12_months: 'Em até 12 meses',
          exploring: 'Explorando o mercado',
        },
      },
    },
  },
  {
    key: 'riskAppetite',
    kind: 'single',
    values: ['conservative', 'balanced', 'opportunistic'],
    promptLabel: "The buyer's risk appetite",
    text: {
      en: {
        label: 'Risk appetite',
        description: 'Proven and steady, or higher risk for a lower price.',
        valueLabels: {
          conservative: 'Conservative — proven, steady cash flow',
          balanced: 'Balanced',
          opportunistic: 'Opportunistic — turnarounds and distressed deals',
        },
      },
      es: {
        label: 'Apetito de riesgo',
        description: 'Probado y estable, o más riesgo a cambio de mejor precio.',
        valueLabels: {
          conservative: 'Conservador — flujo de caja probado y estable',
          balanced: 'Equilibrado',
          opportunistic: 'Oportunista — reestructuraciones y negocios en dificultad',
        },
      },
      fr: {
        label: 'Appétence au risque',
        description: 'Éprouvé et régulier, ou plus de risque contre un meilleur prix.',
        valueLabels: {
          conservative: 'Prudent — trésorerie éprouvée et régulière',
          balanced: 'Équilibré',
          opportunistic: 'Opportuniste — redressements et affaires en difficulté',
        },
      },
      pt: {
        label: 'Apetite por risco',
        description: 'Comprovado e estável, ou mais risco em troca de preço melhor.',
        valueLabels: {
          conservative: 'Conservador — caixa comprovado e estável',
          balanced: 'Equilibrado',
          opportunistic: 'Oportunista — recuperações e negócios em dificuldade',
        },
      },
    },
  },
  {
    key: 'reportEmphasis',
    kind: 'multi',
    maxSelected: 3,
    values: ['financials', 'market_demand', 'competition', 'regulatory', 'growth', 'risks', 'financing'],
    // The phrasing matters: emphasis adds depth where asked, it never removes it
    // elsewhere. Rendered directives repeat that rule; this line keeps it true
    // even for a model that reads only the label.
    promptLabel: 'Aspects to go deepest on (in addition to — never instead of — everything else required)',
    text: {
      en: {
        label: 'Give extra depth to',
        description: 'Up to 3 aspects to dig deepest into. Nothing else is dropped.',
        valueLabels: {
          financials: 'Financials and valuation',
          market_demand: 'Market demand',
          competition: 'Competition',
          regulatory: 'Regulation and licensing',
          growth: 'Growth opportunities',
          risks: 'Risks and red flags',
          financing: 'Financing',
        },
      },
      es: {
        label: 'Profundizar especialmente en',
        description: 'Hasta 3 aspectos a los que dedicar más profundidad. No se omite nada más.',
        valueLabels: {
          financials: 'Finanzas y valoración',
          market_demand: 'Demanda del mercado',
          competition: 'Competencia',
          regulatory: 'Regulación y licencias',
          growth: 'Oportunidades de crecimiento',
          risks: 'Riesgos y señales de alerta',
          financing: 'Financiamiento',
        },
      },
      fr: {
        label: 'Approfondir surtout',
        description: 'Jusqu’à 3 aspects à creuser davantage. Rien d’autre n’est retiré.',
        valueLabels: {
          financials: 'Finances et valorisation',
          market_demand: 'Demande du marché',
          competition: 'Concurrence',
          regulatory: 'Réglementation et licences',
          growth: 'Opportunités de croissance',
          risks: 'Risques et signaux d’alerte',
          financing: 'Financement',
        },
      },
      pt: {
        label: 'Aprofundar especialmente em',
        description: 'Até 3 aspectos para detalhar mais. Nada além disso é omitido.',
        valueLabels: {
          financials: 'Finanças e valuation',
          market_demand: 'Demanda de mercado',
          competition: 'Concorrência',
          regulatory: 'Regulação e licenças',
          growth: 'Oportunidades de crescimento',
          risks: 'Riscos e sinais de alerta',
          financing: 'Financiamento',
        },
      },
    },
  },
];

const paramsSchema = z.object({
  location: z.string().trim().max(200).default('State of Florida, USA'),
  industry: z.string().trim().max(120).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  askingPriceMin: z.number().int().nonnegative().max(PRICE_MAX).optional(),
  askingPriceMax: z.number().int().nonnegative().max(PRICE_MAX).optional(),
  minRevenue: z.number().int().nonnegative().max(PRICE_MAX).optional(),
  minCashFlow: z.number().int().nonnegative().max(PRICE_MAX).optional(),
  sbaFriendly: z.boolean().default(false),
  includeRealEstate: z.boolean().optional(),
  // Built FROM `DIRECTIVE_FIELDS`, so what the manifest advertises and what the
  // API accepts are the same declaration. Strict: an unknown directive key is a
  // 400, not a silently ignored field.
  directives: directivesSchema(DIRECTIVE_FIELDS),
  language: z.enum(['en', 'es', 'fr', 'pt']).default('en'),
  /** Public cost/scope knob. 'essential' (~half cost, core sections) | 'comprehensive' (full report). */
  mode: modeParamSchema,
})
  // Industry is not strictly required — but if it's omitted, the analysts need
  // SOMETHING to hunt for, so at least one keyword is. Enforced here so the API
  // (not just the web forms) rejects an empty, contextless request.
  //
  // There used to be a free-text `instructions` param that stood in for the
  // industry, and it went straight into every agent's system prompt (Javier,
  // 2026-08-17: the buyer's free text never reaches the prompt — it only fills
  // the structured params, through the preflight assist or by hand).
  .superRefine((v, ctx) => {
    const hasIndustry = !!v.industry && v.industry.trim().length > 0;
    if (!hasIndustry && v.keywords.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['industry'],
        message: 'Specify an industry, or at least one keyword, so the analysts know what to hunt for.',
      });
    }
  });

export type FloridaBusinessParams = z.infer<typeof paramsSchema>;

// --- Reusable field notes ("Markdown" = the model writes Markdown here) ------

const md = (what: string) => `${what} (Markdown).`;

// --- Typed sections ----------------------------------------------------------
//
// A note on array minimums, because they look too permissive on purpose.
//
// The TARGET count lives in each section's guidance and in `.describe()` — that is
// what the model reads, and what it is asked for. The SCHEMA floor is 1: enough to
// reject an empty section, not enough to be a weapon.
//
// The floor used to BE the target, which made the schema the enforcement
// mechanism. A request saying "keep every list short; skip anything you can't
// double-source" — a reasonable thing for a buyer to write — then made the schema
// unsatisfiable: every agent threw, every attempt retried, every dispatch repeated,
// and the job burned its budget before degrading into placeholders that satisfied
// the floor anyway. A hard floor never produced the eighth risk. It only decided
// how much was spent failing to.

const listing = z.object({
  business: z.string().describe('Business or listing title.'),
  location: z.string().describe('City / county in Florida.'),
  askingPrice: z.number().nullable().describe('Asking price in USD, or null if unknown.'),
  revenue: z.number().nullable().describe('Annual revenue in USD, or null.'),
  cashFlowSde: z.number().nullable().describe('Annual cash flow / SDE in USD, or null.'),
  match: z.enum(['strict', 'relaxed']).default('strict').describe('Whether it meets the strict criteria or is a relaxed next-best match.'),
  relaxedNote: z.string().nullable().describe('If relaxed: which criteria were loosened and why; else null.'),
  duplicateWarning: z
    .string()
    .nullable()
    .describe('If this may be the SAME business as another listing (uncertain — different marketplace/price/wording), a note flagging the possible duplicate to verify; else null.'),
  sourceUrl: z.string().describe('URL of the listing.'),
});

const deepDive = z.object({
  business: z.string(),
  match: z.enum(['strict', 'relaxed']).default('strict').describe('Strict criteria match, or a relaxed next-best pick.'),
  relaxedNote: z.string().nullable().describe('If relaxed: which criteria were loosened and why; else null.'),
  overview: z.string().describe(md('2-3 paragraph overview: what the business does, history, industry position')),
  askingPrice: z.number().nullable(),
  financials: z.string().describe(md('Detailed financials: revenue, SDE/EBITDA, cash flow, margins, trends, with figures')),
  impliedMultiple: z.string().nullable().describe(md('Implied multiple(s); enriched by valuation, null if unknown')),
  includedAssets: z.string().describe(md('Equipment, inventory, IP, real estate included — itemized')),
  leaseTerms: z.string().describe(md('Lease / real-estate terms in detail')),
  reasonForSale: z.string().describe(md('Stated reason for sale + analysis of what it signals')),
  growthOpportunities: z.string().describe(md('Concrete growth opportunities with reasoning')),
  risks: z.array(riskItemSchema).min(1).describe('At least 3 specific prioritised risks (severity + title + detail), most-severe first.'),
  sourceUrl: z.string(),
});

const mention = z.object({
  platform: z.string().describe('Reddit, Trustpilot, Google/Yelp Reviews, BBB, industry forum, etc.'),
  url: z.string(),
  topic: z.string().describe('What the thread/review is about.'),
  summary: z.string().describe(md('Faithful quote or summary of the experience/review')),
  sentiment: z.enum(['positive', 'mixed', 'negative', 'neutral']),
});

const sections: ReportSection[] = [
  {
    key: 'executive_summary',
    title: 'Executive Summary',
    guidance:
      'A decision-ready brief: an overview of 2-3 paragraphs, at least 6 key findings (top opportunities, ' +
      'headline prices/valuations, market signals), one top recommendation (a full paragraph), and ' +
      'immediate next steps. Derive strictly from the other finished sections.',
    schema: z.object({
      metrics: z.array(metricSchema).min(1).describe('4-6 headline deal numbers as badges (e.g. targets found, price range, combined revenue/SDE, best ROI).'),
      overview: z.string().describe(md('2-3 paragraph overview')),
      keyFindings: z.array(z.string()).min(1).describe('≥6 findings (Markdown bullets).'),
      topRecommendation: z.string().describe(md('The single top recommendation, a full paragraph')),
      immediateNextSteps: z.array(z.string()).min(1).describe('≥4 next steps (Markdown bullets).'),
    }),
  },
  {
    key: 'search_criteria',
    title: 'Search Criteria',
    guidance: 'Restate the exact criteria used for the search (from the brief), plus a short paragraph framing the mandate.',
    schema: z.object({
      location: z.string(),
      industry: z.string().nullable(),
      priceBand: z.string().nullable(),
      revenueFloor: z.string().nullable(),
      cashFlowFloor: z.string().nullable(),
      financingPreference: z.string().nullable(),
      realEstatePreference: z.string().nullable(),
      targetCount: z.number(),
      keywords: z.array(z.string()),
      mandateSummary: z.string().describe(md('A paragraph framing the acquisition mandate')),
    }),
  },
  {
    key: 'market_overview',
    title: 'Florida Market Overview',
    guidance:
      'A thorough market analysis (≥600 words, several paragraphs): the small-business-for-sale climate in ' +
      'Florida for the target industry — demand, buyer competition, seasonality, typical deal sizes, sector ' +
      'unit economics, and Florida-specific tailwinds/headwinds (tourism, population growth, no state income ' +
      'tax, hurricane/insurance exposure). Use concrete figures and cite sources inline. ALSO pull out the 4-6 ' +
      'most important headline numbers into `metrics` (badges) — e.g. market size, service season length, ' +
      'YoY growth, typical ticket/deal size — so they can be shown at a glance.',
    schema: z.object({
      overview: z.string().describe(md('Market overview prose, ≥600 words')),
      metrics: z.array(metricSchema).min(1).describe('4-6 headline market numbers as badges (size, seasonality, growth, typical ticket/deal size).'),
    }),
  },
  {
    key: 'competitive_landscape',
    title: 'Competitive Landscape',
    guidance:
      'Analyze competition and market structure for this industry in the target geography: saturation, key ' +
      'competitors/chains, how independents differentiate, pricing dynamics, barriers to entry, and demand ' +
      'drivers (local demographics, density, foot traffic). ≥400 words of analysis plus the competitor list.',
    schema: z.object({
      overview: z.string().describe(md('Market structure, saturation & demand drivers, ≥400 words')),
      competitors: z.array(
        z.object({
          name: z.string(),
          positioning: z.string().describe(md('How they compete / their niche')),
          source: z.string().describe(md('Source (inline link)')),
        }),
      ),
      differentiation: z.string().describe(md('How an acquirer could differentiate / win')),
      barriersToEntry: z.string().describe(md('Barriers to entry and what they mean for the buyer')),
    }),
  },
  {
    key: 'shortlist',
    title: 'Shortlist of Businesses for Sale',
    guidance:
      'One entry per REAL matching listing found via search (never invent listings). Aim to surface as many ' +
      'qualified listings as the evidence supports. List STRICT-criteria matches first (match:"strict"); if ' +
      'those are few, use your specialist judgment to relax criteria and add clearly-labeled next-best ones ' +
      '(match:"relaxed", with `relaxedNote` saying what was loosened) — never leave the shortlist empty. ' +
      'Unknown numeric fields are null.',
    schema: z.array(listing),
  },
  {
    key: 'deep_dives',
    title: 'Detailed Listing Profiles',
    guidance:
      'For each of the top targetCount listings, a rich full-page profile (each field several sentences to ' +
      'paragraphs): overview, detailed financials, implied multiple, itemized included assets, lease/real- ' +
      'estate terms, reason for sale + what it signals, concrete growth opportunities, and ≥3 specific risks. ' +
      'Cite the source URL.',
    schema: z.array(deepDive),
  },
  {
    key: 'financial_analysis',
    title: 'Financial Analysis & Projections',
    guidance:
      'A quantitative analysis for the shortlisted targets: normalized SDE/earnings, a 3-year outlook with ' +
      'stated assumptions, ROI / payback estimate, and SBA 7(a) debt-service-coverage feasibility (typical ' +
      '10-25% down, 10-yr amortization). Explain methodology. Use ranges when exact figures are unknown; ' +
      'never fabricate — mark assumptions clearly.',
    schema: z.object({
      methodology: z.string().describe(md('How the analysis is built + caveats, ≥150 words')),
      projections: z.array(
        z.object({
          business: z.string(),
          normalizedSde: z.string().describe(md('Normalized SDE/earnings with add-backs reasoning')),
          threeYearOutlook: z.string().describe(md('3-year revenue/earnings outlook + assumptions')),
          roiPaybackYears: z.string().nullable().describe(md('ROI / payback estimate, or null')),
          sbaDebtServiceCoverage: z.string().nullable().describe(md('SBA DSCR feasibility, or null')),
          assumptions: z.string().describe(md('Explicit assumptions used')),
        }),
      ),
      commentary: z.string().describe(md('Cross-target financial commentary, ≥200 words')),
      projection: projectionTableSchema.nullable().describe(
        'A consolidated NUMERIC 3-year projection for the leading target(s) — rows like Revenue, SDE, Cash flow, ' +
        'SBA debt service — across Year 1/2/3, for a table + chart. Use best estimates with the stated assumptions; ' +
        'null only if no figures are estimable.',
      ),
    }),
  },
  {
    key: 'valuation_benchmarks',
    title: 'Valuation Benchmarks',
    guidance:
      'Typical valuation multiples for this sector/size in Florida (SDE, EBITDA, revenue), with sources, plus ' +
      '≥250 words of commentary comparing the shortlisted asking prices against them (under/over-priced).',
    schema: z.object({
      commentary: z.string().describe(md('Comparison of asking prices vs benchmarks, ≥250 words')),
      multiples: z.array(
        z.object({
          metric: z.string().describe('e.g. "SDE multiple", "EBITDA multiple", "revenue multiple".'),
          typicalRange: z.string().describe('e.g. "2.0x-3.5x SDE".'),
          source: z.string().describe(md('Source (inline link)')),
        }),
      ),
    }),
  },
  {
    key: 'comparable_transactions',
    title: 'Comparable Transactions',
    guidance:
      'Recent comparable business sales in this sector/geography (from broker data, listings marked sold, ' +
      'industry reports): what they sold for and at what multiple. Only real, sourced comparables; if few ' +
      'exist, say so and use proxies. Include ≥150 words of commentary on what the comps imply for pricing.',
    schema: z.object({
      commentary: z.string().describe(md('What the comps imply for pricing, ≥150 words')),
      transactions: z.array(
        z.object({
          description: z.string(),
          location: z.string().nullable(),
          salePrice: z.number().nullable(),
          revenue: z.number().nullable(),
          multiple: z.string().nullable(),
          date: z.string().nullable(),
          source: z.string().describe(md('Source (inline link)')),
        }),
      ),
    }),
  },
  {
    key: 'regulatory_licensing',
    title: 'Regulatory & Licensing (Florida)',
    guidance:
      'A detailed treatment (≥400 words) of Florida-specific licenses/permits for operating and for the ' +
      'ownership transfer of this business type (DBPR, liquor/food, occupational, county-level, ' +
      'environmental). Note any that do not transfer automatically and the process/timeline to re-apply.',
    schema: z.string().describe(md('Regulatory & licensing prose, ≥400 words')),
  },
  {
    key: 'financing_options',
    title: 'Financing Options',
    guidance:
      'A detailed financing analysis (≥400 words): SBA 7(a) eligibility and typical structure (down payment, ' +
      'rate, term), conventional and seller-financing norms for the sector, earn-outs, and deal-specific ' +
      'notes. Tie back to the sbaFriendly preference if set. Include an illustrative capital stack.',
    schema: z.string().describe(md('Financing options prose, ≥400 words')),
  },
  {
    key: 'community_insights',
    title: 'Community Insights & Reviews',
    guidance:
      'Real experiences and recommendations from people who made similar investments (Reddit and industry ' +
      'forums) and customer reviews of the target business or close comparables (Trustpilot, Google/Yelp, ' +
      'BBB). Every mention must be a real thread/review found via search; if none are found, return an empty ' +
      'mentions array and say so. ≥250 words of synthesis. Sentiment must reflect the evidence.',
    schema: z.object({
      overview: z.string().describe(md('Synthesis of community sentiment and takeaways, ≥250 words')),
      mentions: z.array(mention),
    }),
  },
  {
    key: 'risks_red_flags',
    title: 'Risks & Red Flags',
    guidance:
      'At least 8 cross-cutting diligence risks. For EACH: a short `title`, a `severity` (high/medium/low) so it ' +
      'can be colour-coded and prioritised, and `detail` (claim + why it matters + how to test it): customer ' +
      'concentration, owner dependence, declining trends, lease risk, deferred capex, litigation/regulatory ' +
      'exposure, insurance/hurricane exposure, negative community signals. Order most-severe first.',
    schema: z.array(riskItemSchema).min(1).describe('≥8 prioritised risks (severity + title + detail), most-severe first.'),
  },
  {
    key: 'due_diligence_checklist',
    title: 'Due Diligence Checklist',
    guidance:
      'A structured diligence checklist grouped by category (Financial, Legal, Operational, Commercial/Market, ' +
      'Regulatory, Real Estate/Lease, HR). At least 5 categories, each with ≥3 concrete, specific items ' +
      '(documents to request, questions to ask, checks to run).',
    schema: z.object({
      categories: z
        .array(
          z.object({
            category: z.string(),
            items: z.array(z.string()).min(1).describe('≥3 concrete diligence items (Markdown).'),
          }),
        )
        .min(1),
    }),
  },
  {
    key: 'growth_playbook',
    title: 'Value-Creation & Growth Playbook',
    guidance:
      'A post-acquisition value-creation plan: a first-100-days list, growth levers (with rationale), and ' +
      'operational improvements — grounded in the specific targets and market. Compose from the finished ' +
      'sections; ≥200 words of commentary.',
    schema: z.object({
      first100Days: z.array(z.string()).min(1).describe('≥5 first-100-days actions (Markdown bullets).'),
      growthLevers: z
        .array(z.object({ lever: z.string(), rationale: z.string().describe(md('Why it works here')) }))
        .min(1)
        .describe('≥4 growth levers, each with its rationale.'),
      operationalImprovements: z.array(z.string()).min(1).describe('≥4 operational improvements (Markdown).'),
      commentary: z.string().describe(md('Value-creation thesis, ≥200 words')),
    }),
  },
  {
    key: 'recommendations',
    title: 'Recommendations & Next Steps',
    guidance:
      'Which listings to pursue first and why (ranked, with rationale), then concrete next diligence steps. ' +
      'Compose from the finished sections. ≥3 ranked targets and ≥6 next steps.',
    schema: z.object({
      pursueFirst: z.array(z.string()).min(1).describe('≥3 ranked targets with rationale (Markdown bullets).'),
      nextSteps: z.array(z.string()).min(1).describe('≥6 concrete next steps (Markdown bullets).'),
    }),
  },
  {
    key: 'charts',
    title: 'Charts',
    // Both agents that touch this section are synthesizers — no research loop — so
    // anything they must be told belongs HERE. It used to live in their `focus`,
    // which only the research kickoff renders, so neither ever read it: the
    // refiner's "drop empty or misleading ones" was dead while the engine's rewrite
    // preamble told it to never drop an item (round 7, R7-18). Reconciled below, in
    // one sentence, in the place both of them do read.
    guidance:
      'Build 3-6 charts that visualize the report’s real numbers so a reader grasps them at a glance — e.g. ' +
      'asking prices across the shortlist (bar), valuation multiples (bar), a 3-year financial projection ' +
      '(line), comparable sale prices (bar) or market size (bar/line). For each: a clear title, the chart ' +
      'type, category `labels`, and numeric `series` aligned to those labels (set `unit` like "$" or "x"). ' +
      'Use ONLY figures already present in the finished report — never invent data, and never invent a number ' +
      'to complete a series. If there is not enough quantitative data, return an empty array.\n' +
      'If charts already exist you are REWRITING them: keep and improve every chart whose numbers are in the ' +
      'report, and add an obviously-missing one grounded in the refined listing profiles and valuations. Drop ' +
      'a chart ONLY when it is empty or its numbers are not in the report — never because you have nothing to ' +
      'add to it.',
    schema: z.array(chartSchema),
  },
  {
    key: 'sources',
    title: 'Sources',
    guidance: 'Every source URL used, de-duplicated. Filled automatically from the evidence store.',
    derived: true,
    schema: z.object({
      items: z.array(z.object({ id: z.number(), url: z.string(), label: z.string() })),
    }),
    // Deduped by canonical URL (ignoring www/trailing-slash/tracking params).
    derive: ({ sources }) => ({
      items: dedupeSources(sources as { title: string; url: string; snippet: string }[]).map((s, i) => ({
        id: i + 1,
        url: s.url,
        label: s.title || s.url,
      })),
    }),
  },
];

// --- Agent workflow ----------------------------------------------------------

const agents: AgentSpec[] = [
  {
    id: 'market-analyst',
    role: 'producer',
    objective: 'Establish the Florida market context and restate the search criteria.',
    produces: ['search_criteria', 'market_overview'],
    researchBudget: 8,
  },
  {
    id: 'competition-analyst',
    role: 'producer',
    objective: 'Map the competitive landscape and demand drivers for the industry in the target geography.',
    produces: ['competitive_landscape'],
    researchBudget: 8,
    focus: 'Competitor chains/independents, saturation, local demographics & density, barriers to entry.',
  },
  {
    id: 'deal-scout',
    role: 'producer',
    objective: 'Find specific real listings and profile the top targets in depth.',
    produces: ['shortlist', 'deep_dives'],
    researchBudget: 24,
    focus:
      'BizBuySell, BizQuest, LoopNet, Sunbelt Network, Transworld, and reputable Florida brokers. ' +
      'fetch_page each promising listing for asking price, revenue, SDE, cash flow, and lease terms. ' +
      'Cite each listing’s OWN detail-page URL (the specific listing), never the search/browse page. ' +
      'If strict matches are scarce, relax criteria (price band, geography within FL, adjacent industries) ' +
      'to surface the next-best options — mark them match:"relaxed" and note what you loosened.',
    // Suggested (additive) sources: the major business-for-sale marketplaces/brokers.
    sites: [
      'bizbuysell.com',
      'bizquest.com',
      'loopnet.com',
      'businessesforsale.com',
      'businessbroker.net',
      'sunbeltnetwork.com',
      'tworld.com',
      'dealstream.com',
    ],
  },
  {
    id: 'compliance-analyst',
    role: 'producer',
    objective: 'Cover Florida regulatory/licensing and realistic financing paths in depth.',
    produces: ['regulatory_licensing', 'financing_options'],
    researchBudget: 8,
    focus: 'Florida DBPR, county occupational licenses, environmental permits, SBA 7(a), seller financing.',
  },
  {
    id: 'community-analyst',
    role: 'producer',
    objective: 'Surface real community experiences, recommendations, and customer reviews.',
    produces: ['community_insights'],
    researchBudget: 8,
    focus:
      'Search site:reddit.com (r/smallbusiness, r/Entrepreneur, r/sweatystartup and sector subreddits), ' +
      'industry forums, Trustpilot, Google/Yelp reviews, and BBB. fetch_page full threads/reviews. Only ' +
      'report real, findable mentions.',
    // Suggested (additive) sources: community + review platforms.
    sites: ['reddit.com', 'trustpilot.com', 'yelp.com', 'bbb.org'],
  },
  {
    id: 'valuation-analyst',
    role: 'producer',
    objective: 'Benchmark valuation multiples, gather comparable transactions, and add implied multiples to deep dives.',
    produces: ['valuation_benchmarks', 'comparable_transactions'],
    enriches: ['deep_dives'],
    dependsOn: ['deal-scout'],
    researchBudget: 10,
    focus: 'Sector SDE/EBITDA/revenue multiples + recent comparable sales for Florida small businesses.',
  },
  {
    id: 'financial-analyst',
    role: 'producer',
    objective: 'Build normalized earnings, 3-year projections, ROI/payback, and SBA debt-service feasibility.',
    produces: ['financial_analysis'],
    dependsOn: ['deal-scout', 'valuation-analyst'],
    researchBudget: 6,
    focus: 'SBA 7(a) terms, sector margins/benchmarks to normalize earnings and stress-test debt service.',
  },
  {
    id: 'risk-analyst',
    role: 'producer',
    objective: 'Synthesize cross-cutting risks and a structured due-diligence checklist.',
    produces: ['risks_red_flags', 'due_diligence_checklist'],
    dependsOn: ['deal-scout', 'community-analyst'],
    researchBudget: 5,
  },
  {
    id: 'market-refiner',
    role: 'producer',
    objective: 'Refine the market overview into a deeper, more data-rich analysis (pro pass).',
    enriches: ['market_overview'],
    dependsOn: ['market-analyst'],
    researchBudget: 5,
    focus:
      'Deepen the market narrative with concrete figures — market size, growth rates, typical margins, ' +
      'transaction volumes, and Florida-specific dynamics. Fill thin spots with a few targeted searches.',
  },
  {
    id: 'deep-dive-refiner',
    role: 'producer',
    objective: 'Refine every listing profile: fill missing financials/lease/risks and polish (pro pass).',
    enriches: ['deep_dives'],
    dependsOn: ['deal-scout', 'valuation-analyst'],
    researchBudget: 10,
    focus:
      'For each profile, fill gaps left by the scout and valuation passes — missing revenue/SDE/cash flow, ' +
      'lease terms, included assets, reason for sale, and concrete risks. Keep the implied multiples already ' +
      'added. fetch_page listing URLs for details still marked n/a. Expand each profile toward a full page.',
  },
  {
    id: 'chart-analyst',
    role: 'synthesizer',
    objective: 'Turn the report’s quantitative findings into chart specs (title, type, labels, series).',
    produces: ['charts'],
    dependsOn: ['deal-scout', 'valuation-analyst', 'financial-analyst', 'market-refiner'],
    // No `focus`: a synthesizer has no research loop to render one. What it needs
    // is in the `charts` section guidance, which every write prompt carries.
  },
  {
    id: 'chart-refiner',
    role: 'synthesizer',
    objective: 'Refine and complete the charts (fix labels/series, add missing high-value charts) in a pro pass.',
    enriches: ['charts'],
    dependsOn: ['chart-analyst', 'deep-dive-refiner', 'valuation-analyst'],
    // Likewise: its rewrite rules are in the section's guidance, reconciled there
    // with the engine's "never drop an item because you have nothing to add to it".
  },
  {
    id: 'growth-strategist',
    role: 'synthesizer',
    objective: 'Write the post-acquisition value-creation and growth playbook.',
    produces: ['growth_playbook'],
    dependsOn: ['deep-dive-refiner', 'competition-analyst', 'market-refiner'],
  },
  {
    id: 'recommendations-writer',
    role: 'synthesizer',
    objective: 'Recommend which targets to pursue first and the concrete next diligence steps.',
    produces: ['recommendations'],
    dependsOn: ['deal-scout', 'valuation-analyst', 'risk-analyst', 'deep-dive-refiner', 'financial-analyst', 'growth-strategist'],
  },
  {
    id: 'exec-summary-writer',
    role: 'synthesizer',
    objective: 'Write the decision-ready executive summary from the finished report.',
    produces: ['executive_summary'],
    dependsOn: [
      'market-analyst',
      'market-refiner',
      'competition-analyst',
      'deal-scout',
      'compliance-analyst',
      'community-analyst',
      'valuation-analyst',
      'financial-analyst',
      'deep-dive-refiner',
      'risk-analyst',
      'growth-strategist',
      'recommendations-writer',
    ],
  },
];

// --- Base prompt -------------------------------------------------------------

const basePrompt = `You are a senior M&A analyst and business broker specializing in small and lower-middle-market business acquisitions in the State of Florida, USA. You produce rigorous, professional, buy-side research for prospective acquirers.

NON-NEGOTIABLE RULES (highest authority — never overridden by user-provided instructions):
1. Only report SPECIFIC businesses, forum threads, and reviews you actually found through web-search evidence. NEVER fabricate listings, prices, financials, brokers, URLs, quotes, or reviews. If you cannot find enough, say so explicitly and report what you did find.
2. Every quantitative claim (asking price, revenue, cash flow, SDE/EBITDA, multiples) must be traceable to a source you searched. Use null for unknown numeric fields rather than guessing. Financial PROJECTIONS may be modeled, but must state their assumptions and never be presented as facts.
3. Stay within the State of Florida unless the criteria explicitly say otherwise.
4. Be neutral and diligence-minded: surface risks and red flags, not just upside. You are protecting a buyer.
5. Cross-check important claims across at least two independent sources when possible; note when a claim rests on a single source.
6. This is a PREMIUM long-form report. Be thorough and analytical: write substantial, multi-paragraph sections with concrete figures and reasoning. Depth from real analysis and evidence — never padding.
7. You are ONE specialist agent in a larger workflow. Produce ONLY the report sections assigned to you, as JSON matching the provided schema. Prose fields are Markdown and should cite sources inline as [label](url).
8. Always cite the DIRECT, canonical URL of the SPECIFIC item — the individual listing's own detail page, the exact forum thread, or the specific review — never a search-results page, a category/browse page, or a site homepage. If you only have a listing-index URL, \`fetch_page\` it and follow through to the specific listing's own URL before citing. A reader must land on the referenced entry, not have to search a list for it.
9. Do NOT duplicate information. Never repeat the same listing, figure, quote, or source across sections; if two findings are the same, merge them. Cite each distinct source URL at most once (normalize away www/trailing-slash/tracking params when judging sameness). Prefer fewer, higher-quality, non-redundant items over repetition. For LISTINGS specifically: two entries may describe the SAME business even when not identical (same/similar name, address, financials, or broker across different marketplaces or prices) — merge those you are confident are the same into ONE listing. If you SUSPECT but are not sure two listings are the same business, keep them but set \`duplicateWarning\` on the affected entry explaining the possible duplicate so the buyer can verify. Never silently drop a possibly-distinct listing.
10. NEVER deliver an empty or barely-populated report. If the strict criteria yield too few qualified results, use your expertise as a Florida M&A specialist to PROGRESSIVELY RELAX them toward the next-best opportunities — widen the price band, expand the geography within Florida, or loosen the industry to adjacent categories a buyer would realistically consider — relaxing as little as needed, in the order that best preserves the buyer's intent. ALWAYS: (a) show the strict-criteria matches first; (b) then clearly-labeled relaxed matches (at least a few), so the report shows the research went further; and (c) state exactly which criteria were relaxed and why. Mark each listing's \`match\` as "strict" or "relaxed" and put the relaxation in \`relaxedNote\`.`;

// --- Template ----------------------------------------------------------------

export const floridaBusinessForSale: ResearchTemplate<FloridaBusinessParams> = {
  id: 'florida-business-for-sale',
  name: 'Florida Businesses for Sale — Buy-Side Research',
  description:
    'Scans the market for specific businesses for sale in Florida matching your criteria and produces an ' +
    'essential or comprehensive long-form buy-side acquisition report (market & competition, shortlist, deep dives, ' +
    'financial projections, valuations & comparables, community reviews, risks, diligence checklist, growth ' +
    'playbook, financing, and next steps).',
  // Bump on any change to the report SHAPE — it flows to meta.templateVersion +
  // meta.schemaVersion ("<id>@<version>") so the front can identify a report's
  // version and render it safely.
  //   v2: added the `charts` section (chart-analyst + chart-refiner agents).
  //   v3: structured primitives (blocks.ts) — metric[] badges, projectionTable,
  //       prioritised riskItem[] replace plain prose/strings in several sections.
  version: 3,
  basePrompt,
  paramsSchema,
  sections,
  agents,
  // Public API exposes only `mode`; these map it to internal cost/scope.
  modes: {
    /**
     * The per-job cost ceilings, and why they are not one number.
     *
     * Both modes shared the deployment default of $20 — 5x what a real
     * comprehensive job costs and 10x an essential one, so it caught nothing short
     * of a catastrophe, and it sat ABOVE what either report earns: a job that
     * reached it was a loss the moment it did (D1).
     *
     * Two facts set these, and they are different in kind:
     *   - **What a job costs.** MEASURED, once, from a real run:
     *     `out/local-aa4b3edf/trace.json` is a completed comprehensive at
     *     **$3.885843** ($3.006 LLM over 4.10M in / 206k out, $0.88 search over 55
     *     calls). The honest FIXTURE estimates $2.65, so the estimate runs ~1.47x
     *     low; essential has no real run at all and is inferred at ~$1.92 by
     *     scaling the fixture's $1.31 by that factor. One run is not a p95 — when
     *     production volume exists, re-derive both from `trace.cost`.
     *   - **What a job earns.** `credits x CREDIT_FLOOR_USD`, the cheapest pack:
     *     $15.48 comprehensive, $4.30 essential.
     *
     * Comprehensive gets **$10** — 2.6x the measured cost, and still $5.48 of margin
     * if a job ever reaches it. Essential gets **$3.50**, and that number is set by
     * REVENUE rather than by cost: 2.5x its inferred cost would be $4.80, which is
     * more than the $4.30 the report earns. At 1.8x the honest cost it is thinner
     * headroom than a ceiling should have, and the honest reading is that five
     * credits does not buy enough room — the structural fix is what a report costs
     * in credits, not a bigger ceiling.
     *
     * A job that reaches its ceiling is HELD for an admin, not failed and not
     * refunded, so a tight ceiling spends someone's attention rather than money.
     * That is the trade being made here, deliberately, on the cheaper mode.
     */
    comprehensive: {
      label: 'Comprehensive',
      budgetScale: 1,
      depth: 'standard',
      credits: 18,
      maxCostUsd: 10,
      params: { targetCount: 6 },
    },
    essential: {
      label: 'Essential',
      budgetScale: 0.5,
      depth: 'light',
      credits: 5,
      maxCostUsd: 3.5,
      // Drop the heaviest analytical sections (~half the cost, core report kept).
      exclude: [
        'competitive_landscape',
        'financial_analysis',
        'comparable_transactions',
        'due_diligence_checklist',
        'growth_playbook',
        'charts',
      ],
      params: { targetCount: 3 },
    },
  },
  // The structured "what the client wants". Anything a buyer says often enough
  // belongs here, where it cannot contradict a schema; what they type in their own
  // words fills these fields (and `keywords`) through the preflight assist — it
  // never reaches a prompt itself.
  directives: { key: 'directives', fields: DIRECTIVE_FIELDS },
  // Confirm-step review: deterministic summary + rules, and the whitelist the
  // assisted (LLM) pass may propose corrections for. See florida-preflight.ts.
  preflight: floridaPreflight,
  // `keywords` is the last channel by which a buyer's own prose reaches an agent's
  // prompt — the free text is not a param, directive values are ours, and every
  // other field is typed. Off the client surface for now, kept in the schema and
  // in `buildBrief` so it comes back by deleting this line (Javier, 2026-08-19).
  internalParams: ['keywords'],
  // Paid post-report deliverables this model offers (credits are the code
  // default; overridable per model in Firestore via /admin/pricing). Generators
  // ship later — the catalog + prices are defined here.
  addons: [
    { key: 'deck', label: 'Pitch deck (PDF)', credits: 10, description: 'An investor-ready slide deck summarizing the opportunity.' },
    { key: 'docx', label: 'Editable Word (.docx)', credits: 3, description: 'The full report as an editable Word document.' },
  ],
  // How the admin form (and any model-specific web app) should render the params:
  // a condensed layout (paired min/max on one row), per-field help, and suggested
  // values that still allow manual entry. See docs/model-ui.md.
  // What the PDF cover summarises. These were hardcoded in the renderer as this
  // model's own field names, so any other model's dossier had no cover statistics
  // and no entity cards at all.
  cover: {
    from: ['shortlist', 'deep_dives'],
    nameKey: 'business',
    figures: [
      { labelKey: 'targets', agg: 'count' },
      { labelKey: 'priceRange', agg: 'range', field: 'askingPrice' },
      { labelKey: 'combinedRevenue', agg: 'sum', field: 'revenue' },
      { labelKey: 'combinedSde', agg: 'sum', field: 'cashFlowSde' },
    ],
    tiles: [
      { labelKey: 'revenue', field: 'revenue' },
      { labelKey: 'sde', field: 'cashFlowSde' },
      { labelKey: 'asking', field: 'askingPrice' },
    ],
  },
  paramsUi: {
    rows: [
      ['industry', 'location'],
      ['mode', 'language'],
      ['askingPriceMin', 'askingPriceMax'],
      ['minRevenue', 'minCashFlow'],
      ['sbaFriendly', 'includeRealEstate'],
    ],
    // Asking price is a single range slider (dragging to an end = no bound).
    ranges: [
      { label: 'Asking price', minKey: 'askingPriceMin', maxKey: 'askingPriceMax', min: 0, max: 5_000_000, step: 25_000, prefix: '$' },
    ],
    // Secondary inputs live in a collapsed "Advanced" section.

    // Directives are in `paramsSchema` (so the API validates them) but must not be
    // rendered by the generic form builder — a client that fell back to the JSON
    // Schema would draw a raw object editor. They have their own localized block
    // in the manifest (`directives`), which is what a client renders.
    hidden: ['directives'],
    fields: {
      industry: {
        // Labels live in the MANIFEST now, not in each client. `apps/fbizlab` had a
        // four-language map keyed by these very field names, so a second catalog
        // model drew raw JSON keys as its labels, identically in all four.
        label: 'Industry',
        help: 'Type of business to search for. Pick a suggestion or type your own.',
        placeholder: 'e.g. Laundromats',
        suggestions: [
          'Laundromats', 'Car washes', 'Restaurants', 'HVAC', 'Landscaping',
          'Auto repair', 'Liquor stores', 'Gyms', 'Daycares', 'Self storage',
          'Pest control', 'Medical practices', 'Franchises',
        ],
      },
      location: { label: 'Location', help: 'Geographic focus within Florida.', placeholder: 'e.g. Miami-Dade County, FL' },
      mode: { label: 'Report tier', help: 'Essential = ~half the cost, core sections. Comprehensive = full long-form report.' },
      language: { label: 'Report language', help: 'Language the final report is written in.', optionLabels: LANGUAGE_LABELS },
      askingPriceMin: { label: 'Asking price (min)', help: 'Minimum asking price (USD). Leave blank for no floor.' },
      askingPriceMax: { label: 'Asking price (max)', help: 'Maximum asking price (USD). Leave blank for no ceiling.' },
      minRevenue: { label: 'Minimum revenue', help: 'Minimum annual revenue (USD).' },
      minCashFlow: { label: 'Minimum cash flow / SDE', help: 'Minimum annual cash flow / SDE (USD).' },
      sbaFriendly: { label: 'SBA-friendly', help: 'Prioritize deals likely eligible for SBA 7(a) financing.' },
      includeRealEstate: { label: 'Include real estate', help: 'Prefer deals that include commercial real estate.' },
      keywords: {
        label: 'Keywords',
        help: 'Extra search keywords to bias the hunt.',
        suggestions: ['SBA', 'absentee owner', 'owner financing', 'real estate included', 'turnkey', 'established'],
      },
    },
  },
  // Spanish translations of the client-facing manifest strings (fallback: English).
  i18n: {
    es: {
      name: 'Negocios en Venta en Florida — Investigación de Compra',
      description:
        'Rastrea el mercado en busca de negocios específicos en venta en Florida según tus criterios y produce ' +
        'un reporte de compra essential o comprehensive, extenso y detallado (mercado y competencia, lista corta, perfiles a fondo, ' +
        'proyecciones financieras, valoraciones y comparables, reseñas de la comunidad, riesgos, checklist de ' +
        'debida diligencia, plan de crecimiento, financiamiento y próximos pasos).',
      modeLabels: { essential: 'Esencial', comprehensive: 'Completo' },
      sectionTitles: {
        executive_summary: 'Resumen Ejecutivo',
        search_criteria: 'Criterios de Búsqueda',
        market_overview: 'Panorama del Mercado en Florida',
        competitive_landscape: 'Panorama Competitivo',
        shortlist: 'Lista de Negocios en Venta',
        deep_dives: 'Perfiles Detallados de Negocios',
        financial_analysis: 'Análisis Financiero y Proyecciones',
        valuation_benchmarks: 'Múltiplos de Valoración',
        comparable_transactions: 'Transacciones Comparables',
        regulatory_licensing: 'Regulación y Licencias (Florida)',
        financing_options: 'Opciones de Financiamiento',
        community_insights: 'Opiniones de la Comunidad y Reseñas',
        risks_red_flags: 'Riesgos y Señales de Alerta',
        due_diligence_checklist: 'Checklist de Debida Diligencia',
        growth_playbook: 'Plan de Creación de Valor y Crecimiento',
        recommendations: 'Recomendaciones y Próximos Pasos',
        charts: 'Gráficos',
        sources: 'Fuentes',
      },
      fields: {
        industry: { label: 'Industria', help: 'Tipo de negocio a buscar. Elige una sugerencia o escribe el tuyo.', placeholder: 'ej. Lavanderías', suggestions: ['Lavanderías', 'Lavaderos de autos', 'Restaurantes', 'Climatización', 'Jardinería', 'Taller mecánico', 'Licorerías', 'Gimnasios', 'Guarderías', 'Bodegas de autoalmacenaje', 'Control de plagas', 'Consultorios médicos', 'Franquicias'] },
        location: { label: 'Ubicación', help: 'Enfoque geográfico dentro de Florida.', placeholder: 'ej. Condado de Miami-Dade, FL' },
        mode: { label: 'Nivel del informe', help: 'Esencial = ~mitad del costo, secciones clave. Completo = reporte largo y detallado.' },
        language: { label: 'Idioma del informe', help: 'Idioma en que se escribe el reporte final.' },
        askingPriceMin: { label: 'Precio pedido (mín.)', help: 'Precio mínimo de venta (USD). Déjalo en blanco para sin piso.' },
        askingPriceMax: { label: 'Precio pedido (máx.)', help: 'Precio máximo de venta (USD). Déjalo en blanco para sin techo.' },
        minRevenue: { label: 'Ingresos mínimos', help: 'Ingresos anuales mínimos (USD).' },
        minCashFlow: { label: 'Flujo de caja / SDE mínimo', help: 'Flujo de caja anual mínimo / SDE (USD).' },
        sbaFriendly: { label: 'Apto para SBA', help: 'Priorizar operaciones elegibles para financiamiento SBA 7(a).' },
        includeRealEstate: { label: 'Incluir inmueble', help: 'Preferir operaciones que incluyan inmueble comercial.' },
        keywords: { label: 'Palabras clave', help: 'Palabras clave adicionales para orientar la búsqueda.', suggestions: ['SBA', 'dueño ausente', 'financiación del vendedor', 'incluye inmueble', 'llave en mano', 'establecido'] },
      },
      ranges: { askingPriceMin: 'Precio pedido' },
      // The cover's own vocabulary. These words used to live in BOTH renderers'
      // four-language dictionaries, which is why this model's cover looked right
      // and any other model's printed its raw keys.
      cover: {
        targets: 'Objetivos', priceRange: 'Rango de precio',
        combinedRevenue: 'Ingresos combinados', combinedSde: 'SDE combinado',
        revenue: 'Ingresos', sde: 'SDE', asking: 'Precio',
      },
      agentLabels: {
        'market-analyst': { label: 'Analista de mercado', description: 'Establece el contexto del mercado en Florida y reformula los criterios de búsqueda.' },
        'competition-analyst': { label: 'Analista de competencia', description: 'Mapea el panorama competitivo y los factores de demanda del sector en la zona.' },
        'deal-scout': { label: 'Explorador de negocios', description: 'Encuentra negocios reales en venta y perfila los mejores en detalle.' },
        'compliance-analyst': { label: 'Regulación y financiamiento', description: 'Cubre regulación/licencias de Florida y las rutas de financiamiento realistas.' },
        'community-analyst': { label: 'Opiniones de la comunidad', description: 'Reúne experiencias reales, recomendaciones y reseñas de clientes.' },
        'valuation-analyst': { label: 'Analista de valoración', description: 'Compara múltiplos de valoración y reúne transacciones comparables.' },
        'financial-analyst': { label: 'Analista financiero', description: 'Construye ganancias normalizadas, proyecciones y viabilidad de deuda SBA.' },
        'risk-analyst': { label: 'Analista de riesgos', description: 'Sintetiza los riesgos transversales y un checklist de debida diligencia.' },
        'market-refiner': { label: 'Refinamiento de mercado', description: 'Profundiza el panorama de mercado con más datos concretos.' },
        'deep-dive-refiner': { label: 'Refinamiento de perfiles', description: 'Completa y pule cada perfil de negocio.' },
        'chart-analyst': { label: 'Analista de gráficos', description: 'Convierte las cifras del reporte en especificaciones de gráficos (título, tipo, labels, series).' },
        'chart-refiner': { label: 'Refinamiento de gráficos', description: 'Mejora y completa los gráficos en la etapa de refinamiento.' },
        'growth-strategist': { label: 'Estrategia de crecimiento', description: 'Escribe el plan de creación de valor y crecimiento.' },
        'recommendations-writer': { label: 'Recomendaciones', description: 'Recomienda qué objetivos priorizar y los próximos pasos.' },
        'exec-summary-writer': { label: 'Resumen ejecutivo', description: 'Escribe el resumen ejecutivo a partir del reporte terminado.' },
      },
      addonLabels: {
        deck: { label: 'Pitch deck (PDF)', description: 'Un deck de slides listo para inversionistas resumiendo la oportunidad.' },
        docx: { label: 'Word editable (.docx)', description: 'El reporte completo como documento Word editable.' },
      },
    },
    fr: {
      name: 'Entreprises à Vendre en Floride — Recherche pour Acquéreurs',
      description:
        'Passe le marché au crible pour trouver des entreprises précises à vendre en Floride selon vos critères et ' +
        'produit un rapport d’acquisition essential ou comprehensive, long et détaillé (marché et concurrence, liste courte, ' +
        'profils approfondis, projections financières, valorisations et comparables, avis de la communauté, risques, ' +
        'checklist de due diligence, plan de croissance, financement et prochaines étapes).',
      modeLabels: { essential: 'Essentiel', comprehensive: 'Complet' },
      sectionTitles: {
        executive_summary: 'Synthèse',
        search_criteria: 'Critères de Recherche',
        market_overview: 'Panorama du Marché en Floride',
        competitive_landscape: 'Paysage Concurrentiel',
        shortlist: 'Liste des Entreprises à Vendre',
        deep_dives: 'Profils Détaillés des Entreprises',
        financial_analysis: 'Analyse Financière et Projections',
        valuation_benchmarks: 'Multiples de Valorisation',
        comparable_transactions: 'Transactions Comparables',
        regulatory_licensing: 'Réglementation et Licences (Floride)',
        financing_options: 'Options de Financement',
        community_insights: 'Avis de la Communauté',
        risks_red_flags: 'Risques et Signaux d’Alerte',
        due_diligence_checklist: 'Checklist de Due Diligence',
        growth_playbook: 'Plan de Création de Valeur et de Croissance',
        recommendations: 'Recommandations et Prochaines Étapes',
        charts: 'Graphiques',
        sources: 'Sources',
      },
      fields: {
        industry: { label: 'Secteur', help: 'Type d’entreprise à rechercher. Choisissez une suggestion ou saisissez la vôtre.', placeholder: 'ex. Laveries', suggestions: ['Laveries', 'Stations de lavage', 'Restaurants', 'CVC', 'Paysagisme', 'Garage automobile', 'Cavistes', 'Salles de sport', 'Crèches', 'Self-stockage', 'Dératisation', 'Cabinets médicaux', 'Franchises'] },
        location: { label: 'Localisation', help: 'Zone géographique ciblée en Floride.', placeholder: 'ex. Comté de Miami-Dade, FL' },
        mode: { label: 'Niveau du rapport', help: 'Essentiel = environ la moitié du coût, sections clés. Complet = rapport long et détaillé.' },
        language: { label: 'Langue du rapport', help: 'Langue de rédaction du rapport final.' },
        askingPriceMin: { label: 'Prix demandé (min.)', help: 'Prix de vente minimum (USD). Laissez vide pour aucun plancher.' },
        askingPriceMax: { label: 'Prix demandé (max.)', help: 'Prix de vente maximum (USD). Laissez vide pour aucun plafond.' },
        minRevenue: { label: 'Chiffre d’affaires minimum', help: 'Chiffre d’affaires annuel minimum (USD).' },
        minCashFlow: { label: 'Flux de trésorerie / SDE minimum', help: 'Flux de trésorerie annuel minimum / SDE (USD).' },
        sbaFriendly: { label: 'Éligible SBA', help: 'Prioriser les opérations éligibles au financement SBA 7(a).' },
        includeRealEstate: { label: 'Inclure l’immobilier', help: 'Préférer les opérations incluant l’immobilier commercial.' },
        keywords: { label: 'Mots-clés', help: 'Mots-clés supplémentaires pour orienter la recherche.', suggestions: ['SBA', 'propriétaire absent', 'crédit vendeur', 'immobilier inclus', 'clé en main', 'établi'] },
      },
      ranges: { askingPriceMin: 'Prix demandé' },
      cover: {
        targets: 'Cibles', priceRange: 'Fourchette de prix',
        combinedRevenue: 'Revenu cumulé', combinedSde: 'SDE cumulé',
        revenue: 'Revenu', sde: 'SDE', asking: 'Prix',
      },
      agentLabels: {
        'market-analyst': { label: 'Analyste de marché', description: 'Pose le contexte du marché en Floride et reformule les critères de recherche.' },
        'competition-analyst': { label: 'Analyste de la concurrence', description: 'Cartographie le paysage concurrentiel et les moteurs de demande du secteur dans la zone.' },
        'deal-scout': { label: 'Prospecteur d’affaires', description: 'Trouve des entreprises réellement à vendre et profile les meilleures en détail.' },
        'compliance-analyst': { label: 'Réglementation et financement', description: 'Couvre la réglementation/les licences en Floride et les pistes de financement réalistes.' },
        'community-analyst': { label: 'Avis de la communauté', description: 'Réunit les expériences réelles, recommandations et avis de clients.' },
        'valuation-analyst': { label: 'Analyste de valorisation', description: 'Compare les multiples de valorisation et réunit des transactions comparables.' },
        'financial-analyst': { label: 'Analyste financier', description: 'Construit les résultats normalisés, les projections et la capacité de dette SBA.' },
        'risk-analyst': { label: 'Analyste des risques', description: 'Synthétise les risques transversaux et une checklist de due diligence.' },
        'market-refiner': { label: 'Approfondissement du marché', description: 'Approfondit le panorama de marché avec des données plus concrètes.' },
        'deep-dive-refiner': { label: 'Approfondissement des profils', description: 'Complète et affine chaque profil d’entreprise.' },
        'chart-analyst': { label: 'Analyste graphiques', description: 'Convertit les chiffres du rapport en spécifications de graphiques (titre, type, labels, séries).' },
        'chart-refiner': { label: 'Affinage des graphiques', description: 'Améliore et complète les graphiques lors de l’étape d’affinage.' },
        'growth-strategist': { label: 'Stratégie de croissance', description: 'Rédige le plan de création de valeur et de croissance.' },
        'recommendations-writer': { label: 'Recommandations', description: 'Recommande quelles cibles prioriser et les prochaines étapes.' },
        'exec-summary-writer': { label: 'Synthèse', description: 'Rédige la synthèse à partir du rapport terminé.' },
      },
      addonLabels: {
        deck: { label: 'Pitch deck (PDF)', description: 'Un deck de slides prêt pour des investisseurs résumant l’opportunité.' },
        docx: { label: 'Word éditable (.docx)', description: 'Le rapport complet en document Word éditable.' },
      },
    },
    pt: {
      name: 'Negócios à Venda na Flórida — Pesquisa para Compradores',
      description:
        'Vasculha o mercado em busca de negócios específicos à venda na Flórida conforme seus critérios e produz ' +
        'um relatório de compra essential ou comprehensive, extenso e detalhado (mercado e concorrência, lista curta, ' +
        'perfis aprofundados, projeções financeiras, avaliações e comparáveis, opiniões da comunidade, riscos, ' +
        'checklist de due diligence, plano de crescimento, financiamento e próximos passos).',
      modeLabels: { essential: 'Essencial', comprehensive: 'Completo' },
      sectionTitles: {
        executive_summary: 'Resumo Executivo',
        search_criteria: 'Critérios de Busca',
        market_overview: 'Panorama do Mercado na Flórida',
        competitive_landscape: 'Panorama Competitivo',
        shortlist: 'Lista de Negócios à Venda',
        deep_dives: 'Perfis Detalhados dos Negócios',
        financial_analysis: 'Análise Financeira e Projeções',
        valuation_benchmarks: 'Múltiplos de Avaliação',
        comparable_transactions: 'Transações Comparáveis',
        regulatory_licensing: 'Regulação e Licenças (Flórida)',
        financing_options: 'Opções de Financiamento',
        community_insights: 'Opiniões da Comunidade e Avaliações',
        risks_red_flags: 'Riscos e Sinais de Alerta',
        due_diligence_checklist: 'Checklist de Due Diligence',
        growth_playbook: 'Plano de Criação de Valor e Crescimento',
        recommendations: 'Recomendações e Próximos Passos',
        charts: 'Gráficos',
        sources: 'Fontes',
      },
      fields: {
        industry: { label: 'Setor', help: 'Tipo de negócio a buscar. Escolha uma sugestão ou escreva o seu.', placeholder: 'ex. Lavanderias', suggestions: ['Lavanderias', 'Lava-rápidos', 'Restaurantes', 'Climatização', 'Paisagismo', 'Oficina mecânica', 'Lojas de bebidas', 'Academias', 'Creches', 'Self-storage', 'Controle de pragas', 'Consultórios médicos', 'Franquias'] },
        location: { label: 'Localização', help: 'Foco geográfico dentro da Flórida.', placeholder: 'ex. Condado de Miami-Dade, FL' },
        mode: { label: 'Nível do relatório', help: 'Essencial = ~metade do custo, seções principais. Completo = relatório longo e detalhado.' },
        language: { label: 'Idioma do relatório', help: 'Idioma em que o relatório final é escrito.' },
        askingPriceMin: { label: 'Preço pedido (mín.)', help: 'Preço de venda mínimo (USD). Deixe em branco para sem piso.' },
        askingPriceMax: { label: 'Preço pedido (máx.)', help: 'Preço de venda máximo (USD). Deixe em branco para sem teto.' },
        minRevenue: { label: 'Receita mínima', help: 'Receita anual mínima (USD).' },
        minCashFlow: { label: 'Fluxo de caixa / SDE mínimo', help: 'Fluxo de caixa anual mínimo / SDE (USD).' },
        sbaFriendly: { label: 'Elegível ao SBA', help: 'Priorizar operações elegíveis a financiamento SBA 7(a).' },
        includeRealEstate: { label: 'Incluir imóvel', help: 'Preferir operações que incluam imóvel comercial.' },
        keywords: { label: 'Palavras-chave', help: 'Palavras-chave adicionais para orientar a busca.', suggestions: ['SBA', 'dono ausente', 'financiamento do vendedor', 'imóvel incluído', 'chave na mão', 'estabelecido'] },
      },
      ranges: { askingPriceMin: 'Preço pedido' },
      cover: {
        targets: 'Alvos', priceRange: 'Faixa de preço',
        combinedRevenue: 'Receita combinada', combinedSde: 'SDE combinado',
        revenue: 'Receita', sde: 'SDE', asking: 'Preço',
      },
      agentLabels: {
        'market-analyst': { label: 'Analista de mercado', description: 'Estabelece o contexto do mercado na Flórida e reformula os critérios de busca.' },
        'competition-analyst': { label: 'Analista de concorrência', description: 'Mapeia o panorama competitivo e os fatores de demanda do setor na região.' },
        'deal-scout': { label: 'Explorador de negócios', description: 'Encontra negócios realmente à venda e perfila os melhores em detalhe.' },
        'compliance-analyst': { label: 'Regulação e financiamento', description: 'Cobre regulação/licenças da Flórida e as rotas de financiamento realistas.' },
        'community-analyst': { label: 'Opiniões da comunidade', description: 'Reúne experiências reais, recomendações e avaliações de clientes.' },
        'valuation-analyst': { label: 'Analista de avaliação', description: 'Compara múltiplos de avaliação e reúne transações comparáveis.' },
        'financial-analyst': { label: 'Analista financeiro', description: 'Constrói lucros normalizados, projeções e viabilidade de dívida SBA.' },
        'risk-analyst': { label: 'Analista de riscos', description: 'Sintetiza os riscos transversais e um checklist de due diligence.' },
        'market-refiner': { label: 'Aprofundamento de mercado', description: 'Aprofunda o panorama de mercado com dados mais concretos.' },
        'deep-dive-refiner': { label: 'Aprofundamento de perfis', description: 'Completa e refina cada perfil de negócio.' },
        'chart-analyst': { label: 'Analista de gráficos', description: 'Converte os números do relatório em especificações de gráficos (título, tipo, labels, séries).' },
        'chart-refiner': { label: 'Refinamento de gráficos', description: 'Melhora e completa os gráficos na etapa de refinamento.' },
        'growth-strategist': { label: 'Estratégia de crescimento', description: 'Escreve o plano de criação de valor e crescimento.' },
        'recommendations-writer': { label: 'Recomendações', description: 'Recomenda quais alvos priorizar e os próximos passos.' },
        'exec-summary-writer': { label: 'Resumo executivo', description: 'Escreve o resumo executivo a partir do relatório concluído.' },
      },
      addonLabels: {
        deck: { label: 'Pitch deck (PDF)', description: 'Um deck de slides pronto para investidores resumindo a oportunidade.' },
        docx: { label: 'Word editável (.docx)', description: 'O relatório completo como documento Word editável.' },
      },
    },
  },
  buildBrief: (p) => {
    const lines: string[] = [];
    lines.push(`Find and analyze businesses currently for sale in ${p.location}.`);
    if (p.industry) lines.push(`Industry / business type: ${p.industry}.`);
    if (p.keywords.length) lines.push(`Additional keywords: ${p.keywords.join(', ')}.`);
    const price: string[] = [];
    if (p.askingPriceMin != null) price.push(`min $${p.askingPriceMin.toLocaleString('en-US')}`);
    if (p.askingPriceMax != null) price.push(`max $${p.askingPriceMax.toLocaleString('en-US')}`);
    if (price.length) lines.push(`Asking price band: ${price.join(', ')}.`);
    if (p.minRevenue != null) lines.push(`Minimum annual revenue: $${p.minRevenue.toLocaleString('en-US')}.`);
    if (p.minCashFlow != null) lines.push(`Minimum annual cash flow / SDE: $${p.minCashFlow.toLocaleString('en-US')}.`);
    if (p.sbaFriendly) lines.push('Prioritize deals likely eligible for SBA 7(a) financing.');
    if (p.includeRealEstate === true) lines.push('Prefer deals that include commercial real estate.');
    if (p.includeRealEstate === false) lines.push('Prefer asset/business-only deals (real estate not required).');
    // targetCount is injected internally by the mode config (not a public param).
    const targetCount = Number((p as Record<string, unknown>).targetCount ?? 5);
    lines.push(`Profile the top ${targetCount} matching listings in depth.`);
    return lines.join('\n');
  },
};
