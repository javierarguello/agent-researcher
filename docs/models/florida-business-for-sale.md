# Research model: `florida-business-for-sale`

Buy-side acquisition research: scans the market for specific businesses for sale in
Florida matching the client's criteria and produces a professional, long-form
research report — market & competition, shortlist, deep dives, financial
projections, valuations & comparables, community reviews, risks, diligence
checklist, growth playbook, financing, and next steps.

- **Schema version:** `florida-business-for-sale@1`
- **Source:** `packages/core/src/templates/florida-business-for-sale.ts`
- **Base prompt:** a senior FL M&A analyst with 7 non-negotiable rules (never
  fabricate listings/figures/URLs; every quantitative claim sourced; stay in
  Florida; be diligence-minded; cross-check; long-form; produce only assigned
  sections as JSON). Client `instructions` are appended as **lower authority**.

## Params (client input)

| Param | Type | Notes |
|---|---|---|
| `location` | string | Defaults to "State of Florida, USA". |
| `industry` | string? | e.g. "laundromats", "HVAC". |
| `keywords` | string[] | Extra narrowing terms (default `[]`). |
| `askingPriceMin` / `askingPriceMax` | int? | USD band. |
| `minRevenue`, `minCashFlow` | int? | Floors in USD. |
| `sbaFriendly` | bool | Prefer SBA 7(a)-eligible deals (default false). |
| `includeRealEstate` | bool? | Prefer deals with / without real estate. |
| `preferredSources` | string[] | Marketplaces/brokers to prioritize (default `[]`). |
| `instructions` | string? | Lower-authority client guidance (the `instructionsField`). |
| `language` | en \| es \| fr \| pt | Report language (default `en`; search stays English). |
| `mode` | essential \| comprehensive | Cost/scope (default `essential`). See below. |

`targetCount` (how many listings to profile in depth) is **not** a public param —
it's set internally by the mode.

### Modes (the only public cost knob)

| Mode | Sections | Budget scale | `targetCount` | Depth | Credits |
|---|---|---|---|---|---|
| `essential` | 12 (core) | 0.5× | 3 | light | 1 |
| `comprehensive` | 17 (full) | 1× | 6 | standard | 2 |

`essential` **excludes** 5 heavy sections — `competitive_landscape`,
`financial_analysis`, `comparable_transactions`, `due_diligence_checklist`,
`growth_playbook` — which also **skips 3 agents** that produce only them
(`competition-analyst`, `financial-analyst`, `growth-strategist`) and trims the
others, for roughly half the cost. `comprehensive` runs everything.

## Sections (report shape)

17 typed sections — a long-form report (~15-20 pages rendered at `standard` depth).
Prose fields carry per-section length targets (e.g. `market_overview` ≥600 words);
analysis arrays have Zod minimums (e.g. `risks_red_flags` ≥8, `executive_summary.
keyFindings` ≥6). ✂ marks sections dropped in `essential`.

| Key | Type | Produced by | ✂ |
|---|---|---|---|
| `executive_summary` | object (overview, keyFindings ≥6, topRecommendation, immediateNextSteps ≥4) | exec-summary-writer | |
| `search_criteria` | object (restated criteria + `mandateSummary`) | market-analyst | |
| `market_overview` | Markdown string (≥600 words) | market-analyst → market-refiner | |
| `competitive_landscape` | object (overview, competitors[], differentiation, barriersToEntry) | competition-analyst | ✂ |
| `shortlist` | listing[] (business, location, askingPrice?, revenue?, cashFlowSde?, sourceUrl) | deal-scout | |
| `deep_dives` | profile[] (overview, financials, impliedMultiple?, assets, lease, reasonForSale, growth, risks ≥3, …) | deal-scout → valuation-analyst + deep-dive-refiner | |
| `financial_analysis` | object (methodology, projections[], commentary) | financial-analyst | ✂ |
| `valuation_benchmarks` | object (commentary, multiples[]) | valuation-analyst | |
| `comparable_transactions` | object (commentary, transactions[]) | valuation-analyst | ✂ |
| `regulatory_licensing` | Markdown string (≥400 words) | compliance-analyst | |
| `financing_options` | Markdown string (≥400 words) | compliance-analyst | |
| `community_insights` | object (overview, mentions[] platform/url/topic/summary/sentiment) | community-analyst | |
| `risks_red_flags` | string[≥8] (Markdown bullets) | risk-analyst | |
| `due_diligence_checklist` | object (categories ≥5, each items ≥3) | risk-analyst | ✂ |
| `growth_playbook` | object (first100Days ≥5, growthLevers ≥4, operationalImprovements ≥4, commentary) | growth-strategist | ✂ |
| `recommendations` | object (pursueFirst ≥3, nextSteps ≥6) | recommendations-writer | |
| `sources` | object (items[] {id,url,label}) | **derived** from the evidence store | |

## Agents & objectives

13 agents (`role`, `objective`, research budget). The two **refiners** are
producer agents whose only job is `enriches` — a "pro pass" that re-writes the
heaviest sections after the first pass.

| Agent | Role | Produces / Enriches | Budget | Objective |
|---|---|---|---|---|
| `market-analyst` | producer | `search_criteria`, `market_overview` | 8 | FL market context + restated criteria. |
| `competition-analyst` | producer | `competitive_landscape` | 8 | Competition, saturation, demand drivers. |
| `deal-scout` | producer | `shortlist`, `deep_dives` | 24 | Find real listings; profile top targets. |
| `compliance-analyst` | producer | `regulatory_licensing`, `financing_options` | 8 | FL licensing/regulatory + financing paths. |
| `community-analyst` | producer | `community_insights` | 8 | Real Reddit/forum experiences + reviews. |
| `valuation-analyst` | producer | produces `valuation_benchmarks`, `comparable_transactions`; **enriches** `deep_dives` | 10 | Multiples + comps; add implied multiples to deep dives. |
| `financial-analyst` | producer | `financial_analysis` | 6 | Normalized earnings, 3-yr projections, ROI/payback, SBA DSCR. |
| `risk-analyst` | producer | `risks_red_flags`, `due_diligence_checklist` | 5 | Cross-cutting risks + diligence checklist. |
| `market-refiner` | producer (refiner) | **enriches** `market_overview` | 5 | Deepen the market overview (pro pass). |
| `deep-dive-refiner` | producer (refiner) | **enriches** `deep_dives` | 10 | Fill each profile's gaps, expand toward a full page (pro pass). |
| `growth-strategist` | synthesizer | `growth_playbook` | — | Post-acquisition value-creation & growth playbook. |
| `recommendations-writer` | synthesizer | `recommendations` | — | Which targets to pursue first + next steps. |
| `exec-summary-writer` | synthesizer | `executive_summary` | — | Decision-ready executive summary of the finished report. |

Every agent's synthesis uses the `pro` alias; producers' research loop uses
`gather`/flash. `community-analyst` targets `site:reddit.com` (r/smallbusiness,
r/Entrepreneur, r/sweatystartup, sector subreddits), industry forums, Trustpilot,
Google/Yelp, and BBB — reporting only real, findable threads/reviews.

## Execution waves (comprehensive)

```
Wave 1 (parallel):  market-analyst · competition-analyst · deal-scout · compliance-analyst · community-analyst
Wave 2:             valuation-analyst · risk-analyst · market-refiner
Wave 3:             financial-analyst · deep-dive-refiner
Wave 4:             growth-strategist
Wave 5:             recommendations-writer
Wave 6:             exec-summary-writer
Derived last:       sources  (from the shared evidence store)
```

`deep-dive-refiner` runs **after** `valuation-analyst`, so it keeps the implied
multiples that valuation added. In `essential` mode the excluded agents drop out
and the waves collapse accordingly. Print the live waves with
`npm run templates:check`.

## Example `report.json` (abridged)

```json
{
  "meta": {
    "title": "Florida Businesses for Sale — Buy-Side Research",
    "template": "florida-business-for-sale", "templateVersion": 1,
    "schemaVersion": "florida-business-for-sale@1", "jobId": "local-4837f6e3",
    "language": "es", "mode": "comprehensive", "depth": "standard",
    "generatedAt": "2026-07-07T12:42:19.969Z", "contentFormat": "markdown",
    "cost": { "usd": 3.9, "llmUsd": 3.4, "searchUsd": 0.5,
              "inputTokens": 2100000, "outputTokens": 78000, "searchCalls": 62 }
  },
  "report": {
    "executive_summary": {
      "overview": "Este informe detalla los hallazgos de una búsqueda de adquisición de lavanderías…",
      "keyFindings": ["**Demanda Estructural Fuerte:** …([Census](https://www.census.gov/…))", "…"],
      "topRecommendation": "Perseguir agresivamente la [lavandería de Hialeah](https://…) ($275,000)…",
      "immediateNextSteps": ["**Paso 1:** Solicitar 3 años de declaraciones de impuestos…", "…"]
    },
    "shortlist": [
      { "business": "Coin Laundry — Hialeah", "location": "Hialeah, FL",
        "askingPrice": 275000, "revenue": null, "cashFlowSde": null,
        "sourceUrl": "https://negociosenflorida.com/…" }
    ],
    "community_insights": {
      "overview": "La comunidad de r/sweatystartup considera las lavanderías…",
      "mentions": [
        { "platform": "Reddit", "url": "https://reddit.com/…",
          "topic": "Experiencia comprando una lavandería en FL",
          "summary": "Un usuario reporta márgenes de…", "sentiment": "mixed" }
      ]
    },
    "sources": { "items": [ { "id": 1, "url": "https://…", "label": "BizBuySell — …" } ] }
  }
}
```

(Abridged from a real run — see `out/local-4837f6e3/report.json`.) Numeric fields
are `null` when the listing didn't disclose them; prose fields are Markdown with
inline `[label](url)` citations.
