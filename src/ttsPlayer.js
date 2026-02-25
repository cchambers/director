/**
 * Plays TTS (ElevenLabs) on the current Discord voice connection.
 * Register the connection when the bot joins; call speak(text) when the bot should say something.
 * Can also play a local MP3 file (e.g. "one moment" response) via playLocalMp3(path).
 * TTS and MP3 are queued and play only when no one else is talking (so the bot doesn't interrupt).
 */

import { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } from '@discordjs/voice';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getTTSStream } from './elevenlabsClient.js';
import { isAnyoneSpeaking } from './voiceHandler.js';

/** @type {import('@discordjs/voice').VoiceConnection | null} */
let currentConnection = null;
/** @type {import('@discordjs/voice').AudioPlayer | null} */
let audioPlayer = null;

/** Queue: { type: 'speak', text, options } | { type: 'mp3', filePath } */
const ttsQueue = [];
const POLL_MS = 400;
const SILENCE_GRACE_MS = 500;

/**
 * Play the next queued item if the player is idle and no one is speaking.
 * Called when queue gains an item and when the player becomes idle.
 */
async function processQueue() {
  if (!currentConnection || !audioPlayer || ttsQueue.length === 0) return;
  if (audioPlayer.state.status !== AudioPlayerStatus.Idle) return;
  if (isAnyoneSpeaking()) {
    setTimeout(processQueue, POLL_MS);
    return;
  }
  setTimeout(async () => {
    if (isAnyoneSpeaking()) {
      setTimeout(processQueue, POLL_MS);
      return;
    }
    const item = ttsQueue.shift();
    if (!item) return;
    if (item.type === 'speak') {
      const stream = await getTTSStream(item.text, { voiceId: item.options?.voiceId });
      if (stream) {
        const resource = createAudioResource(stream, { inputType: StreamType.Raw });
        audioPlayer.play(resource);
      } else {
        processQueue();
      }
    } else if (item.type === 'mp3') {
      const resolved = path.isAbsolute(item.filePath) ? item.filePath : path.join(process.cwd(), item.filePath);
      if (!fs.existsSync(resolved)) {
        console.warn('[TTS] playLocalMp3: file not found', resolved);
        processQueue();
        return;
      }
      const ffmpegPath = (typeof process.env.FFMPEG_PATH === 'string' && process.env.FFMPEG_PATH.trim()) ? process.env.FFMPEG_PATH.trim().replace(/^["']|["']$/g, '') : 'ffmpeg';
      const ffmpeg = spawn(ffmpegPath, ['-nostdin', '-f', 'mp3', '-i', resolved, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      ffmpeg.on('error', (err) => console.warn('[TTS] ffmpeg for local MP3:', err.message));
      const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
      audioPlayer.play(resource);
    }
  }, SILENCE_GRACE_MS);
}

/**
 * Register the voice connection so TTS can play. Call when the bot joins a channel.
 * @param {import('@discordjs/voice').VoiceConnection} connection
 */
export function setConnection(connection) {
  currentConnection = connection;
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer();
    audioPlayer.on(AudioPlayerStatus.Idle, () => processQueue());
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
  ttsQueue.length = 0;
}

/**
 * Speak text in the current voice channel via ElevenLabs. No-op if no connection or no API key.
 * Queued and played when no one else is talking.
 * @param {string} text
 * @param {{ voiceId?: string }} [options] - Optional ElevenLabs voice ID (e.g. from UI dropdown)
 */
export async function speak(text, options = {}) {
  if (!currentConnection || !audioPlayer) return;
  ttsQueue.push({ type: 'speak', text, options: { ...options } });
  processQueue();
}

/**
 * Play a local MP3 file in the current voice channel (e.g. responses/one-moment.mp3).
 * No-op if no connection or file missing. Uses ffmpeg to convert MP3 to PCM (48kHz stereo).
 * Queued and played when no one else is talking.
 * @param {string} filePath - Absolute or relative path to .mp3 file
 */
export function playLocalMp3(filePath) {
  if (!currentConnection || !audioPlayer) return;
  ttsQueue.push({ type: 'mp3', filePath });
  processQueue();
}
