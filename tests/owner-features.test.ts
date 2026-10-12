import { describe, expect, it } from 'vitest';
import { codeLine, isOnTrial, joinLines, subscriptionLine, summarizeSubscriptions } from '../src/license/ownerReports.js';
import type { SubscriptionRecord } from '../src/license/licenseStore.js';

// The announcement and settings modules read the bot's environment when they load, so give them the
// required values before importing them.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { parseAnnouncement, buildAnnouncementEmbed } = await import('../src/owner/announcer.js');
const { parseSettingsShare, cooldownMinutesLeft, buildSettingsEmbed, SHARE_COOLDOWN_MS } = await import('../src/settings/settingsPanel.js');

const DAY = 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;

describe('owner reports', () => {
  const rows: SubscriptionRecord[] = [
    { discordUserId: 'expired', expiresAt: now - DAY, trialGrantedAt: null },
    { discordUserId: 'trial', expiresAt: now + 10 * DAY, trialGrantedAt: now - 4 * DAY },
    { discordUserId: 'soon', expiresAt: now + 3 * DAY, trialGrantedAt: null },
    { discordUserId: 'long', expiresAt: now + 40 * DAY, trialGrantedAt: now - 30 * DAY },
  ];

  it('splits active, expiring and expired, soonest first', () => {
    const summary = summarizeSubscriptions(rows, now, 14);
    expect(summary.active.map((row) => row.discordUserId)).toEqual(['soon', 'trial', 'long']);
    expect(summary.expiringSoon.map((row) => row.discordUserId)).toEqual(['soon']);
    expect(summary.expiredCount).toBe(1);
    expect(summary.trialCount).toBe(1);
  });

  it('counts a member as on trial only until the owner adds days', () => {
    expect(isOnTrial(rows[1]!, 14)).toBe(true);
    // Granted a trial 30 days ago but now runs 40 more days: the owner extended it.
    expect(isOnTrial(rows[3]!, 14)).toBe(false);
    expect(isOnTrial(rows[2]!, 14)).toBe(false);
  });

  it('formats lines with mentions, days and the trial tag', () => {
    expect(subscriptionLine(rows[1]!, now, 14)).toBe('<@trial> · 10 days left · trial');
    expect(subscriptionLine({ discordUserId: 'one', expiresAt: now + DAY, trialGrantedAt: null }, now, 14)).toBe('<@one> · 1 day left');
    expect(codeLine({ discordUserId: 'u', challenge: 48213, tier: 4, createdAt: now })).toContain('`48213` · 200 power-ups');
  });

  it('keeps long lists inside an embed and says how many were left out', () => {
    expect(joinLines([], 'Nothing here.')).toBe('Nothing here.');
    const lines = Array.from({ length: 500 }, (_, index) => `<@${index}> · 30 days left`);
    const text = joinLines(lines, '');
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/…and \d+ more$/);
  });
});

describe('announcements', () => {
  it('needs a title and text, and a web link if one is given', () => {
    expect(parseAnnouncement({ title: ' ', version: '', notes: 'x', link: '' }, false)).toEqual({ error: 'The announcement needs a title.' });
    expect(parseAnnouncement({ title: 'x', version: '', notes: '  ', link: '' }, false)).toEqual({ error: 'The announcement needs some text.' });
    expect('error' in parseAnnouncement({ title: 'x', version: '', notes: 'y', link: 'discord.gg/abc' }, false)).toBe(true);
    expect(parseAnnouncement({ title: ' T.C.P v2.1 ', version: ' 2.1 ', notes: ' New stuff ', link: 'https://x.y/z' }, true)).toEqual({
      draft: { title: 'T.C.P v2.1', version: '2.1', notes: 'New stuff', link: 'https://x.y/z', withFlyer: true },
    });
  });

  it('shows the flyer only when asked', () => {
    const base = { title: 't', version: '', notes: 'n', link: '' };
    expect(buildAnnouncementEmbed({ ...base, withFlyer: true }).toJSON().image?.url).toBe('attachment://tcp-flyer.gif');
    expect(buildAnnouncementEmbed({ ...base, withFlyer: false }).toJSON().image).toBeUndefined();
  });
});

describe('settings sharing', () => {
  const full = { name: 'Long range M4', recoil: 'V 26 / H 0', ads: '', inGame: 'Vertical 3 / Horizontal 5', notes: '' };

  it('needs a name, the in-game sensitivity, and recoil or ADS values', () => {
    expect('share' in parseSettingsShare(full)).toBe(true);
    expect('error' in parseSettingsShare({ ...full, name: ' ' })).toBe(true);
    expect('error' in parseSettingsShare({ ...full, inGame: '' })).toBe(true);
    expect('error' in parseSettingsShare({ ...full, recoil: '', ads: '' })).toBe(true);
  });

  it('limits each member to one share every ten minutes', () => {
    expect(cooldownMinutesLeft(undefined, now)).toBe(0);
    expect(cooldownMinutesLeft(now - 60_000, now)).toBe(9);
    expect(cooldownMinutesLeft(now - SHARE_COOLDOWN_MS, now)).toBe(0);
  });

  it('only shows the sections that were filled in', () => {
    const fields = buildSettingsEmbed(full, { name: 'Player' }).toJSON().fields ?? [];
    expect(fields.map((field) => field.name)).toEqual(['Anti-Recoil', 'DayZ in-game sensitivity']);
  });
});
