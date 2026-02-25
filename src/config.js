import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    /** Discord user ID of the host (for phrase trigger and optional checks). Optional. */
    hostUserId: process.env.DISCORD_HOST_USER_ID || null,
    /** If true and hostUserId is set, bot auto-joins the voice channel the host is in (on ready and when host joins). */
    autoJoinHostChannel: process.env.DISCORD_AUTO_JOIN_HOST_CHANNEL === 'true' || process.env.DISCORD_AUTO_JOIN_HOST_CHANNEL === '1',
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
    /** If set (e.g. 'firefox'), video links open in this browser instead of the same window. Requires 'open' package. */
    openVideoInBrowser: process.env.OPEN_VIDEO_IN_BROWSER || null,
  },
  /** Claims: auto-extract when a log line is longer than this (0 = disabled). */
  claims: {
    autoExtractMinLineLength: parseInt(process.env.CLAIM_EXTRACT_MIN_LINE_LENGTH || '20', 10),
  },
  /** OBS WebSocket: lower-third browser source control (optional). */
  obs: {
    /** WebSocket URL (e.g. ws://192.168.0.106:4455). If unset, lower-third trigger is no-op. */
    wsUrl: process.env.OBS_WS_URL || null,
    /** Password for OBS WebSocket server. */
    password: process.env.OBS_WS_PASSWORD || null,
    /** Browser source name in OBS (e.g. "lower-third"). */
    lowerThirdSourceName: process.env.OBS_LOWER_THIRD_SOURCE_NAME || 'lower-third',
    /** Base URL for the chyron (query params first & second are appended). */
    lowerThirdBaseUrl: process.env.OBS_LOWER_THIRD_BASE_URL || 'https://cdpn.io/pen/debug/mKbQGa/e70d51e92a36ff6eddedd781368ae604',
  },
  /** ElevenLabs TTS (optional). If set, director suggestions are spoken in voice. */
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || null,
    voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    /**
     * Name -> voiceId string OR { voiceId, modId? }.
     * modId is optional; when missing, MODERATOR_MOD_ID (env or default) is used for getModeratorResponse.
     */
    voices: {
      Khi: { voiceId: 'Iq6TL7fCl0jSeSIIgGEG' },
      Ajit: { voiceId: 'pzxut4zZz4GImZNlqQ3H' },
      Rachel: { voiceId: '21m00Tcm4TlvDq8ikWAM' },
      Adam: { voiceId: 'pNInz6obpgDQGcFmaJgB' },
      Sam: { voiceId: 'yoZ06aMxZJJ28mfd3POQ' },
      Nadia: { voiceId: 'GCPLhb1XrVwcoKUJYcvz' },
      Nikov: { voiceId: '3faLw6tqzw5w1UZMFTgL' },
      Minerva: { voiceId: '0E0gsPZaYRcRuLRIO5iU' },
      OldMan: { voiceId: 'NOpBlnGInO9m6vDvFkFC' },
      OldMan2: { voiceId: 'SGfyGfQJBs0O7iPKEkB5' },
      Donut: { voiceId: 'USEQXnsXRJlw2k9LUzG4', modId: '523803a8-8f32-40a7-9fc8-5fe168632c90', store: true },
    },
  },
  /** Default mod for moderator/speak when a voice does not specify modId (env MODERATOR_MOD_ID or fallback). */
  moderatorModId: process.env.MODERATOR_MOD_ID || '1c45d7e7-0130-4083-ad27-976a6fa5a584',
};

/**
 * Normalize a voice entry (string = voiceId only, or { voiceId, modId? }) to { voiceId, modId }.
 * @param {string|{ voiceId: string, modId?: string }} v
 * @param {string} defaultModId
 * @returns {{ voiceId: string, modId: string }}
 */
export function normalizeVoiceEntry(v, defaultModId) {
  if (typeof v === 'string') return { voiceId: v, modId: defaultModId };
  return {
    voiceId: v?.voiceId ?? '',
    modId: v?.modId ?? defaultModId,
  };
}
