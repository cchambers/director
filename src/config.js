import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    /** Discord user ID of the host (for phrase trigger and optional checks). Optional. */
    hostUserId: process.env.DISCORD_HOST_USER_ID || null,
    /** Comma-separated phrases the host can say to trigger a director suggestion (e.g. "yeah,okay,go ahead"). */
    directorTriggerPhrases: (process.env.DISCORD_DIRECTOR_TRIGGER_PHRASES || 'yeah,okay,go ahead')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },
  moddit: {
    baseUrl: process.env.MODDIT_API_URL || 'https://api.moddit.io',
    sessionId: process.env.MODDIT_SESSION_ID || '1234',
    /** How many recent messages to send when asking for director suggestions */
    contextMessages: parseInt(process.env.MODDIT_CONTEXT_MESSAGES || '20', 10),
    /** Min seconds between suggestion requests to avoid rate limits */
    suggestionIntervalSec: parseInt(process.env.MODDIT_SUGGESTION_INTERVAL_SEC || '30', 10),
  },
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
    /** Min audio length (ms) before sending to Deepgram. Lower = catch short cues like "yeah" (set via DEEPGRAM_MIN_AUDIO_MS). */
    minAudioMs: parseInt(process.env.DEEPGRAM_MIN_AUDIO_MS || '500', 10),
  },
  /** Discord Opus is 48kHz stereo; prism Decoder outputs 16-bit PCM */
  audio: {
    sampleRate: 48000,
    channels: 2,
    /** 20ms frame at 48kHz stereo */
    opusFrameSize: 960,
  },
  /** Dashboard UI for director suggestion cards */
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT || '8765', 10),
  },
};
