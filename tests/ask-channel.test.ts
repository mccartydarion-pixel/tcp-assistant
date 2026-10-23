import { describe, expect, it } from 'vitest';
// The module reads the bot's environment when it loads, so give it the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { askChannelRedirect, assistantAllowedIn } = await import('../src/bot/askChannel.js');

const HELP = '111';

describe('the assistant answers only in #ask-tcp and in tickets', () => {
  it.each([
    [{ channelId: HELP, parentId: null, isTicket: false }, true],
    [{ channelId: '222', parentId: HELP, isTicket: false }, true],
    [{ channelId: '333', parentId: '999', isTicket: true }, true],
    [{ channelId: '444', parentId: null, isTicket: false }, false],
    [{ channelId: '555', parentId: '777', isTicket: false }, false],
  ] as const)('%j allowed: %s', (where, expected) => {
    expect(assistantAllowedIn(where, HELP)).toBe(expected);
  });

  it('answers anywhere when no help channel is configured (nowhere to send people)', () => {
    expect(assistantAllowedIn({ channelId: '444', parentId: null, isTicket: false }, undefined)).toBe(true);
  });

  it('points to the help channel by link', () => {
    expect(askChannelRedirect(HELP)).toBe("I only answer questions in <#111>. Post your question there (no @mention needed) and I'll help you in a thread.");
  });
});
