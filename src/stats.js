/**
 * In-memory session stats. Counts reset when the process restarts.
 * Used for: Moddit API calls, Deepgram transcriptions, TTS messages.
 */

const COUNTER_NAMES = [
  'directorSuggestion',
  'moderatorSpeak',
  'moderatorSpeakWithSearch',
  'factCheck',
  'claimExtraction',
  'factCheckClaim',
  'topicUpdate',
  'transcriptions',
  'tts',
];

const counters = Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0]));

/**
 * Increment a counter by name. No-op if name is not a known counter.
 * @param {string} name - One of the COUNTER_NAMES (e.g. 'directorSuggestion', 'tts')
 */
export function increment(name) {
  if (typeof counters[name] === 'number') {
    counters[name] += 1;
  }
}

/**
 * @returns {Record<string, number>} Current counts for all stats (read-only snapshot)
 */
export function getStats() {
  return { ...counters };
}
