import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits, type Guild } from 'discord.js';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { ELITE_HUB_NAME, ELITE_PLAN_ID, buildEliteHubPanel, eliteHubPermissions, isEliteHubName } = await import('../src/premium/eliteHub.js');
const { LICENSE_BUTTON_ID } = await import('../src/license/licensePanel.js');

describe('Elite Hub', () => {
  it('finds its channel by name, whatever the emoji', () => {
    expect(isEliteHubName(ELITE_HUB_NAME)).toBe(true);
    expect(isEliteHubName('elite-hub')).toBe(true);
    expect(isEliteHubName('💎 Elite Hub')).toBe(true);
    expect(isEliteHubName('elite-welcome')).toBe(false);
    expect(isEliteHubName('hub')).toBe(false);
  });

  it('has My plan and Generate, and says what each button does', () => {
    const panel = buildEliteHubPanel();
    const ids = JSON.stringify(panel.components);
    expect(ids).toContain(ELITE_PLAN_ID);
    expect(ids).toContain(LICENSE_BUTTON_ID);
    const text = panel.embeds[0].data.description ?? '';
    expect(text).toContain('**My plan:**');
    expect(text).toContain('**Generate:**');
    expect(text).toContain('Only Elite Supporters can see this channel');
    expect(text).not.toMatch(/licence/i);
  });

  it('is private: hidden from everyone, read-only for the Elite role, the bot posts', () => {
    const guild = { roles: { everyone: { id: 'everyone' } } } as unknown as Guild;
    const overwrites = eliteHubPermissions(guild, 'elite', 'bot', 'owner') as { id: string; allow?: bigint[]; deny?: bigint[] }[];
    const by = (id: string) => overwrites.find((o) => o.id === id)!;
    expect(by('everyone').deny).toContain(PermissionFlagsBits.ViewChannel);
    expect(by('elite').allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(by('elite').deny).toContain(PermissionFlagsBits.SendMessages);
    expect(by('bot').allow).toContain(PermissionFlagsBits.SendMessages);
    expect(by('owner').allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(eliteHubPermissions(guild, 'elite', 'bot').some((o) => (o as { id: string }).id === 'owner')).toBe(false);
  });
});
