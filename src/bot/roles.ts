import { PermissionFlagsBits, type Role } from 'discord.js';

/** Permissions a role the bot hands out automatically must never carry. */
const UNSAFE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

/** Whether the bot may hand this role out by itself: not a bot's or integration's role, and no moderator powers. */
export function isSafeSelfRole(role: Pick<Role, 'managed' | 'permissions'>): boolean {
  return !role.managed && !role.permissions.any(UNSAFE_PERMISSIONS);
}

/** A name reduced to lower-case letters and digits, so "💎 Elite Supporter" and "elite-supporter" compare equal. */
export function plainName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
