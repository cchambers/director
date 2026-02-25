/**
 * Podcast Director bot: joins a Discord voice channel, transcribes conversation,
 * logs it, and periodically sends context to api.moddit.io for director suggestions.
 *
 * Invite the bot to your server, then use slash command or message to make it join
 * your current voice channel.
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';
import { MessageFlags } from 'discord-api-types/v10';
import { joinVoiceChannel } from '@discordjs/voice';
import { config } from './config.js';
import { setupVoiceReceive } from './voiceHandler.js';
import { setConnection as setTTSConnection } from './ttsPlayer.js';
import { startDirectorLoop, requestDirectorSuggestion } from './directorLoop.js';
import { startSessionLog, getRecentForDirector } from './conversationLog.js';
import { getFactCheck } from './modditClient.js';
import { startDashboard } from './dashboard.js';
import { setVoiceChannel as setSoundboardChannel } from './soundboard.js';

const { discord } = config;

if (!discord.token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

/**
 * Join a voice channel and start listening/session. Used by /join, "join" message, and auto-join.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 */
function doJoinChannel(voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfMute: false,
    selfDeaf: false, // undeafened so the bot can send soundboard sounds
  });
  setupVoiceReceive(connection, voiceChannel.guild);
  setTTSConnection(connection);
  setSoundboardChannel(voiceChannel);
  startDirectorLoop();
  const { logPath, captionPath } = startSessionLog();
  console.log('Conversation log:', logPath);
  console.log('Caption file (SRT):', captionPath);
  return connection;
}

/** If auto-join is enabled and host is in a voice channel, join that channel. */
async function tryAutoJoinHost() {
  const { autoJoinHostChannel, hostUserId } = discord;
  if (!autoJoinHostChannel || !hostUserId) return;
  for (const [, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(hostUserId).catch(() => null);
      const voiceChannel = member?.voice?.channel;
      if (voiceChannel) {
        console.log(`Auto-join: joining host in **${voiceChannel.name}** (${guild.name})`);
        doJoinChannel(voiceChannel);
        return;
      }
    } catch (_) {}
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  if (discord.autoJoinHostChannel && discord.hostUserId) {
    console.log('Auto-join host channel is ON; will join when host is in voice.');
  }
  startDashboard();
  await tryAutoJoinHost();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const { autoJoinHostChannel, hostUserId } = discord;
  if (!autoJoinHostChannel || !hostUserId || newState.member?.id !== hostUserId) return;
  const channel = newState.channel;
  if (!channel) return; // host left voice
  const botInSameGuild = newState.guild.members.me?.voice?.channelId;
  if (botInSameGuild === channel.id) return; // already in this channel
  console.log(`Auto-join: host joined **${channel.name}**, joining.`);
  doJoinChannel(channel);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim().toLowerCase();
  if (content !== 'join' && content !== '!join') return;

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply('Join a voice channel first, then say `join`.');
    return;
  }

  doJoinChannel(voiceChannel);
  await message.reply(`Joined **${voiceChannel.name}**. I'm listening and logging; director suggestions will appear in the console.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'join') {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
      return;
    }
    doJoinChannel(voiceChannel);
    await interaction.reply({ content: `Joined **${voiceChannel.name}**. Director is active!` });
    return;
  }

  if (interaction.commandName === 'suggest') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { suggestion, error } = await requestDirectorSuggestion();
    const content = error
      ? `Director: ${error}`
      : suggestion
        ? `🎬 **Director:**  \n\n ${suggestion}`
        : 'No suggestion this time.';
    await interaction.editReply({ content });
    return;
  }

  if (interaction.commandName === 'fc') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const messages = getRecentForDirector();
    if (messages.length === 0) {
      await interaction.editReply({ content: 'No conversation yet to fact-check.' });
      return;
    }
    const { result, error } = await getFactCheck(messages);
    const content = error
      ? `Fact-check: ${error}`
      : result
        ? `🔍 **Fact-check:**\n\n${result}`
        : 'No fact-check result.';
    await interaction.editReply({ content });
  }
});

client.login(discord.token).catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
