/**
 * One-time (or when you add commands): register slash commands for the bot.
 * Run: node src/registerCommands.js
 *
 * Required in .env:
 *   DISCORD_TOKEN, DISCORD_APPLICATION_ID (bot's application id from Discord Developer Portal)
 *
 * Optional for instant /join in one server:
 *   DISCORD_GUILD_ID - your server's guild id. If set, commands are also registered to this
 *   guild so they appear immediately (global commands can take up to 1 hour to propagate).
 *   Right-click your server icon → Copy Server ID (enable Developer Mode in Discord settings first).
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId) {
  console.error('Set DISCORD_TOKEN and DISCORD_APPLICATION_ID in .env');
  process.exit(1);
}

const commands = [
  {
    name: 'join',
    description: 'Make the bot join your voice channel and start the podcast director',
  },
  {
    name: 'suggest',
    description: 'Send current conversation to Moddit and get a director suggestion',
  },
];

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log('Registering slash commands...');

    // Global registration (works in all servers, but can take up to ~1 hour to show)
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('Registered globally (may take up to 1 hour to appear in servers).');

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
      console.log(`Registered to guild ${guildId} — /join should appear immediately in that server.`);
    } else {
      console.log('Tip: set DISCORD_GUILD_ID in .env and re-run this script for instant /join in one server.');
    }

    console.log('Done.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
