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
 * Fetch search snippets for a claim/query. Returns a single string suitable
 * for appending to the fact-check prompt.
 * @param {string} query - Claim text or short search query
 * @param {{ maxResults?: number }} options
 * @returns {Promise<string>} Formatted context or '' if no key or error
 */
export async function getSearchContext(query, options = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey?.trim()) return '';

  const maxResults = Math.min(20, Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS));
  const body = JSON.stringify({
    api_key: apiKey,
    query: query.trim().slice(0, 500),
    max_results: maxResults,
    search_depth: 'basic',
    include_answer: false,
  });

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      console.warn('Tavily search failed:', res.status, await res.text());
      return '';
    }
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) return '';

    const lines = results.map((r, i) => {
      const title = r.title ? `[${i + 1}] ${String(r.title).trim()}` : '';
      const content = r.content ? String(r.content).trim() : '';
      return title ? `${title}\n${content}` : content;
    }).filter(Boolean);
    return lines.join('\n\n');
  } catch (err) {
    console.warn('Search context error:', err.message);
    return '';
  }
}
