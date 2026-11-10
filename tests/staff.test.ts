import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
process.env.OWNER_USER_ID = 'owner';
delete process.env.TICKET_STAFF_ROLE_IDS;
const { isStaffMember, isStaffRoleName, staffRoles } = await import('../src/bot/staff.js');

type FakeRole = { id: string; name: string; managed: boolean };
function guildWith(roles: FakeRole[]) {
  const cache = new Map(roles.map((role) => [role.id, role]));
  return { id: 'guild', roles: { cache } };
}
function member(id: string, roleIds: string[], guild: ReturnType<typeof guildWith>, administrator = false) {
  return {
    id,
    guild,
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, {}])) },
    permissions: { has: (flag: bigint) => administrator && flag === PermissionFlagsBits.Administrator },
  } as never;
}

describe('the T.C.P team', () => {
  it('knows staff roles by their exact name, whatever the decoration', () => {
    for (const name of ['Admin', '🛡️ Admins', 'Administrator', 'Moderator', 'mod', 'MODS', 'Staff', 'Support', 'support-team', 'Helper'])
      expect(isStaffRoleName(name)).toBe(true);
    for (const name of ['Elite Supporter', 'Supporter', 'Admin Friends', 'PlayStation', 'Moderated', 'Members'])
      expect(isStaffRoleName(name)).toBe(false);
  });

  it('finds the staff roles, never @everyone or a bot role', () => {
    const guild = guildWith([
      { id: 'guild', name: 'Staff', managed: false },
      { id: 'r1', name: 'Admin', managed: false },
      { id: 'r2', name: 'Moderator', managed: false },
      { id: 'r3', name: 'Elite Supporter', managed: false },
      { id: 'r4', name: 'Staff', managed: true },
    ]);
    expect(staffRoles(guild as never).map((role) => role.id)).toEqual(['r1', 'r2']);
  });

  it('counts the owner, a staff role and Administrator, and nobody else', () => {
    const guild = guildWith([
      { id: 'r1', name: 'Admin', managed: false },
      { id: 'r3', name: 'Elite Supporter', managed: false },
    ]);
    expect(isStaffMember(member('owner', [], guild))).toBe(true);
    expect(isStaffMember(member('a', ['r1'], guild))).toBe(true);
    expect(isStaffMember(member('b', [], guild, true))).toBe(true);
    expect(isStaffMember(member('c', ['r3'], guild))).toBe(false);
    expect(isStaffMember(null)).toBe(false);
  });
});
