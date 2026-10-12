import { describe, expect, it } from 'vitest';
import { codeLine, isOnTrial, joinLines, subscriptionLine, summarizeSubscriptions } from '../src/license/ownerReports.js';
import type { SubscriptionRecord } from '../src/license/licenseStore.js';

// The announcement and settings modules read the bot's environment when they load, so give them the
// required values before importing them.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { parseAnnouncement, buildAnnouncementEmbed } = await import('../src/owner/announcer.js');
const { readRecoilForm, readAdsForm, parseSettingValue, cooldownMinutesLeft, buildSettingsCard, applyGuide, SHARE_COOLDOWN_MS } = await import(
  '../src/settings/settingsPanel.js'
);

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
  const recoilForm = { name: ' Long range M4 ', vertical: '26', horizontal: '-3', turn: '', inGame: 'Vertical 3 / Horizontal 5' };

  it('checks each value against the range the script accepts', () => {
    expect(parseSettingValue('horizontal', '-3', false)).toEqual({ value: -3 });
    expect(parseSettingValue('vertical', ' 26 ', true)).toEqual({ value: 26 });
    expect(parseSettingValue('turn', '', false)).toEqual({});
    expect(parseSettingValue('vertical', '', true)).toEqual({ error: 'Vertical is needed.' });
    expect(parseSettingValue('horizontal', '51', false)).toEqual({ error: 'Horizontal must be between -50 and 50.' });
    expect(parseSettingValue('fireSens', '10', false)).toEqual({ error: 'Fire Sens must be between 20 and 100.' });
    expect('error' in parseSettingValue('easing', '12.5', false)).toBe(true);
    expect('error' in parseSettingValue('easing', 'high', false)).toBe(true);
  });

  it('reads the recoil form, needing a name, Vertical and the in-game sensitivity', () => {
    expect(readRecoilForm(recoilForm)).toEqual({
      name: 'Long range M4',
      inGame: 'Vertical 3 / Horizontal 5',
      values: { vertical: 26, horizontal: -3 },
    });
    expect('error' in readRecoilForm({ ...recoilForm, name: ' ' })).toBe(true);
    expect('error' in readRecoilForm({ ...recoilForm, inGame: '' })).toBe(true);
    expect(readRecoilForm({ ...recoilForm, vertical: '140' })).toEqual({ error: 'Vertical must be between 0 and 100.' });
  });

  it('reads the ADS form, where everything is optional but something is needed', () => {
    const blank = { adsSens: '', precision: '', easing: '', fireSens: '', notes: '' };
    expect('error' in readAdsForm(blank)).toBe(true);
    expect(readAdsForm({ ...blank, adsSens: '60', easing: '12' })).toEqual({ values: { adsSens: 60, easing: 12 }, notes: '' });
    expect(readAdsForm({ ...blank, notes: ' M4 only ' })).toEqual({ values: {}, notes: 'M4 only' });
  });

  it('limits each member to one share every ten minutes', () => {
    expect(cooldownMinutesLeft(undefined, now)).toBe(0);
    expect(cooldownMinutesLeft(now - 60_000, now)).toBe(9);
    expect(cooldownMinutesLeft(now - SHARE_COOLDOWN_MS, now)).toBe(0);
  });

  const draft = {
    playstyle: 'Long range',
    weapon: 'Assault rifle',
    name: 'Long range M4',
    inGame: 'Vertical 3 / Horizontal 5',
    notes: '',
    values: { vertical: 26, horizontal: 0, turn: 40, adsSens: 60, easing: 12 },
    typed: {},
    hasAds: true,
    createdAt: now,
  };

  it('lays the card out as tagged rows of three, recoil then ADS', () => {
    const card = buildSettingsCard(draft, { name: 'Player' }).toJSON();
    expect(card.description).toBe('**Long range**  ·  **Assault rifle**');
    const names = (card.fields ?? []).map((field) => field.name);
    expect(names).toEqual([
      'ANTI-RECOIL', 'Vertical', 'Horizontal', 'Turn Strength',
      'ADS ACCURACY', 'ADS Sens', 'Easing', '​',
      'DayZ in-game sensitivity',
    ]);
  });

  it('leaves out the ADS section when no ADS values were given', () => {
    const card = buildSettingsCard({ ...draft, values: { vertical: 26 } }, { name: 'Player' }).toJSON();
    expect((card.fields ?? []).map((field) => field.name)).not.toContain('ADS ACCURACY');
  });

  it('tells anyone which menu page each value on a card goes on', () => {
    const guide = applyGuide(buildSettingsCard(draft, { name: 'Player' }).toJSON().fields ?? []);
    const lines = guide.split('\n').filter((line) => line.startsWith('`Page'));
    expect(lines).toEqual([
      '`Page 10` Vertical Recoil → **26**',
      '`Page 11` Horizontal Recoil → **0**',
      '`Page 12` Turn Strength → **40**',
      '`Page 18` ADS Sens → **60**',
      '`Page 23` Easing → **12**',
    ]);
    expect(guide).toContain('Vertical 3 / Horizontal 5');
    expect(applyGuide([])).toBe('This card has no values to apply.');
  });
});
