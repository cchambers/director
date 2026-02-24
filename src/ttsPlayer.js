/**
 * Plays TTS (ElevenLabs) on the current Discord voice connection.
 * Register the connection when the bot joins; call speak(text) when the bot should say something.
 */

import { createAudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import { getTTSStream } from './elevenlabsClient.js';

/** @type {import('@discordjs/voice').VoiceConnection | null} */
let currentConnection = null;
/** @type {import('@discordjs/voice').AudioPlayer | null} */
let audioPlayer = null;

/**
 * Register the voice connection so TTS can play. Call when the bot joins a channel.
 * @param {import('@discordjs/voice').VoiceConnection} connection
 */
export function setConnection(connection) {
  currentConnection = connection;
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer();
  }
  const sub = connection.subscribe(audioPlayer);
  if (!sub) {
    console.warn('[TTS] Could not subscribe player to connection');
  }
}

/**
 * Clear the stored connection (e.g. when bot leaves). Optional.
 */
export function clearConnection() {
  currentConnection = null;
}

/**
 * Speak text in the current voice channel via ElevenLabs. No-op if no connection or no API key.
 * @param {string} text
 * @param {{ voiceId?: string }} [options] - Optional ElevenLabs voice ID (e.g. from UI dropdown)
 */
export async function speak(text, options = {}) {
  if (!currentConnection || !audioPlayer) return;
  const stream = await getTTSStream(text, { voiceId: options.voiceId });
  if (!stream) return;
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  audioPlayer.play(resource);
}
