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
}

/** Max characters kept per extracted page (bounds model + synthesis context). */
const EXTRACT_CHAR_CAP = 6000;

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
      content: (r.raw_content ?? '').slice(0, EXTRACT_CHAR_CAP),
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
