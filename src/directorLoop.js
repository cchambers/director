/**
 * Sends recent conversation to the Moddit API and returns the director suggestion.
 * Resets the conversation log after a successful send (Moddit manages history).
 * Triggered by /suggest slash command or when the host says a trigger phrase (e.g. "yeah").
 */

import { getRecentForDirector, reset as resetLog } from './conversationLog.js';
import { getDirectorSuggestion } from './modditClient.js';
import { pushSuggestion } from './dashboard.js';
import { config } from './config.js';

/**
 * Request a director suggestion from Moddit. Call from /suggest or when host says a trigger phrase.
 * @returns {Promise<{ suggestion?: string | null, error?: string }>}
 */
export async function requestDirectorSuggestion() {
  const messages = getRecentForDirector();
  if (messages.length === 0) {
    return { error: 'No conversation yet.' };
  }
  const { suggestion, error } = await getDirectorSuggestion(messages);
  if (error) {
    return { suggestion: null, error };
  }
  resetLog();
  if (suggestion) {
    console.log('\n🎬 Director:', suggestion, '\n');
    pushSuggestion(suggestion);
  }
  return { suggestion: suggestion ?? null };
}

/** Called when bot joins voice; no timer. Director is triggered by /suggest or host phrase. */
export function startDirectorLoop() {
  console.log('Director ready. Use /suggest or say a trigger phrase (e.g. "yeah") to get a suggestion.');
}
