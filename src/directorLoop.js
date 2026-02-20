/**
 * Periodically sends recent conversation to the Moddit API and logs director suggestions.
 */

import { getRecentForDirector } from './conversationLog.js';
import { getDirectorSuggestion } from './modditClient.js';
import { config } from './config.js';

const { suggestionIntervalSec } = config.moddit;
let intervalId = null;

function tick() {
  const messages = getRecentForDirector();
  if (messages.length === 0) return;
  getDirectorSuggestion(messages).then(({ suggestion, error }) => {
    if (error) {
      console.warn('[Director API]', error);
      return;
    }
    if (suggestion) {
      console.log('\n🎬 Director:', suggestion, '\n');
    }
  });
}

export function startDirectorLoop() {
  if (intervalId) return;
  intervalId = setInterval(tick, suggestionIntervalSec * 1000);
  console.log(`Director loop started (every ${suggestionIntervalSec}s)`);
}

export function stopDirectorLoop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
