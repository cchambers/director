/**
 * Transcribe PCM audio via Deepgram pre-recorded API.
 * Discord Opus is decoded to 48kHz stereo 16-bit PCM before calling this.
 */

import { createClient } from '@deepgram/sdk';
import { config } from './config.js';
import { increment } from './stats.js';

const { apiKey, minAudioMs } = config.deepgram;
const { sampleRate, channels } = config.audio;

const deepgram = apiKey ? createClient(apiKey) : null;

/**
 * @param {Buffer} pcmBuffer - 16-bit signed PCM, 48kHz, stereo
 * @returns {Promise<string|null>} - Transcribed text or null
 */
export async function transcribeBuffer(pcmBuffer) {
  if (!deepgram) {
    console.warn('DEEPGRAM_API_KEY not set; skipping transcription');
    return null;
  }
  const durationMs = (pcmBuffer.length / (sampleRate * channels * 2)) * 1000;
  if (durationMs < minAudioMs) return null;

  try {
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(pcmBuffer, {
      model: 'nova-2',
      smart_format: true,
      encoding: 'linear16',
      sample_rate: sampleRate,
      channels,
    });
    if (error) {
      console.error('Deepgram error:', error);
      return null;
    }
    const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    const transcript = text?.trim() || null;
    if (transcript) increment('transcriptions');
    return transcript;
  } catch (err) {
    console.error('Transcribe error:', err);
    return null;
  }
}
