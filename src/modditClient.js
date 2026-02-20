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
  const url = `${baseUrl}/${sessionId}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        apiKey: process.env.MODDIT_API_KEY,
        body: messages 
      }),
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
