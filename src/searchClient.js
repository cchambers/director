/**
 * Optional search context for fact-checking. Uses Tavily (AI-oriented search).
 * Set TAVILY_API_KEY in env to enable. If unset, getSearchContext returns '' and
 * fact-check runs without search context.
 *
 * Alternatives: Serper (Google), Brave Search API, or Bing — same pattern:
 * call API with query, format results into a string for the fact-check prompt.
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

const DEFAULT_MAX_RESULTS = 5;

/**
 * Fetch search snippets for a claim/query. Returns context text (numbered for
 * mod citations [1], [2], ...) and a sources list for the UI.
 * @param {string} query - Claim text or short search query
 * @param {{ maxResults?: number, includeDomains?: string[] }} options
 * @returns {Promise<{ contextText: string, sources: Array<{ title: string, url: string }> }>}
 */
export async function getSearchContext(query, options = {}) {
  const empty = { contextText: '', sources: [] };
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey?.trim()) return empty;

  const maxResults = Math.min(20, Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS));
  const payload = {
    api_key: apiKey,
    query: query.trim().slice(0, 500),
    max_results: maxResults,
    search_depth: 'basic',
    include_answer: false,
  };
  if (Array.isArray(options.includeDomains) && options.includeDomains.length > 0) {
    payload.include_domains = options.includeDomains.slice(0, 20);
  }
  const body = JSON.stringify(payload);

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      console.warn('Tavily search failed:', res.status, await res.text());
      return empty;
    }
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) return empty;

    const sources = results.map((r) => ({
      title: (r.title && String(r.title).trim()) || 'Source',
      url: (r.url && String(r.url).trim()) || '',
    }));

    const lines = results.map((r, i) => {
      const n = i + 1;
      const title = r.title ? String(r.title).trim() : '';
      const url = r.url ? String(r.url).trim() : '';
      const content = r.content ? String(r.content).trim() : '';
      const head = `Source [${n}]: ${title || 'Source ' + n}${url ? '\nURL: ' + url : ''}`;
      return content ? `${head}\n${content}` : head;
    });
    const contextText = lines.join('\n\n');
    return { contextText, sources };
  } catch (err) {
    console.warn('Search context error:', err.message);
    return empty;
  }
}

const VIDEO_SEARCH_MAX_RESULTS = 8;

/** Domains to restrict video search to (actual video pages, not list/search pages). */
const VIDEO_INCLUDE_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'vimeo.com',
  'www.vimeo.com',
  'dailymotion.com',
  'www.dailymotion.com',
  'twitch.tv',
  'www.twitch.tv',
];

/**
 * Search for videos via Tavily: query "Video of: {query}" restricted to video-hosting domains
 * so results are individual videos rather than list pages.
 * @param {string} query - User's topic (e.g. "how to tie a tie")
 * @returns {Promise<Array<{ title: string, url: string }>>}
 */
export async function getVideoSearchResults(query) {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  const videoQuery = `Video of: ${trimmed}`;
  const { sources } = await getSearchContext(videoQuery, {
    maxResults: VIDEO_SEARCH_MAX_RESULTS,
    includeDomains: VIDEO_INCLUDE_DOMAINS,
  });
  return sources.filter((s) => s.url?.trim()).map((s) => ({
    title: (s.title && String(s.title).trim()) || s.url || 'Video',
    url: String(s.url).trim(),
  }));
}
