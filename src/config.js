import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
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
    /** Only transcribe if we have at least this much audio (ms) to avoid noise */
    minAudioMs: parseInt(process.env.DEEPGRAM_MIN_AUDIO_MS || '1500', 10),
  },
  /** Discord Opus is 48kHz stereo; prism Decoder outputs 16-bit PCM */
  audio: {
    sampleRate: 48000,
    channels: 2,
    /** 20ms frame at 48kHz stereo */
    opusFrameSize: 960,
  },
};
