/**
 * A small fake web, standing in for every tool that would otherwise leave the
 * machine. **No test in this repo talks to the internet** — the search backends
 * (Brave / Tavily / DuckDuckGo) and page extraction are both replaced by this:
 *
 *   vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));
 *
 * It is not a two-line stub on purpose. An agent workflow only produces a real
 * report if the evidence it gathers actually contains listings, figures, market
 * data, comparables and opinions — so the corpus below covers each of those, with
 * consistent numbers, so a report built from it can be read and sanity-checked
 * like a real one. Results are ranked by term overlap, so different agents asking
 * different questions get different (relevant) pages, exactly as they would live.
 *
 * The figures are invented but internally consistent: the same business always
 * has the same price, revenue and SDE wherever it appears. That is what makes a
 * hallucinating model visible — invented numbers won't match the corpus.
 */
import type { ExtractedPage, SearchResult } from '../../src/tools/web-search.js';

interface Page {
  url: string;
  title: string;
  snippet: string;
  content: string;
  /** Extra terms that should match this page beyond its title/snippet. */
  tags: string[];
}

const PAGES: Page[] = [
  {
    url: 'https://example-marketplace.test/listing/sunshine-coin-laundry',
    title: 'Sunshine Coin Laundry — laundromat for sale in Hialeah, Miami-Dade County, FL',
    snippet: 'Established coin laundry, asking $450,000. Revenue $310,000, SDE $120,000. Absentee-run, lease to 2031.',
    tags: ['laundromat', 'laundry', 'for sale', 'miami-dade', 'hialeah', 'listing', 'business for sale'],
    content: [
      'Sunshine Coin Laundry — Hialeah, Miami-Dade County, Florida.',
      'Asking price: $450,000. Gross annual revenue: $310,000. Seller discretionary earnings (SDE): $120,000.',
      'Implied multiple: 3.75x SDE. Established 2007; current owner has held it for 11 years and is retiring.',
      'Equipment: 40 Speed Queen washers and 32 dryers, replaced in 2021 (approx. $180,000 invested).',
      'Real estate is NOT included — the business leases 3,400 sq ft at $6,200/month, triple net, with the',
      'lease running to March 2031 and one five-year renewal option at market rate.',
      'Staffing: two part-time attendants; the owner works roughly 6 hours a week, so the operation is close to absentee.',
      'Ancillary revenue: wash-dry-fold service ($38,000/yr) and four vending machines ($9,000/yr).',
      'The seller reports the business qualifies for SBA 7(a) financing and will consider 10% seller carry.',
      'Utilities run about $4,100/month (water and gas are the largest line items).',
    ].join('\n'),
  },
  {
    url: 'https://example-marketplace.test/listing/bayside-wash-center',
    title: 'Bayside Wash Center — coin laundry business for sale, Miami FL',
    snippet: 'Turnkey laundromat near Little Havana. Asking $280,000, revenue $190,000, SDE $78,000. Owner financing available.',
    tags: ['laundromat', 'laundry', 'for sale', 'miami', 'little havana', 'listing', 'turnkey', 'owner financing'],
    content: [
      'Bayside Wash Center — Little Havana, Miami, Florida.',
      'Asking price: $280,000. Gross annual revenue: $190,000. SDE: $78,000. Implied multiple: 3.6x SDE.',
      'Established 2014. 28 washers, 24 dryers; roughly half the dryers are past their expected service life',
      'and the listing broker estimates $45,000 of deferred capital expenditure within two years.',
      'Lease: 2,600 sq ft at $4,400/month, expiring November 2027, with no renewal option currently in writing —',
      'a buyer should treat the lease as the primary risk in this deal.',
      'The owner offers to finance 20% of the purchase price over 5 years at 7%.',
      'Foot traffic benefits from a dense multi-family neighbourhood where an estimated 62% of households rent.',
    ].join('\n'),
  },
  {
    url: 'https://example-marketplace.test/listing/palmetto-laundry-express',
    title: 'Palmetto Laundry Express — laundromat with real estate, Miami Gardens FL',
    snippet: 'Laundromat plus the building. Asking $1,150,000 including real estate. Revenue $402,000, SDE $165,000.',
    tags: ['laundromat', 'laundry', 'for sale', 'miami gardens', 'real estate included', 'listing'],
    content: [
      'Palmetto Laundry Express — Miami Gardens, Miami-Dade County, Florida.',
      'Asking price: $1,150,000, which INCLUDES the 5,100 sq ft building (assessed at $690,000 in 2025).',
      'Gross annual revenue: $402,000. SDE: $165,000. Business-only value implied: approximately $460,000 (2.8x SDE).',
      'Established 1998, same family ownership. 52 washers, 44 dryers, card system installed 2023.',
      'A commercial route (12 restaurant and salon accounts) contributes $74,000 of the revenue on 30-day terms.',
      'Because the real estate is included, this deal is a candidate for an SBA 7(a) loan with a 25-year term',
      'rather than the 10-year term typical of a business-only acquisition.',
    ].join('\n'),
  },
  {
    url: 'https://example-research.test/florida-laundromat-market-2026',
    title: 'Florida self-service laundry market overview 2026',
    snippet: 'Florida has an estimated 2,400 self-service laundries; Miami-Dade accounts for roughly 480 of them.',
    tags: ['market', 'overview', 'industry', 'florida', 'demand', 'competition', 'landscape', 'trends', 'statistics'],
    content: [
      'Florida self-service laundry market, 2026 overview.',
      'Estimated 2,400 self-service laundries statewide; Miami-Dade County accounts for roughly 480, the densest',
      'concentration in the state. Average store revenue in the county is $265,000, against a state average of $228,000.',
      'Demand is driven by renter density: 58% of Miami-Dade households rent, versus 33% statewide, and in-unit',
      'laundry is absent from most pre-2005 multi-family stock.',
      'Sector revenue grew an estimated 4.1% in 2025, mostly through price increases rather than volume.',
      'Cost pressure is concentrated in water and natural gas; utilities are typically 22-28% of revenue.',
      'Card and app payment conversion is the main modernization trend, and typically lifts revenue 6-9% in',
      'the first year while costing $60,000-$90,000 to install in a 40-machine store.',
      'Competition is fragmented: independents hold an estimated 78% of stores, with no operator above 3% share.',
    ].join('\n'),
  },
  {
    url: 'https://example-research.test/laundromat-valuation-multiples',
    title: 'Laundromat valuation benchmarks and comparable transactions',
    snippet: 'Business-only laundromats trade at 3.0x-4.2x SDE in Florida; deals including real estate at 5.5x-7.0x.',
    tags: ['valuation', 'multiple', 'benchmark', 'comparable', 'transactions', 'ebitda', 'sde', 'price'],
    content: [
      'Laundromat valuation benchmarks, Florida, trailing twelve months.',
      'Business-only transactions: 3.0x to 4.2x SDE, median 3.6x. Deals that include the real estate: 5.5x to 7.0x SDE.',
      'Revenue multiples cluster at 1.2x to 1.6x for business-only deals.',
      'Recent comparable transactions:',
      '- Coral Way coin laundry, Miami, sold March 2026: $395,000 on $108,000 SDE (3.7x), business only.',
      '- Kendall wash center, sold November 2025: $520,000 on $141,000 SDE (3.7x), business only.',
      '- Broward County laundry with building, sold August 2025: $1,340,000 on $198,000 SDE (6.8x).',
      'Stores with card systems and a wash-dry-fold line consistently trade at the top of the range;',
      'stores with under five years left on the lease trade at a 15-20% discount.',
    ].join('\n'),
  },
  {
    url: 'https://example-lender.test/sba-7a-laundromat-financing',
    title: 'SBA 7(a) financing for laundromat acquisitions',
    snippet: 'Typical structure: 10% buyer equity, 10% seller note, 80% SBA 7(a) at Prime + 2.75%, 10-year term.',
    tags: ['financing', 'sba', 'loan', 'lender', 'debt', 'capital', 'funding', 'interest'],
    content: [
      'SBA 7(a) financing for laundromat acquisitions, 2026 terms.',
      'Typical structure: 10% buyer equity, 10% seller note on full standby, 80% SBA 7(a).',
      'Rate: Prime + 2.75% (variable), currently around 10.25%. Term: 10 years for business-only acquisitions,',
      'up to 25 years when commercial real estate is included in the transaction.',
      'Lenders generally look for a debt service coverage ratio of at least 1.25x on historical, not projected, earnings.',
      'Worked example on a $450,000 acquisition: $360,000 financed over 10 years at 10.25% is roughly $4,800/month,',
      'or $57,600 a year — against $120,000 of SDE that is a 2.1x coverage ratio, comfortably above the threshold.',
      'Guarantee fee runs about 3% of the guaranteed portion and is normally financed into the loan.',
    ].join('\n'),
  },
  {
    url: 'https://example-gov.test/florida-laundry-licensing',
    title: 'Florida licensing and regulatory requirements for laundry businesses',
    snippet: 'A Florida laundromat needs a county business tax receipt, a DBPR registration where dry cleaning is offered, and a sales-tax certificate.',
    tags: ['regulation', 'licensing', 'permit', 'compliance', 'legal', 'requirements', 'florida', 'tax'],
    content: [
      'Florida regulatory requirements for self-service laundry businesses.',
      'Required: a Miami-Dade County local business tax receipt (renewed annually, roughly $45-$150 depending on size),',
      'a Florida sales and use tax certificate, and municipal zoning approval for the specific address.',
      'Dry cleaning on site additionally requires registration with the Department of Business and Professional',
      'Regulation and, where perchloroethylene is used, a Department of Environmental Protection permit.',
      'Water and sewer connections are permitted at the county level; adding machines beyond the permitted count',
      'requires an amended connection permit, which commonly takes 60-90 days.',
      'Coin-operated machines are exempt from sales tax on the wash itself, but wash-dry-fold service is taxable.',
      'ADA accessibility applies to the customer area; older storefronts are a frequent source of retrofit cost.',
    ].join('\n'),
  },
  {
    url: 'https://example-forum.test/r/smallbusiness/buying-a-laundromat-in-miami',
    title: 'Bought a laundromat in Miami two years ago — what I got wrong',
    snippet: 'Community thread: owners discuss real margins, utility surprises, and how much absentee ownership actually is.',
    tags: ['reddit', 'review', 'community', 'experience', 'opinion', 'forum', 'owners', 'sentiment'],
    content: [
      'Community thread, 148 comments, mixed-to-positive sentiment.',
      'Top comment: "The numbers held up but the utilities did not. Our water bill went up 19% in the first year',
      'and nobody warned us the county was re-rating commercial connections."',
      'Several owners report that "absentee" typically means 5-10 hours a week in practice, mostly maintenance calls',
      'and cash collection, and that a store without a card system takes considerably more.',
      'Recurring positive: wash-dry-fold is described as the highest-margin add-on, with several owners citing it',
      'growing to 20-25% of revenue within two years of launching it.',
      'Recurring warning: verify collections yourself for at least two weeks before closing. Two commenters describe',
      'sellers inflating reported revenue by 15-20%, which only surfaced during hands-on verification.',
      'On competition: "Density is real here. There were three other laundromats within a mile of ours and it still worked,',
      'because everyone in those buildings rents and nobody has a hookup."',
    ].join('\n'),
  },
  {
    url: 'https://example-review.test/miami-laundromat-customer-reviews',
    title: 'Customer reviews of Miami-Dade laundromats',
    snippet: 'Aggregated reviews: cleanliness and working machines dominate ratings; card-only stores draw complaints from cash customers.',
    tags: ['review', 'customer', 'rating', 'reputation', 'sentiment', 'community', 'yelp', 'google'],
    content: [
      'Aggregated customer reviews across 40 Miami-Dade self-service laundries, 2025-2026.',
      'Average rating 3.8 of 5. The two factors that dominate positive reviews are cleanliness and the share of',
      'machines actually in service; price ranks a distant third.',
      'Sunshine Coin Laundry, Hialeah: 4.3 of 5 across 210 reviews. Praised for machine availability and being',
      'attended in the evenings. Repeated complaint: parking is tight at weekends.',
      'Bayside Wash Center, Little Havana: 3.4 of 5 across 96 reviews. Repeated complaints about dryers running cold,',
      'consistent with the deferred maintenance disclosed in its listing.',
      'Stores that removed cash entirely draw a consistent stream of one-star reviews from older customers.',
    ].join('\n'),
  },
];

/** Words too common to help ranking. */
const STOP = new Set(['the', 'a', 'an', 'for', 'in', 'of', 'and', 'or', 'to', 'with', 'on', 'is', 'are', 'what', 'how', 'best', 'near', 'me', 'fl', 'usa']);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Overlap between the query's terms and everything we know about a page. */
function score(query: string, page: Page): number {
  const haystack = `${page.title} ${page.snippet} ${page.tags.join(' ')}`.toLowerCase();
  return terms(query).reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
}

/**
 * What the engine charges per call against this fake web. Two DIFFERENT rates, and
 * the `operation` parameter is not decoration: a fixture that ignores it cannot
 * tell a test that the engine priced an extraction at the search rate — which is
 * the bug the real function was changed to prevent.
 */
export function searchCostPerCall(operation: 'search' | 'extract'): number {
  return operation === 'extract' ? 0.03 : 0.016;
}

/** The fixture corpus is always reachable — there is no key here to be missing. */
export function canExtractPages(): boolean {
  return true;
}

/**
 * Ranked search over the fake corpus. Always returns something: an agent that
 * asks an odd question still gets the general market pages rather than starving,
 * which is what a real search backend does too.
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const ranked = PAGES.map((page) => ({ page, s: score(query, page) }))
    .sort((a, b) => b.s - a.s)
    .filter((r, i) => r.s > 0 || i < 3)
    .slice(0, 5);
  return ranked.map(({ page }) => ({ title: page.title, url: page.url, snippet: page.snippet }));
}

/**
 * Full text for a page in the corpus. An unknown URL fails, exactly as a real
 * extraction would — which is also how a model that invented a URL gets found out.
 */
export async function extractPages(urls: string[]): Promise<ExtractedPage[]> {
  return urls.map((url) => {
    const page = PAGES.find((p) => p.url === url);
    return page
      ? { url, ok: true, content: page.content }
      : { url, ok: false, content: '', error: 'Not found (this URL is not in the fixture corpus).' };
  });
}

/** The corpus itself, for tests that assert a report only used real evidence. */
export const FAKE_WEB_PAGES = PAGES.map((p) => ({ url: p.url, title: p.title }));
