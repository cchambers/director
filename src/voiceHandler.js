/**
 * Subscribes to each user in the voice channel, decodes Opus -> PCM,
 * buffers per "speaking turn", transcribes, and logs to conversation.
 * Tracks active speakers so the director loop can avoid sending while someone is talking.
 */

import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { config } from './config.js';
import { transcribeBuffer } from './transcribe.js';
import { append } from './conversationLog.js';
import { requestDirectorSuggestion } from './directorLoop.js';

const { opusFrameSize, sampleRate, channels } = config.audio;
const hostUserId = config.discord.hostUserId || null;
const triggerPhrases = config.discord.directorTriggerPhrases || [];

/** User IDs currently in a speaking turn (started, not yet ended). */
const activeSpeakers = new Set();

/** If a pipeline never gets decoder 'end' (e.g. stuck stream), clear after this ms so the user can be subscribed again. */
const PIPELINE_MAX_MS = 45_000;

/** Returns true if anyone is in the middle of speaking (audio not yet transcribed). */
export function isAnyoneSpeaking() {
  return activeSpeakers.size > 0;
}

/**
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {import('discord.js').Guild} guild
 */
export function setupVoiceReceive(connection, guild) {
  const receiver = connection.receiver;

  const botUserId = guild.client?.user?.id ?? null;

  connection.receiver.speaking.on('start', (userId) => {
    if (botUserId && userId === botUserId) return;
    const member = guild.members.cache.get(userId);
    if (member?.user?.bot) return;
    if (activeSpeakers.has(userId)) return;
    activeSpeakers.add(userId);
    const subscription = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 500,
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: sampleRate,
      channels,
      frameSize: opusFrameSize,
    });

    const chunks = [];
    decoder.on('data', (chunk) => chunks.push(chunk));
    decoder.on('error', (err) => console.warn('Decoder error for', userId, err.message));

    subscription.pipe(decoder);

    const timeout = setTimeout(() => {
      activeSpeakers.delete(userId);
      subscription.destroy();
      console.warn(`[Voice] Pipeline for user ${userId} timed out after ${PIPELINE_MAX_MS / 1000}s; they can be picked up on next speak.`);
    }, PIPELINE_MAX_MS);

    decoder.on('end', async () => {
      clearTimeout(timeout);
      activeSpeakers.delete(userId);
      subscription.destroy();
      if (chunks.length === 0) return;
      const pcm = Buffer.concat(chunks);
      const text = await transcribeBuffer(pcm);
      if (text) {
        const member = guild.members.cache.get(userId);
        const speaker =
          hostUserId && userId === hostUserId
            ? 'HOST'
            : member?.displayName ?? member?.user?.username ?? userId;
        append(speaker, text, { userId });
        if (hostUserId && userId === hostUserId && triggerPhrases.length > 0) {
          const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
          if (triggerPhrases.includes(normalized)) {
            requestDirectorSuggestion().catch((err) => console.warn('[Director trigger]', err.message));
          }
        }
      }
    });
  });
}
