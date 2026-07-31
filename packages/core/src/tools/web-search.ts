/**
 * Provider-agnostic web search. Backend priority: Brave > Tavily > DuckDuckGo
 * (keyless fallback). Zero SDKs — plain `fetch`. Ported from the home-assistant
 * reference project.
 */
import { config } from '../config.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** The backend `searchWeb` will use, given the current configuration. */
function searchProvider(): 'brave' | 'tavily' | 'duckduckgo' {
  if (config.search.braveApiKey) return 'brave';
  if (config.search.tavilyApiKey) return 'tavily';
  return 'duckduckgo';
}

/**
 * Estimated USD for one call, priced per OPERATION — because the two operations do
 * not share a provider.
 *
 * `searchWeb` picks Brave, then Tavily, then keyless DuckDuckGo. `extractPages` is
 * Tavily, always: it refuses outright without a Tavily key. Pricing both from the
 * search provider meant that with a Brave key set, every genuinely-billed
 * extraction was booked at Brave's rate — an understatement on the call that
 * actually costs money. The price has to follow the call, not the module.
 */
export function searchCostPerCall(operation: 'search' | 'extract'): number {
  if (operation === 'extract') {
    // Tavily or nothing: without a key `extractPages` returns errors and spends
    // nothing, so the rate is only ever charged when a real call was made.
    return config.search.tavilyApiKey ? config.search.costPerCallUsd : 0;
  }
  switch (searchProvider()) {
    case 'brave':
      return config.search.braveCostPerCallUsd;
    case 'tavily':
      return config.search.costPerCallUsd;
    default:
      return 0; // keyless DuckDuckGo
  }
}

/**
 * Whether `extractPages` can reach a backend at all. It is Tavily-or-nothing, so
 * without a key it refuses locally: no request leaves the process, and the caller
 * must not book a backend call that never happened.
 */
export function canExtractPages(): boolean {
  return !!config.search.tavilyApiKey;
}

/** Runs a web search via the highest-priority configured backend. */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (config.search.braveApiKey) return searchBrave(query);
  if (config.search.tavilyApiKey) return searchTavily(query);
  return searchDuckDuckGo(query);
}

async function searchBrave(query: string): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '8');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': config.search.braveApiKey },
  });
  if (!res.ok) throw new Error(`Brave error ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };
  return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function searchTavily(query: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.search.tavilyApiKey,
      query,
      search_depth: 'advanced',
      max_results: 8,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

export interface ExtractedPage {
  url: string;
  content: string;
  ok: boolean;
  error?: string;
  /**
   * The page was longer than the cap and what we have is the beginning of it.
   *
   * It matters because the agent reasons on this text: reading 6,000 characters of
   * a 40,000-character page and being told nothing, it concludes a figure is
   * absent when the figure is further down. A page half-read has to SAY it is half
   * read — see `TRUNCATION_NOTE`, which is appended to the content itself so the
   * warning cannot be separated from the text it is about.
   */
  truncated?: boolean;
}

/** Max characters kept per extracted page (bounds model + synthesis context). */
const EXTRACT_CHAR_CAP = 6000;

/**
 * Cut a page to the cap, and SAY SO when we did. Exported because the saying-so is
 * the part worth pinning: the cut itself is arithmetic, the note is the contract.
 */
export function capContent(raw: string): { content: string; truncated?: boolean } {
  if (raw.length <= EXTRACT_CHAR_CAP) return { content: raw };
  return { content: raw.slice(0, EXTRACT_CHAR_CAP) + TRUNCATION_NOTE, truncated: true };
}

/**
 * Appended to a page we had to cut. In the content rather than beside it, because
 * every path that shows an agent a page shows it the content — a flag on the object
 * would be silently dropped by the first one that forgot to render it.
 */
const TRUNCATION_NOTE =
  '\n\n[...] This page was longer than we could read and is CUT OFF here. Anything you cannot ' +
  'find above may simply be further down: do not conclude it is missing. Search for the specific ' +
  'figure instead, or say the page could not be read in full.';

/**
 * Fetches the full text of specific pages (e.g. a business listing) so the agent
 * can read details that never appear in a search snippet. Requires Tavily.
 */
export async function extractPages(urls: string[]): Promise<ExtractedPage[]> {
  const clean = urls.map((u) => u.trim()).filter(Boolean).slice(0, 5);
  if (clean.length === 0) return [];

  if (!config.search.tavilyApiKey) {
    return clean.map((url) => ({
      url,
      content: '',
      ok: false,
      error: 'Page extraction requires TAVILY_API_KEY.',
    }));
  }

  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: config.search.tavilyApiKey, urls: clean, extract_depth: 'advanced' }),
    });
    if (!res.ok) throw new Error(`Tavily extract error ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ url: string; raw_content?: string }>;
      failed_results?: Array<{ url: string; error?: string }>;
    };
    const ok: ExtractedPage[] = (data.results ?? []).map((r) => ({
      url: r.url,
      ...capContent(r.raw_content ?? ''),
      ok: true,
    }));
    const failed: ExtractedPage[] = (data.failed_results ?? []).map((r) => ({
      url: r.url,
      content: '',
      ok: false,
      error: r.error ?? 'extraction failed',
    }));
    return [...ok, ...failed];
  } catch (error) {
    return clean.map((url) => ({ url, content: '', ok: false, error: (error as Error).message }));
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DuckDuckGo error ${res.status}`);
  const data = (await res.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading ?? query, url: data.AbstractURL ?? '', snippet: data.AbstractText });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
    }
    if (results.length >= 8) break;
  }
  return results;
}
