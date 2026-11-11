import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';

const { communityName, isCommunityCategory, isPickerChannelName } = await import('../src/communities/communities.js');
const { plainName } = await import('../src/utils/names.js');
const { withChannelLinks } = await import('../src/announcements/announcements.js');

describe('game communities', () => {
  it('takes the decoration off a category name', () => {
    expect(communityName('· DayZ')).toBe('DayZ');
    expect(communityName('· Battlefield™ 6')).toBe('Battlefield 6');
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

describe('styled channel names', () => {
  // "· 𝑫𝒂𝒚𝒁" and "· 𝑳𝑭𝑮" in mathematical bold italic, "ᴅᴀʏᴢ" in small capitals, "Ｓｃｒｉｐｔ" in fullwidth letters.
  const dayz = '\u00B7 \u{1D46B}\u{1D482}\u{1D49A}\u{1D481}';
  const lfg = '\u00B7 \u{1D473}\u{1D46D}\u{1D46E}';
  const smallCaps = '\u1D05\u1D00\u028F\u1D22';
  const script = '\uFF33\uFF43\uFF52\uFF49\uFF50\uFF54';

  it('reads styled letters as plain ones', () => {
    expect(plainName(dayz)).toBe('\u00B7 DayZ');
    expect(plainName(smallCaps)).toBe('dayz');
    expect(plainName('Battlefield\u2122 6')).toBe('Battlefield 6');
    expect(communityName(dayz)).toBe('DayZ');
  });

  it('finds communities and the picker under styled names', () => {
    expect(isCommunityCategory([lfg, '\u00B7 Chat', script])).toBe(true);
    // "𝑪𝒐𝒎𝒎𝒖𝒏𝒊𝒕𝒊𝒆𝒔"
    expect(isPickerChannelName('\u{1D46A}\u{1D490}\u{1D48E}\u{1D48E}\u{1D496}\u{1D48F}\u{1D48A}\u{1D495}\u{1D48A}\u{1D486}\u{1D494}')).toBe(true);
  });
});

describe('announcement channel links', () => {
  const entry = { id: 'x', date: '2026-11-11', ready: true, title: 'T', description: 'Go to {communities} now', fields: [{ name: 'F', value: 'Press it in {communities}.' }] };

  it('links {communities} to the picker channel when there is one', () => {
    const [linked] = withChannelLinks([entry], { communities: '123456789012345678' });
    expect(linked!.description).toBe('Go to <#123456789012345678> now');
    expect(linked!.fields![0]!.value).toBe('Press it in <#123456789012345678>.');
  });

  it('falls back to plain words without one', () => {
    expect(withChannelLinks([entry], { communities: null })[0]!.description).toBe('Go to the communities channel now');
  });
});
