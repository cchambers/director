/**
 * Discord role-based permissions for bot commands.
 * Only users with an allowed role (e.g. Cast Host, Cast Guest) can run /join, /suggest, /fc, /video and the "join" message.
 */

import { config } from './config.js';

const { allowedRoleNames, hostUserId } = config.discord;

/**
 * Ensure allowed roles exist in the guild; create them if missing.
 * Bot needs Manage Roles and its role must be above these in the hierarchy.
 * @param {import('discord.js').Guild} guild
 */
export async function ensureGuildRoles(guild) {
  for (const name of allowedRoleNames) {
    const existing = guild.roles.cache.find((r) => r.name === name);
    if (existing) continue;
    try {
      await guild.roles.create({ name, permissions: [] });
      console.log(`[Permissions] Created role "${name}" in ${guild.name}`);
    } catch (err) {
      console.warn(`[Permissions] Could not create role "${name}" in ${guild.name}:`, err.message);
    }
  }
}

/**
 * Return true if the member is allowed to run bot commands (has an allowed role or is the configured host).
 * @param {import('discord.js').GuildMember | null} member
 * @returns {boolean}
 */
export function canRunCommands(member) {
  if (!member || !member.guild) return false;
  if (hostUserId && member.id === hostUserId) return true;
  return member.roles.cache.some((r) => allowedRoleNames.includes(r.name));
}
