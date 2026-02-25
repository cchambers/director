/**
 * Trigger Discord server soundboard sounds by ID via the Discord API.
 * The bot must be in a voice channel (with SPEAK and USE_SOUNDBOARD) to send a sound.
 */

import { Routes } from 'discord.js';

/** @type {string | null} */
let currentChannelId = null;
/** @type {import('@discordjs/rest').REST | null} */
let rest = null;

/**
 * Set the voice channel to send soundboard sounds to. Call when the bot joins.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 */
export function setVoiceChannel(voiceChannel) {
  if (!voiceChannel?.guild?.client?.rest) {
    currentChannelId = null;
    rest = null;
    return;
  }
  currentChannelId = voiceChannel.id;
  rest = voiceChannel.guild.client.rest;
}

/**
 * Clear the current voice channel (e.g. when the bot leaves). Optional.
 */
export function clearVoiceChannel() {
  currentChannelId = null;
  rest = null;
}

/**
 * Play a Discord soundboard sound in the current voice channel by ID.
 * Requires the bot to be in that channel with SPEAK and USE_SOUNDBOARD.
 * For sounds from another server, pass sourceGuildId (and bot needs USE_EXTERNAL_SOUNDS).
 *
 * @param {string} soundId - Snowflake ID of the sound (e.g. "1460124772145954857")
 * @param {{ sourceGuildId?: string }} [options] - source_guild_id if the sound is from a different server
 * @returns {Promise<boolean>} - true if the request was sent, false if no channel/rest
 */
export async function playSoundboardSound(soundId, options = {}) {
  if (!currentChannelId || !rest || !soundId) return false;
  const body = { sound_id: String(soundId) };
  if (options.sourceGuildId) body.source_guild_id = String(options.sourceGuildId);
  try {
    await rest.post(Routes.sendSoundboardSound(currentChannelId), { body });
    return true;
  } catch (err) {
    console.warn('[Soundboard] send failed:', err.message);
    return false;
  }
}
