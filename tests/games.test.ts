import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { GAME_SCRIPTS, findGame, buildGamePanel, installGuide } = await import('../src/games/gameScripts.js');
const { availableGuides, welcomeGuide } = await import('../src/welcome/welcome.js');

const dayz = findGame('dayz')!;

describe('game scripts', () => {
  it('lists DayZ with its channel and download link', () => {
    expect(dayz.channelId).toBe('1559405473000591411');
    expect(dayz.downloadUrl).toBe('https://gpclib.cmindapi.com/gpc-library/13905');
  });

  it('gives every game a unique key and a valid link', () => {
    const keys = GAME_SCRIPTS.map((game) => game.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const game of GAME_SCRIPTS) {
      expect(game.key).toMatch(/^[a-z0-9-]+$/);
      expect(() => new URL(game.downloadUrl)).not.toThrow();
    }
  });

  it('fits within Discord embed limits', () => {
    for (const game of GAME_SCRIPTS) {
      const embed = buildGamePanel(game, true).message.embeds[0].toJSON();
      expect((embed.fields ?? []).length).toBeLessThanOrEqual(25);
      for (const field of embed.fields ?? []) expect(field.value.length).toBeLessThanOrEqual(1024);
      expect((embed.description ?? '').length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('game showcase', () => {
  it('has the banner, a Download link and an install button', () => {
    const { installId, message } = buildGamePanel(dayz, true);
    const embed = message.embeds[0].toJSON();
    expect(embed.title).toBe('T.C.P for DayZ');
    expect(embed.url).toBe(dayz.downloadUrl);
    expect(embed.image?.url).toBe('attachment://tcp-banner.png');
    const buttons = message.components[0].toJSON().components;
    expect(buttons[0]).toMatchObject({ label: 'Download', url: dayz.downloadUrl });
    expect(buttons[1]).toMatchObject({ label: 'How to install', custom_id: installId });
  });

  it('keeps the same fingerprint until the wording changes', () => {
    const first = buildGamePanel(dayz, true).installId;
    expect(buildGamePanel(dayz, true).installId).toBe(first);
    expect(buildGamePanel({ ...dayz, summary: `${dayz.summary} Now with more.` }, true).installId).not.toBe(first);
    expect(buildGamePanel({ ...dayz, downloadUrl: 'https://example.com/new' }, true).installId).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it('points the install guide at the licence and bug channels', () => {
    const guide = installGuide(dayz, { licence: '111', bugs: '222' });
    expect(guide).toContain('<#111>');
    expect(guide).toContain('<#222>');
    expect(installGuide(dayz, {})).not.toContain('<#');
  });
});

describe('welcome download guide', () => {
  it('lists each game channel', () => {
    const channels = { games: [{ game: 'DayZ', channelId: '1559405473000591411' }] };
    expect(availableGuides(channels)).toContain('download');
    expect(welcomeGuide('download', channels, 14)).toContain('**DayZ**: <#1559405473000591411>');
  });

  it('falls back to the download channel when no games are listed', () => {
    expect(welcomeGuide('download', { download: '333', games: [] }, 14)).toContain('<#333>');
  });
});
