/**
 * Client for the Moddit "podcast director" API.
 * Sends conversation context and receives suggestion text.
 */

import { config } from './config.js';

const { baseUrl, sessionId } = config.moddit;

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
    const data = await res.json().catch(() => s({}));
    return { suggestion: data.response ?? null };
  } catch (err) {
    return { error: err.message };
  }
}
