/**
 * Client for the Moddit API (director suggestions and fact-check).
 * Sends conversation context and receives response text.
 */

import { config } from './config.js';

const { baseUrl, sessionId } = config.moddit;

/** Moddit model ID for fact-checking. */
const FACTCHECK_MOD_ID = 'a274a291-1581-43d0-a526-315c8dccc8de';

/** Moddit model ID for claim extraction (outputs JSON array of { claim, type }). */
const CLAIM_EXTRACTOR_MOD_ID = '657f34c9-0afe-4455-a95c-76e4cc200787';

/** Moddit model ID for moderator "voice" — returns text to speak as the moderator. */
const MODERATOR_MOD_ID = '1c45d7e7-0130-4083-ad27-976a6fa5a584';

/**
 * @param {Array<{ speaker: string, text: string, timestamp?: string }>} messages - Recent conversation
 * @returns {Promise<{ suggestion?: string, error?: string }>}
 */
export async function getDirectorSuggestion(messages) {
  const url = `${baseUrl}`;

  const context = messages.map(m => `${m.speaker}: ${m.text}`).join('\n');
  console.log('Sending context to Moddit API:\n', context);
  const inp = JSON.stringify({
        apiKey: process.env.MODDIT_API_KEY,
        mod: process.env.MODDIT_SESSION_ID,
        input: `Latest conversation context: \n
\`\`\`
${context}
\`\`\`        
`,
        store: true
      })
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: inp,
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json().catch(() => ({}));
    return { suggestion: data.response ?? null };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get moderator "voice" response: send context from UI, mod returns text to speak. TTS plays separately.
 * Uses MODERATOR_MOD_ID (config.moderatorModId) unless options.modId is provided (e.g. from voice selection).
 * @param {string} context - Selected/highlighted text or other context from the UI
 * @param {{ modId?: string }} [options] - Optional modId; when missing, config.moderatorModId is used
 * @returns {Promise<{ response?: string, error?: string }>}
 */
export async function getModeratorResponse(context, options) {
  const modId = options?.modId ?? config.moderatorModId ?? MODERATOR_MOD_ID;
  const url = `${baseUrl}`;
  const body = JSON.stringify({
    apiKey: process.env.MODDIT_API_KEY,
    mod: modId,
    input: String(context || '').trim() || 'No context provided.',
    store: true,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json().catch(() => ({}));
    return { response: data.response ?? null };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Fact-check recent conversation using the Moddit fact-check model.
 * @param {Array<{ speaker: string, text: string, timestamp?: string }>} messages - Recent conversation
 * @returns {Promise<{ result?: string, error?: string }>}
 */
export async function getFactCheck(messages) {
  const url = `${baseUrl}`;
  const context = messages.map((m) => `${m.speaker}: ${m.text}`).join('\n');
  const body = JSON.stringify({
    apiKey: process.env.MODDIT_API_KEY,
    mod: FACTCHECK_MOD_ID,
    input: `Latest conversation to fact-check:\n\n\`\`\`\n${context}\n\`\`\``,
    store: true,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json().catch(() => ({}));
    return { result: data.response ?? null };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Extract fact-checkable claims from conversation. Expects JSON array of { claim, type, speaker }.
 * @param {Array<{ speaker: string, text: string, timestamp?: string }>} messages - Recent conversation
 * @returns {Promise<{ claims?: Array<{ claim: string, type: string, speaker?: string | null }>, error?: string }>}
 */
export async function getClaimExtraction(messages) {
  const url = `${baseUrl}`;
  const context = messages.map((m) => `${m.speaker}: ${m.text}`).join('\n');
  const body = JSON.stringify({
    apiKey: process.env.MODDIT_API_KEY,
    mod: CLAIM_EXTRACTOR_MOD_ID,
    input: `Extract fact-checkable claims from this conversation. Return a JSON array of objects with "claim", "type", and "speaker". Use "claim" for the exact verbatim claim text, "type" (e.g. predictive, causal, statistical, attribution/statistical), and "speaker" for the name of who said it (from the conversation). No other text.\n\n\`\`\`\n${context}\n\`\`\``,
    store: true,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json().catch(() => ({}));
    const raw = data.response ?? '';
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
    let list;
    try {
      list = JSON.parse(str);
    } catch {
      const match = str.match(/\[[\s\S]*\]/);
      list = match ? JSON.parse(match[0]) : [];
    }
    const claims = Array.isArray(list)
      ? list
          .filter((c) => c && typeof c.claim === 'string')
          .map((c) => ({
            claim: String(c.claim).trim(),
            type: String(c.type || '').trim() || 'claim',
            speaker: c.speaker != null ? String(c.speaker).trim() : null,
          }))
      : [];
    return { claims };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Fact-check a single claim. Returns result and inferred verdict (TRUE/FALSE/SUBJECTIVE).
 * @param {string} claim - The claim text to fact-check
 * @param {{ withSearch?: boolean }} options - If withSearch, fetch web context (Tavily) and include in prompt
 * @returns {Promise<{ result?: string, verdict?: 'TRUE'|'FALSE'|'SUBJECTIVE', error?: string }>}
 */
export async function getFactCheckClaim(claim, options = {}) {
  const { getSearchContext } = await import('./searchClient.js');
  let input = `Fact-check the following claim. Respond with your verdict (TRUE, FALSE, or SUBJECTIVE) and a brief explanation.\n\nClaim: ${claim}`;
  let sources = [];
  if (options.withSearch) {
    const { contextText, sources: s } = await getSearchContext(claim);
    if (contextText) {
      sources = s;
      input = `Fact-check the following claim. Use the search context below to ground your answer. Cite sources as [1], [2], etc. when relevant. Respond with your verdict (TRUE, FALSE, or SUBJECTIVE) and a brief explanation.\n\nClaim: ${claim}\n\nSearch context:\n${contextText}`;
    }
  }
  const url = `${baseUrl}`;
  const body = JSON.stringify({
    apiKey: process.env.MODDIT_API_KEY,
    mod: FACTCHECK_MOD_ID,
    input,
    store: true,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json().catch(() => ({}));
    const result = data.response ?? null;
    let verdict = null;
    if (result) {
      const m = result.match(/\b(TRUE|FALSE|SUBJECTIVE)\b/i);
      if (m) verdict = m[1].toUpperCase();
    }
    return { result, verdict, sources };
  } catch (err) {
    return { error: err.message };
  }
}
