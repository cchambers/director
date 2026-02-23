/**
 * Client for the Moddit API (director suggestions and fact-check).
 * Sends conversation context and receives response text.
 */

import { config } from './config.js';

const { baseUrl, sessionId } = config.moddit;

/** Moddit model ID for fact-checking. */
const FACTCHECK_MOD_ID = 'a274a291-1581-43d0-a526-315c8dccc8de';

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
        input: `Latest conversation context -- Khi is the host you are assisting:\n
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
