import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';

const { communityName, isCommunityCategory, isPickerChannelName } = await import('../src/communities/communities.js');

describe('game communities', () => {
  it('takes the decoration off a category name', () => {
    expect(communityName('· DayZ')).toBe('DayZ');
    expect(communityName('· Battlefield™ 6')).toBe('Battlefield™ 6');
    expect(communityName('🎮・Rust')).toBe('Rust');
    expect(communityName('Plain')).toBe('Plain');
  });

  it('counts a category as a community when it has an LFG and a Script channel', () => {
    expect(isCommunityCategory(['・lfg', '・chat', '・script', '・clips'])).toBe(true);
    expect(isCommunityCategory(['· LFG', '· Chat', '· Script'])).toBe(true);
    expect(isCommunityCategory(['・lfg', '・chat'])).toBe(false);
    expect(isCommunityCategory(['tickets', 'transcripts'])).toBe(false);
  });

  it('finds the picker channel by name', () => {
    expect(isPickerChannelName('🎮・communities')).toBe(true);
    expect(isPickerChannelName('community-picker')).toBe(true);
    expect(isPickerChannelName('general')).toBe(false);
  });
});
