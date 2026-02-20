/**
 * Subscribes to each user in the voice channel, decodes Opus -> PCM,
 * buffers per "speaking turn", transcribes, and logs to conversation.
 */

import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { config } from './config.js';
import { transcribeBuffer } from './transcribe.js';
import { append } from './conversationLog.js';

const { opusFrameSize, sampleRate, channels } = config.audio;

/**
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {import('discord.js').Guild} guild
 */
export function setupVoiceReceive(connection, guild) {
  const receiver = connection.receiver;

  connection.receiver.speaking.on('start', (userId) => {
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

    decoder.on('end', async () => {
      subscription.destroy();
      if (chunks.length === 0) return;
      const pcm = Buffer.concat(chunks);
      const text = await transcribeBuffer(pcm);
      if (text) {
        const member = guild.members.cache.get(userId);
        const speaker = member?.displayName ?? member?.user?.username ?? userId;
        append(speaker, text);
      }
    });
  });
}
