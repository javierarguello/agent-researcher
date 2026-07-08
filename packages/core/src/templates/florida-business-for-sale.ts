import { z } from 'zod';
import { modeParamSchema } from '../mode.js';
import type { AgentSpec, ReportSection, ResearchTemplate } from './types.js';

// --- Client params -----------------------------------------------------------

const paramsSchema = z.object({
  location: z.string().default('State of Florida, USA'),
  industry: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  askingPriceMin: z.number().int().nonnegative().optional(),
  askingPriceMax: z.number().int().nonnegative().optional(),
  minRevenue: z.number().int().nonnegative().optional(),
  minCashFlow: z.number().int().nonnegative().optional(),
  sbaFriendly: z.boolean().default(false),
  includeRealEstate: z.boolean().optional(),
  preferredSources: z.array(z.string()).default([]),
  instructions: z.string().optional(),
  language: z.enum(['en', 'es', 'fr', 'pt']).default('en'),
  /** Public cost/scope knob. 'essential' (~half cost, core sections) | 'comprehensive' (full report). */
  mode: modeParamSchema,
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
  sourceUrl: z.string().describe('URL of the listing.'),
});

const deepDive = z.object({
  business: z.string(),
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
      'qualified listings as the evidence supports. Unknown numeric fields are null.',
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
    key: 'sources',
    title: 'Sources',
    guidance: 'Every source URL used, de-duplicated. Filled automatically from the evidence store.',
    derived: true,
    schema: z.object({
      items: z.array(z.object({ id: z.number(), url: z.string(), label: z.string() })),
    }),
    derive: ({ sources }) => ({
      items: sources
        .filter((s) => s.url)
        .map((s, i) => ({ id: i + 1, url: s.url, label: s.title || s.url })),
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
      'fetch_page each promising listing for asking price, revenue, SDE, cash flow, and lease terms.',
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
7. You are ONE specialist agent in a larger workflow. Produce ONLY the report sections assigned to you, as JSON matching the provided schema. Prose fields are Markdown and should cite sources inline as [label](url).`;

// --- Template ----------------------------------------------------------------

export const floridaBusinessForSale: ResearchTemplate<FloridaBusinessParams> = {
  id: 'florida-business-for-sale',
  name: 'Florida Businesses for Sale — Buy-Side Research',
  description:
    'Scans the market for specific businesses for sale in Florida matching your criteria and produces a ' +
    'comprehensive, long-form buy-side acquisition report (market & competition, shortlist, deep dives, ' +
    'financial projections, valuations & comparables, community reviews, risks, diligence checklist, growth ' +
    'playbook, financing, and next steps).',
  version: 1,
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
      params: { targetCount: 6 },
    },
    essential: {
      label: 'Essential',
      budgetScale: 0.5,
      depth: 'light',
      // Drop the heaviest analytical sections (~half the cost, core report kept).
      exclude: [
        'competitive_landscape',
        'financial_analysis',
        'comparable_transactions',
        'due_diligence_checklist',
        'growth_playbook',
      ],
      params: { targetCount: 3 },
    },
  },
  instructionsField: 'instructions',
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
