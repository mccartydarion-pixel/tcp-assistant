import { PermissionFlagsBits, type Guild, type GuildMember, type Role } from 'discord.js';
import { env } from '../config/env.js';
import { plainName } from './roles.js';

// The server's staff: the owner, members with a staff role, and anyone with the Administrator permission.
// Staff see every ticket, can claim and close them, and the assistant steps back when they write in one,
// exactly as it does for the owner. Staff roles come from TICKET_STAFF_ROLE_IDS, or else are the roles
// named like Admin, Moderator, Mod, Staff or Support.

/** Role names (letters and digits only) that count as staff when TICKET_STAFF_ROLE_IDS is unset. */
const STAFF_NAMES = new Set([
  'admin',
  'admins',
  'administrator',
  'administrators',
  'moderator',
  'moderators',
  'mod',
  'mods',
  'staff',
  'support',
  'supportteam',
  'helper',
  'helpers',
]);

/** Whether a role is a staff role by name. Exact names only, so "Elite Supporter" is not "Support". */
export function isStaffRoleName(name: string): boolean {
  return STAFF_NAMES.has(plainName(name));
}

export function configuredStaffRoleIds(): string[] {
  return (env.TICKET_STAFF_ROLE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
}

/** The staff roles in this server: the configured ones, else those named like a staff role. */
export function staffRoles(guild: Guild): Role[] {
  const configured = configuredStaffRoleIds();
  if (configured.length > 0) return configured.map((id) => guild.roles.cache.get(id)).filter((role): role is Role => Boolean(role));
  return [...guild.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed && isStaffRoleName(role.name));
}

export function isOwnerId(userId: string): boolean {
  return Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID;
}

/** Whether this member is staff: the owner, an Administrator, or someone with a staff role. */
export function isStaffMember(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (isOwnerId(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return staffRoles(member.guild).some((role) => member.roles.cache.has(role.id));
}

/** The same for a user id: the owner at once, anyone else after looking them up in the server. */
export async function isStaffUser(guild: Guild | null | undefined, userId: string): Promise<boolean> {
  if (isOwnerId(userId)) return true;
  if (!guild) return false;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  return isStaffMember(member);
}
