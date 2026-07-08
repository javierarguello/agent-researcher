# Research model: `florida-business-for-sale`

Buy-side acquisition research: scans the market for specific businesses for sale
in Florida matching the client's criteria and produces a professional research
report — shortlist, deep dives, valuations, community reviews, risks, financing,
and next steps.

- **Schema version:** `florida-business-for-sale@1`
- **Source:** `packages/core/src/templates/florida-business-for-sale.ts`

## Params (client input)

| Param | Type | Notes |
|---|---|---|
| `location` | string | Defaults to "State of Florida, USA". |
| `industry` | string? | e.g. "laundromats", "HVAC". |
| `keywords` | string[] | Extra narrowing terms. |
| `askingPriceMin/Max` | int? | USD band. |
| `minRevenue`, `minCashFlow` | int? | Floors in USD. |
| `sbaFriendly` | bool | Prefer SBA 7(a)-eligible deals. |
| `includeRealEstate` | bool? | Prefer deals with / without real estate. |
| `preferredSources` | string[] | Marketplaces/brokers to prioritize. |
| `instructions` | string? | Lower-authority client guidance. |
| `language` | en \| es \| fr \| pt | Report language (search stays English). |
| `mode` | essential \| comprehensive | Cost/scope (default `essential`). See below. |

### Modes (the only public cost knob)

| Mode | Sections | Budget | Listings | ~Cost |
|---|---|---|---|---|
| `essential` | 12 (core; drops competition, financials, comparables, DD checklist, growth playbook) | 0.5× | 3 | ~half |
| `comprehensive` | 17 (full) | 1× | 6 | full (~$4-6) |

`targetCount` and prose depth are now **internal**, set by the mode — the public
API exposes only `mode`.

## Sections (report shape)

17 typed sections — a long-form report (targets ~15-20 pages when rendered).
Prose fields carry per-section length targets (e.g. `market_overview` ≥600
words); analysis arrays have Zod minimums (e.g. `risks_red_flags` ≥8).

| Key | Type | Produced by |
|---|---|---|
| `executive_summary` | object (overview, keyFindings[≥6], topRecommendation, immediateNextSteps[≥4]) | exec-summary-writer |
| `search_criteria` | object (restated criteria + mandateSummary) | market-analyst |
| `market_overview` | Markdown string (≥600 words) | market-analyst → market-refiner |
| `competitive_landscape` | object (overview, competitors[], differentiation, barriersToEntry) | competition-analyst |
| `shortlist` | listing[] (business, location, askingPrice?, revenue?, cashFlowSde?, sourceUrl) | deal-scout |
| `deep_dives` | profile[] (overview, financials, impliedMultiple?, assets, lease, risks[≥3], …) | deal-scout → valuation + deep-dive-refiner |
| `financial_analysis` | object (methodology, projections[], commentary) | financial-analyst |
| `valuation_benchmarks` | object (commentary, multiples[]) | valuation-analyst |
| `comparable_transactions` | object (commentary, transactions[]) | valuation-analyst |
| `regulatory_licensing` | Markdown string (≥400 words) | compliance-analyst |
| `financing_options` | Markdown string (≥400 words) | compliance-analyst |
| `community_insights` | object (overview, mentions[] platform/url/topic/summary/sentiment) | community-analyst |
| `risks_red_flags` | string[≥8] (Markdown bullets) | risk-analyst |
| `due_diligence_checklist` | object (categories[≥5] each items[≥3]) | risk-analyst |
| `growth_playbook` | object (first100Days[≥5], growthLevers[≥4], operationalImprovements[≥4], commentary) | growth-strategist |
| `recommendations` | object (pursueFirst[≥3], nextSteps[≥6]) | recommendations-writer |
| `sources` | object (items[] {id,url,label}) | **derived** from the evidence store |

## Agents & objectives

| Agent | Role | Objective |
|---|---|---|
| `market-analyst` | producer | Florida market context + restated search criteria. |
| `competition-analyst` | producer | Competitive landscape, saturation, demand drivers. |
| `deal-scout` | producer | Find real listings; profile the top targets in depth. |
| `compliance-analyst` | producer | FL licensing/regulatory + financing paths. |
| `community-analyst` | producer | Real Reddit/forum experiences + customer reviews. |
| `valuation-analyst` | producer + enricher | Valuation multiples + comparable transactions; add implied multiples to deep dives. |
| `financial-analyst` | producer | Normalized earnings, 3-yr projections, ROI/payback, SBA debt-service feasibility. |
| `risk-analyst` | producer | Cross-cutting risks + structured due-diligence checklist. |
| `market-refiner` | enricher | **Pro refine pass** — deepen `market_overview`. |
| `deep-dive-refiner` | enricher | **Pro refine pass** — fill each profile's financials/lease/risks, expand toward a full page. |
| `growth-strategist` | synthesizer | Post-acquisition value-creation & growth playbook. |
| `recommendations-writer` | synthesizer | Which targets to pursue first + next diligence steps. |
| `exec-summary-writer` | synthesizer | Decision-ready executive summary of the finished report. |

The two **refiners** are the quality/refinement pass: they re-write the heaviest
sections with `pro` after the producers, filling first-pass gaps
(`deep-dive-refiner` runs after `valuation-analyst`, so it keeps the implied
multiples). Every agent's synthesis uses `pro`; the tool-calling loop
(`gatherModel`) uses `gather`/flash.

## Execution waves (the DAG)

```
Wave 1 (parallel):  market-analyst · competition-analyst · deal-scout · compliance-analyst · community-analyst
Wave 2:             valuation-analyst · risk-analyst · market-refiner
Wave 3:             financial-analyst · deep-dive-refiner
Wave 4:             growth-strategist
Wave 5:             recommendations-writer
Wave 6:             exec-summary-writer
Derived last:       sources (from the shared evidence store)
```

`community-analyst` researches `site:reddit.com` (r/smallbusiness,
r/Entrepreneur, r/sweatystartup, sector subreddits), industry forums, Trustpilot,
Google/Yelp reviews, and BBB — reporting only real, findable threads/reviews.

## Example `report.json` (abridged)

```json
{
  "meta": {
    "template": "florida-business-for-sale", "templateVersion": 1,
    "schemaVersion": "florida-business-for-sale@1", "language": "es",
    "contentFormat": "markdown", "generatedAt": "2026-07-07T…Z"
  },
  "report": {
    "executive_summary": {
      "overview": "Se identificaron **3 lavanderías** en Miami-Dade…",
      "keyFindings": ["Precio medio ~ **$420k** …", "…"],
      "topRecommendation": "Priorizar la lavandería de [Hialeah](https://…) …",
      "immediateNextSteps": ["Solicitar P&L de 3 años …", "…"]
    },
    "shortlist": [
      { "business": "Coin Laundry — Hialeah", "location": "Hialeah, FL",
        "askingPrice": 415000, "revenue": 240000, "cashFlowSde": 120000,
        "sourceUrl": "https://www.bizbuysell.com/…" }
    ],
    "community_insights": {
      "overview": "La comunidad de r/sweatystartup considera las lavanderías …",
      "mentions": [
        { "platform": "Reddit", "url": "https://reddit.com/…",
          "topic": "Experiencia comprando una lavandería en FL",
          "summary": "Un usuario reporta márgenes de …", "sentiment": "mixed" }
      ]
    },
    "sources": { "items": [ { "id": 1, "url": "https://…", "label": "BizBuySell — …" } ] }
  }
}
```
