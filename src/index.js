/**
 * Podcast Director bot: joins a Discord voice channel, transcribes conversation,
 * logs it, and periodically sends context to api.moddit.io for director suggestions.
 *
 * Invite the bot to your server, then use slash command or message to make it join
 * your current voice channel.
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import { config } from './config.js';
import { setupVoiceReceive } from './voiceHandler.js';
import { startDirectorLoop } from './directorLoop.js';

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

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log('Use /join in a server where the bot is in a voice channel, or message the bot: "join"');
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

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfMute: true,
    selfDeafen: false, // must be false to receive others' audio
  });

  setupVoiceReceive(connection, message.guild);
  startDirectorLoop();
  await message.reply(`Joined **${voiceChannel.name}**. I'm listening and logging; director suggestions will appear in the console.`);
});

// Slash command registration (optional; run once)
const JOIN_COMMAND = {
  name: 'join',
  description: 'Make the bot join your current voice channel and start the podcast director',
};

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'join') return;
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    return;
  }
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfMute: true,
    selfDeafen: false, // must be false to receive others' audio
  });
  setupVoiceReceive(connection, interaction.guild);
  startDirectorLoop();
  await interaction.reply({ content: `Joined **${voiceChannel.name}**. Director is active.`, ephemeral: false });
});

client.login(discord.token).catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
