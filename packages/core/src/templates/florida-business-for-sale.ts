import { z } from 'zod';
import { modeParamSchema } from '../mode.js';
import { LANGUAGE_LABELS } from '../languages.js';
import { dedupeSources } from '../tools/sources.js';
import { chartSchema } from './chart.js';
import type { AgentSpec, ReportSection, ResearchTemplate } from './types.js';

// --- Client params -----------------------------------------------------------

// Bounded so a hostile client can't bloat the LLM prompt or the report cost:
// every string is length-capped, every array item-capped, every number ceiling-capped.
const PRICE_MAX = 1_000_000_000; // $1B ceiling — well above any lower-middle-market deal.
/** When no industry is given, instructions must be at least this long for context. */
export const MIN_INSTRUCTIONS_LEN = 40;

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
  preferredSources: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  instructions: z.string().trim().max(2000).optional(),
  language: z.enum(['en', 'es', 'fr', 'pt']).default('en'),
  /** Public cost/scope knob. 'essential' (~half cost, core sections) | 'comprehensive' (full report). */
  mode: modeParamSchema,
})
  // Industry is not strictly required — but if it's omitted, the analysts need
  // enough written context to know what to hunt for, so `instructions` becomes
  // required with a meaningful minimum length. Enforced here so the API (not just
  // the web forms) rejects an empty, contextless request.
  .superRefine((v, ctx) => {
    const hasIndustry = !!v.industry && v.industry.trim().length > 0;
    const instr = v.instructions?.trim() ?? '';
    if (!hasIndustry && instr.length < MIN_INSTRUCTIONS_LEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: `Specify an industry, or describe what to research in the instructions (at least ${MIN_INSTRUCTIONS_LEN} characters) so the analysts have enough context.`,
      });
    }
  });

export type FloridaBusinessParams = z.infer<typeof paramsSchema>;

// --- Reusable field notes ("Markdown" = the model writes Markdown here) ------

const md = (what: string) => `${what} (Markdown).`;

// --- Typed sections ----------------------------------------------------------

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
  risks: z.array(z.string()).min(3).describe('At least 3 specific risks / red flags (Markdown bullets).'),
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
      overview: z.string().describe(md('2-3 paragraph overview')),
      keyFindings: z.array(z.string()).min(6).describe('≥6 findings (Markdown bullets).'),
      topRecommendation: z.string().describe(md('The single top recommendation, a full paragraph')),
      immediateNextSteps: z.array(z.string()).min(4).describe('≥4 next steps (Markdown bullets).'),
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
      'tax, hurricane/insurance exposure). Use concrete figures and cite sources inline.',
    schema: z.string().describe(md('Market overview prose, ≥600 words')),
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
      'At least 8 cross-cutting diligence risks, each a substantial bullet (claim + why it matters + how to ' +
      'test it): customer concentration, owner dependence, declining trends, lease risk, deferred capex, ' +
      'litigation/regulatory exposure, insurance/hurricane exposure, and negative community signals.',
    schema: z.array(z.string()).min(8).describe('≥8 risks (each a substantial Markdown bullet).'),
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
            items: z.array(z.string()).min(3).describe('≥3 concrete diligence items (Markdown).'),
          }),
        )
        .min(5),
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
      first100Days: z.array(z.string()).min(5).describe('≥5 first-100-days actions (Markdown bullets).'),
      growthLevers: z
        .array(z.object({ lever: z.string(), rationale: z.string().describe(md('Why it works here')) }))
        .min(4),
      operationalImprovements: z.array(z.string()).min(4).describe('≥4 operational improvements (Markdown).'),
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
      pursueFirst: z.array(z.string()).min(3).describe('≥3 ranked targets with rationale (Markdown bullets).'),
      nextSteps: z.array(z.string()).min(6).describe('≥6 concrete next steps (Markdown bullets).'),
    }),
  },
  {
    key: 'charts',
    title: 'Charts',
    guidance:
      'Build 3-6 charts that visualize the report’s real numbers so a reader grasps them at a glance — e.g. ' +
      'asking prices across the shortlist (bar), valuation multiples (bar), a 3-year financial projection ' +
      '(line), or comparable sale prices (bar). For each: a clear title, the chart type, category `labels`, ' +
      'and numeric `series` aligned to those labels (set `unit` like "$" or "x"). Use ONLY figures already ' +
      'present in the finished report — never invent data. If there is not enough quantitative data, return ' +
      'an empty array.',
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
    focus:
      'Emit bar/line/pie/area charts from figures ALREADY in the report: shortlist asking prices, valuation ' +
      'multiples, 3-year projections, comparable sale prices, market size. Labels + series must align. Never invent numbers.',
  },
  {
    id: 'chart-refiner',
    role: 'synthesizer',
    objective: 'Refine and complete the charts (fix labels/series, add missing high-value charts) in a pro pass.',
    enriches: ['charts'],
    dependsOn: ['chart-analyst', 'deep-dive-refiner', 'valuation-analyst'],
    focus:
      'Improve the existing charts and add any obviously-missing one grounded in the refined deep-dives and ' +
      'valuations. Keep only charts backed by real report figures; drop empty or misleading ones.',
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
    'Scans the market for specific businesses for sale in Florida matching your criteria and produces a ' +
    'comprehensive, long-form buy-side acquisition report (market & competition, shortlist, deep dives, ' +
    'financial projections, valuations & comparables, community reviews, risks, diligence checklist, growth ' +
    'playbook, financing, and next steps).',
  version: 2, // v2: added the `charts` section (chart-analyst + chart-refiner agents).
  basePrompt,
  paramsSchema,
  sections,
  agents,
  // Public API exposes only `mode`; these map it to internal cost/scope.
  modes: {
    comprehensive: {
      label: 'Comprehensive',
      budgetScale: 1,
      depth: 'standard',
      credits: 18,
      params: { targetCount: 6 },
    },
    essential: {
      label: 'Essential',
      budgetScale: 0.5,
      depth: 'light',
      credits: 5,
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
  instructionsField: 'instructions',
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
    advanced: ['keywords', 'preferredSources', 'instructions'],
    fields: {
      industry: {
        help: 'Type of business to search for. Pick a suggestion or type your own.',
        placeholder: 'e.g. Laundromats',
        suggestions: [
          'Laundromats', 'Car washes', 'Restaurants', 'HVAC', 'Landscaping',
          'Auto repair', 'Liquor stores', 'Gyms', 'Daycares', 'Self storage',
          'Pest control', 'Medical practices', 'Franchises',
        ],
      },
      location: { help: 'Geographic focus within Florida.', placeholder: 'e.g. Miami-Dade County, FL' },
      mode: { help: 'Essential = ~half the cost, core sections. Comprehensive = full long-form report.' },
      language: { help: 'Language the final report is written in.', optionLabels: LANGUAGE_LABELS },
      askingPriceMin: { help: 'Minimum asking price (USD). Leave blank for no floor.' },
      askingPriceMax: { help: 'Maximum asking price (USD). Leave blank for no ceiling.' },
      minRevenue: { help: 'Minimum annual revenue (USD).' },
      minCashFlow: { help: 'Minimum annual cash flow / SDE (USD).' },
      sbaFriendly: { help: 'Prioritize deals likely eligible for SBA 7(a) financing.' },
      includeRealEstate: { help: 'Prefer deals that include commercial real estate.' },
      keywords: {
        help: 'Extra search keywords to bias the hunt.',
        suggestions: ['SBA', 'absentee owner', 'owner financing', 'real estate included', 'turnkey', 'established'],
      },
      preferredSources: {
        help: 'Marketplaces/brokers to prioritize (in addition to the defaults).',
        suggestions: ['bizbuysell.com', 'bizquest.com', 'loopnet.com', 'businessesforsale.com', 'sunbeltnetwork.com'],
      },
      instructions: { help: 'Free-form guidance for the analysts (lower authority than the model’s base rules).' },
    },
  },
  // Spanish translations of the client-facing manifest strings (fallback: English).
  i18n: {
    es: {
      name: 'Negocios en Venta en Florida — Investigación de Compra',
      description:
        'Rastrea el mercado en busca de negocios específicos en venta en Florida según tus criterios y produce ' +
        'un reporte de compra extenso y detallado (mercado y competencia, lista corta, perfiles a fondo, ' +
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
        industry: { help: 'Tipo de negocio a buscar. Elige una sugerencia o escribe el tuyo.', placeholder: 'ej. Lavanderías' },
        location: { help: 'Enfoque geográfico dentro de Florida.', placeholder: 'ej. Condado de Miami-Dade, FL' },
        mode: { help: 'Esencial = ~mitad del costo, secciones clave. Completo = reporte largo y detallado.' },
        language: { help: 'Idioma en que se escribe el reporte final.' },
        askingPriceMin: { help: 'Precio mínimo de venta (USD). Déjalo en blanco para sin piso.' },
        askingPriceMax: { help: 'Precio máximo de venta (USD). Déjalo en blanco para sin techo.' },
        minRevenue: { help: 'Ingresos anuales mínimos (USD).' },
        minCashFlow: { help: 'Flujo de caja anual mínimo / SDE (USD).' },
        sbaFriendly: { help: 'Priorizar operaciones elegibles para financiamiento SBA 7(a).' },
        includeRealEstate: { help: 'Preferir operaciones que incluyan inmueble comercial.' },
        keywords: { help: 'Palabras clave adicionales para orientar la búsqueda.' },
        preferredSources: { help: 'Marketplaces/brokers a priorizar (además de los predeterminados).' },
        instructions: { help: 'Instrucciones libres para los analistas (menor autoridad que las reglas base del modelo).' },
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
        'chart-refiner': { label: 'Refinamiento de gráficos', description: 'Mejora y completa los gráficos en la pasada de refinamiento.' },
        'growth-strategist': { label: 'Estrategia de crecimiento', description: 'Escribe el plan de creación de valor y crecimiento.' },
        'recommendations-writer': { label: 'Recomendaciones', description: 'Recomienda qué objetivos priorizar y los próximos pasos.' },
        'exec-summary-writer': { label: 'Resumen ejecutivo', description: 'Escribe el resumen ejecutivo a partir del reporte terminado.' },
      },
      addonLabels: {
        deck: { label: 'Pitch deck (PDF)', description: 'Un deck de slides listo para inversionistas resumiendo la oportunidad.' },
        docx: { label: 'Word editable (.docx)', description: 'El reporte completo como documento Word editable.' },
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
    if (p.preferredSources.length) lines.push(`Prioritize these marketplaces/brokers: ${p.preferredSources.join(', ')}.`);
    // targetCount is injected internally by the mode config (not a public param).
    const targetCount = Number((p as Record<string, unknown>).targetCount ?? 5);
    lines.push(`Profile the top ${targetCount} matching listings in depth.`);
    return lines.join('\n');
  },
};
