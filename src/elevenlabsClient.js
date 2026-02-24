/**
 * ElevenLabs text-to-speech: fetch MP3, convert to 48kHz stereo PCM for Discord.
 * Requires ELEVENLABS_API_KEY. Optional ELEVENLABS_VOICE_ID (default voice if unset).
 * Conversion uses ffmpeg (must be on PATH) for MP3 -> s16le 48k stereo.
 * Each generated MP3 is saved to the project's audio/ folder with a timestamped filename.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const MAX_TEXT_LENGTH = 2500;

/** Directory under project root where TTS MP3s are saved. */
const AUDIO_DIR = path.join(process.cwd(), 'audio');

/**
 * Get a stream of 48kHz 16-bit stereo PCM suitable for Discord createAudioResource(..., { inputType: StreamType.Raw }).
 * @param {string} text - Text to speak (truncated if over MAX_TEXT_LENGTH)
 * @param {{ voiceId?: string }} options
 * @returns {Promise<Readable | null>} PCM stream or null if disabled/error
 */
export async function getTTSStream(text, options = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey?.trim()) return null;

  const clean = String(text).trim().slice(0, MAX_TEXT_LENGTH);
  if (!clean) return null;

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
  } catch (err) {
    console.warn('[TTS] ElevenLabs request failed:', err.message);
    return null;
  }

  if (!res.ok) {
    const t = await res.text();
    console.warn('[TTS] ElevenLabs error:', res.status, t.slice(0, 200));
    return null;
  }

  let buffer;
  try {
    buffer = await res.arrayBuffer();
  } catch (err) {
    console.warn('[TTS] Failed to read response:', err.message);
    return null;
  }
  if (!buffer || buffer.byteLength === 0) return null;

  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const name = `tts_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp3`;
    const filePath = path.join(AUDIO_DIR, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log('[TTS] Saved:', filePath);
  } catch (err) {
    console.warn('[TTS] Could not save audio file:', err.message);
  }

  try {
    const buf = Buffer.from(buffer);
    const nodeStream = Readable.from([buf]);
    return convertMp3ToPcmStream(nodeStream);
  } catch (err) {
    console.warn('[TTS] Stream conversion failed:', err.message);
    return null;
  }
}

/**
 * Pipe MP3 through ffmpeg to 48kHz s16le stereo. Returns PCM stream.
 * Use FFMPEG_PATH in env to point to ffmpeg executable if it's not on PATH.
 * @param {Readable} mp3Stream
 * @returns {Readable} PCM stream (48k, s16le, stereo)
 */
function convertMp3ToPcmStream(mp3Stream) {
  const rawEnv = process.env.FFMPEG_PATH;
  const ffmpegPath = (typeof rawEnv === 'string' && rawEnv.trim()) ? rawEnv.trim().replace(/^["']|["']$/g, '') : 'ffmpeg';
  const ffmpeg = spawn(
    ffmpegPath,
    ['-nostdin', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  );
  ffmpeg.on('error', (err) => {
    console.warn('[TTS] ffmpeg not found or failed:', err.message);
  });
  mp3Stream.pipe(ffmpeg.stdin);
  mp3Stream.on('error', () => ffmpeg.kill());
  return ffmpeg.stdout;
}
