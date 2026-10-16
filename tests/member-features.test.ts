import { describe, expect, it } from 'vitest';
import { describeMemberLicence } from '../src/license/memberLicence.js';
import { extractUnansweredMarker, questionKey, shouldLog, UNANSWERED_MARKER } from '../src/ai/unansweredMarker.js';
import { buildTCPPrompt } from '../src/ai/promptBuilder.js';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { reminderDue, reminderText } = await import('../src/license/reminders.js');
const { readBugForm, buildBugCard, withStatus, reporterOf, cooldownMinutesLeft } = await import('../src/bugs/bugReports.js');
const { availableGuides, welcomeGuide, wantsMemberEvents, isMemberEventsActive, setMemberEventsActive } = await import('../src/welcome/welcome.js');

const DAY = 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;

describe('my licence', () => {
  const base = { hadTrial: false, onTrial: false, codesToday: 0, maxPerDay: 3, latest: null, now, isOwner: false };

  it('tells a new member codes are for Elite Supporters, and how to join', () => {
    const result = describeMemberLicence({ ...base, expiresAt: null, joinHint: 'Press **Subscribe** on the licence panel to join.' });
    expect(result.title).toBe('No subscription yet');
    expect(result.lines[0]).toBe('Codes are for **Elite Supporters**. Press **Subscribe** on the licence panel to join.');
    expect(result.lines.join('\n')).not.toMatch(/trial/i);
    expect(result.active).toBe(false);
    expect(describeMemberLicence({ ...base, expiresAt: null }).lines[0]).toContain('Open a support ticket to join.');
  });

  it('shows days left, the power-ups a code would get, and codes used', () => {
    const result = describeMemberLicence({
      ...base,
      expiresAt: now + 10 * DAY,
      hadTrial: true,
      onTrial: true,
      codesToday: 1,
      latest: { discordUserId: 'u', challenge: 48213, tier: 2, createdAt: now - DAY },
    });
    expect(result.title).toBe('Free trial');
    expect(result.lines.join('\n')).toContain('**10 days** left');
    expect(result.lines.join('\n')).toContain('**50 power-ups**');
    expect(result.lines.join('\n')).toContain('**1 of 3**');
    expect(result.lines.join('\n')).toContain('`48213`');
  });

  it('says when access has ended and how to renew', () => {
    const result = describeMemberLicence({ ...base, expiresAt: now - DAY, hadTrial: true });
    expect(result.title).toBe('Subscription ended');
    expect(result.lines).toContain('Your free trial has been used.');
    expect(result.active).toBe(false);
  });

  it('has no limits for the owner', () => {
    expect(describeMemberLicence({ ...base, expiresAt: null, isOwner: true }).title).toBe('Owner');
  });
});

describe('expiry reminders', () => {
  it('reminds three days out, and again in the last day', () => {
    expect(reminderDue(now + 5 * DAY, now)).toBeNull();
    expect(reminderDue(now + 3 * DAY, now)).toBe('soon');
    expect(reminderDue(now + 2 * DAY, now)).toBe('soon');
    expect(reminderDue(now + DAY, now)).toBe('final');
    expect(reminderDue(now + 1, now)).toBe('final');
    expect(reminderDue(now, now)).toBeNull();
    expect(reminderDue(now - DAY, now)).toBeNull();
  });

  it('words trials and subscriptions differently', () => {
    expect(reminderText('soon', 3, true).title).toBe('Your T.C.P free trial ends in 3 days');
    expect(reminderText('final', 1, false).title).toBe('Your T.C.P subscription ends today');
    expect(reminderText('soon', 2, false, 'https://discord.com/channels/1/2').description).toContain('https://discord.com/channels/1/2');
  });
});

describe('bug reports', () => {
  const form = { summary: ' Recoil stops ', happened: 'It stopped', expected: 'Keep pulling', steps: '1. Fire', version: '' };

  it('needs a summary, what happened, what was expected and the steps', () => {
    expect(readBugForm(form)).toEqual({ summary: 'Recoil stops', happened: 'It stopped', expected: 'Keep pulling', steps: '1. Fire', version: '' });
    expect('error' in readBugForm({ ...form, summary: '' })).toBe(true);
    expect('error' in readBugForm({ ...form, happened: ' ' })).toBe(true);
    expect('error' in readBugForm({ ...form, expected: '' })).toBe(true);
    expect('error' in readBugForm({ ...form, steps: '' })).toBe(true);
  });

  it('limits each member to one report every five minutes', () => {
    expect(cooldownMinutesLeft(undefined, now)).toBe(0);
    expect(cooldownMinutesLeft(now - 60_000, now)).toBe(4);
  });

  it('changes only the status and colour, and keeps track of the reporter', () => {
    const draft = { area: 'Anti-Recoil', build: 'Licensed (Discord)', summary: 'Recoil stops', happened: 'a', expected: 'b', steps: 'c', version: 'v2.0', createdAt: now };
    const card = buildBugCard(draft, '123456789', { name: 'Player' }).toJSON();
    expect(card.title).toBe('Bug: Recoil stops');
    expect(card.description).toBe('**Anti-Recoil**  ·  **Licensed (Discord)**');
    expect(card.fields?.find((field) => field.name === 'Status')?.value).toBe('Open');
    expect(reporterOf(card)).toBe('123456789');

    const fixed = withStatus(card, 'fixed').toJSON();
    expect(fixed.fields?.find((field) => field.name === 'Status')?.value).toBe('Fixed');
    expect(fixed.color).toBe(0x2b8a3e);
    expect(fixed.fields?.find((field) => field.name === 'Version and settings')?.value).toBe('v2.0');
  });
});

describe('welcome guide', () => {
  it('offers only the guides whose channels are set, and always Help', () => {
    expect(availableGuides({})).toEqual(['help']);
    expect(availableGuides({ licence: '1', download: '2', settings: '3', rules: '4' })).toEqual(['licence', 'download', 'settings', 'help', 'rules']);
  });

  it('only asks Discord for the Server Members Intent when there is a welcome channel', () => {
    // No WELCOME_CHANNEL_ID in the test environment, so no privileged intent is requested.
    expect(wantsMemberEvents()).toBe(false);
  });

  it('records which way new members are being noticed', () => {
    expect(isMemberEventsActive()).toBe(false);
    setMemberEventsActive(true);
    expect(isMemberEventsActive()).toBe(true);
    setMemberEventsActive(false);
  });

  it('links the right channels in each guide', () => {
    expect(welcomeGuide('licence', { licence: '111' })).toContain('<#111>');
    expect(welcomeGuide('licence', { licence: '111' })).toContain('Codes are for **Elite Supporters**');
    expect(welcomeGuide('licence', { licence: '111' })).not.toMatch(/trial/i);
    expect(welcomeGuide('help', { bugs: '222' })).toContain('<#222>');
    expect(welcomeGuide('help', {})).not.toContain('Report it');
  });
});

describe('unanswered questions', () => {
  it('strips the marker from the reply and reports it was there', () => {
    expect(extractUnansweredMarker(`I am not sure.\n${UNANSWERED_MARKER}`)).toEqual({ text: 'I am not sure.', flagged: true });
    expect(extractUnansweredMarker('Raise Vertical by 1.')).toEqual({ text: 'Raise Vertical by 1.', flagged: false });
  });

  it('logs the same question once a day at most, ignoring case and punctuation', () => {
    const seen = new Map<string, number>();
    expect(questionKey('Does it work on XBOX??')).toBe('does it work on xbox');
    expect(shouldLog('Does it work on Xbox?', now, seen)).toBe(true);
    expect(shouldLog('does it work on xbox', now + 1000, seen)).toBe(false);
    expect(shouldLog('does it work on xbox', now + DAY + 1, seen)).toBe(true);
  });

  it('tells the model when to use the marker', () => {
    const prompt = buildTCPPrompt({ question: 'q', retrievedChunks: [], details: {} });
    expect(prompt.system).toContain(UNANSWERED_MARKER);
  });
});
