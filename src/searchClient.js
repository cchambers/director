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
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Search for videos via YouTube Data API v3. Returns actual YouTube search results (better relevance/recency than Tavily).
 * Requires YOUTUBE_API_KEY in env (Google Cloud project with YouTube Data API v3 enabled).
 * @param {string} query - User's topic (e.g. "gwar playing any song")
 * @param {{ order?: 'relevance'|'date' }} [options] - order=date for newest first
 * @returns {Promise<Array<{ title: string, url: string }>>}
 */
export async function getVideoSearchResults(query, options = {}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  let apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (apiKey) apiKey = apiKey.replace(/^["']|["']$/g, '');
  if (!apiKey) {
    console.warn('[Video search] YOUTUBE_API_KEY not set; cannot search YouTube.');
    return [];
  }
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(VIDEO_SEARCH_MAX_RESULTS),
    q: trimmed.slice(0, 500),
    key: apiKey,
  });
  if (options.order === 'date') params.set('order', 'date');
  try {
    const res = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
    if (!res.ok) {
      const errText = await res.text();
      const errBody = (() => { try { return JSON.parse(errText); } catch { return {}; } })();
      const msg = errBody?.error?.message || errText || String(res.status);
      console.warn('[Video search] YouTube API error:', res.status, msg);
      return [];
    }
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((item) => item.id?.videoId && item.snippet?.title)
      .map((item) => ({
        title: String(item.snippet.title).trim(),
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      }));
  } catch (err) {
    console.warn('[Video search]', err.message);
    return [];
  }
}

/**
 * Find a channel by name/handle, then return that channel's latest upload.
 * Uses YouTube Data API v3: search (type=channel) then search (channelId + order=date).
 * Requires YOUTUBE_API_KEY in env.
 * @param {string} channelQuery - Channel name or handle (e.g. "GWAR" or "gwarvevo")
 * @returns {Promise<Array<{ title: string, url: string }>>} - One item (latest video) or []
 */
export async function getLatestVideoFromChannel(channelQuery) {
  const trimmed = channelQuery?.trim();
  if (!trimmed) return [];
  let apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (apiKey) apiKey = apiKey.replace(/^["']|["']$/g, '');
  if (!apiKey) {
    console.warn('[Video search] YOUTUBE_API_KEY not set; cannot search YouTube.');
    return [];
  }
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'channel',
      maxResults: '1',
      q: trimmed.slice(0, 200),
      key: apiKey,
    });
    const channelRes = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
    if (!channelRes.ok) {
      const errText = await channelRes.text();
      const errBody = (() => { try { return JSON.parse(errText); } catch { return {}; } })();
      const msg = errBody?.error?.message || errText || String(channelRes.status);
      console.warn('[Video search] YouTube channel search error:', channelRes.status, msg);
      return [];
    }
    const channelData = await channelRes.json().catch(() => ({}));
    const channelItems = Array.isArray(channelData.items) ? channelData.items : [];
    const channelId = channelItems[0]?.id?.channelId;
    if (!channelId) return [];

    const videoParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      channelId,
      order: 'date',
      maxResults: '1',
      key: apiKey,
    });
    const videoRes = await fetch(`${YOUTUBE_SEARCH_URL}?${videoParams.toString()}`);
    if (!videoRes.ok) {
      console.warn('[Video search] YouTube latest-video error:', videoRes.status);
      return [];
    }
    const videoData = await videoRes.json().catch(() => ({}));
    const videoItems = Array.isArray(videoData.items) ? videoData.items : [];
    const video = videoItems[0];
    if (!video?.id?.videoId || !video?.snippet?.title) return [];
    return [
      {
        title: String(video.snippet.title).trim(),
        url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
      },
    ];
  } catch (err) {
    console.warn('[Video search] getLatestVideoFromChannel:', err.message);
    return [];
  }
}
