import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  describeServerForAssistant,
  groupByCategory,
  serverGuideFields,
  serverGuideFieldsWithin,
  sortChannels,
  type MapChannel,
} from '../src/server/serverMap.js';
import { buildTCPPrompt, SERVER_MAP_INSTRUCTION } from '../src/ai/promptBuilder.js';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { setupChecklist, greetingMessage, welcomeGuide, isSafeSelfRole } = await import('../src/welcome/welcome.js');
const { helpThreadName, isAnswerable, isHelpMessage } = await import('../src/help/helpChannel.js');

function channel(id: string, name: string, category: string | null, order: [number, number], extra: Partial<MapChannel> = {}): MapChannel {
  return { id, name, kind: 'text', topic: null, category, order, ...extra };
}

const channels: MapChannel[] = [
  channel('30', 'ask-tcp', 'SUPPORT', [2, 0], { topic: 'Ask the assistant anything about T.C.P' }),
  channel('10', 'rules', 'INFO', [1, 0], { topic: 'Read these first' }),
  channel('31', 'Support voice', 'SUPPORT', [2, 10_000], { kind: 'voice' }),
  channel('11', 'announcements', 'INFO', [1, 1], { kind: 'announcement' }),
  channel('1', 'welcome', null, [-1, 0]),
];

describe('server map', () => {
  it('keeps the server order: uncategorised first, then categories, text before voice', () => {
    expect(sortChannels(channels).map((c) => c.name)).toEqual(['welcome', 'rules', 'announcements', 'ask-tcp', 'Support voice']);
    expect(groupByCategory(channels).map((group) => group.category)).toEqual([null, 'INFO', 'SUPPORT']);
  });

  it('gives the AI each channel as a link it can copy, with its topic', () => {
    const map = describeServerForAssistant(channels);
    expect(map).toContain('SERVER CHANNELS');
    expect(map).toContain('INFO\n- <#10> (#rules): Read these first\n- <#11> (#announcements, announcements)');
    expect(map).toContain('- <#31> (#Support voice, voice)');
  });

  it('drops topics, then channels, to stay within the limit', () => {
    const many = Array.from({ length: 200 }, (_, index) => channel(String(index + 100), `channel-${index}`, 'BIG', [0, index], { topic: 'x'.repeat(100) }));
    const map = describeServerForAssistant(many, 3000);
    expect(map.length).toBeLessThan(3200);
    expect(map).not.toContain('xxxx');
    expect(map).toContain('(more channels not listed)');
    expect(describeServerForAssistant([])).toContain('None available.');
  });

  it('builds one Server guide field per category, never past Discord limits', () => {
    const fields = serverGuideFields(channels);
    expect(fields.map((field) => field.name)).toEqual(['General', 'INFO', 'SUPPORT']);
    expect(fields[2]!.value).toBe('<#30> · Ask the assistant anything about T.C.P\n<#31> · voice');

    const crowded = Array.from({ length: 80 }, (_, index) => channel(String(1000 + index), `c${index}`, 'CROWDED', [0, index], { topic: 'a long topic '.repeat(10) }));
    const [field] = serverGuideFields(crowded);
    expect(field!.value.length).toBeLessThanOrEqual(1024);
    expect(field!.value).toMatch(/…and \d+ more$/);

    const wide = Array.from({ length: 25 }, (_, category) =>
      Array.from({ length: 10 }, (_, index) => channel(`${category}-${index}`, `c${index}`, `CAT ${category}`, [category, index], { topic: 'topic '.repeat(20) })),
    ).flat();
    const total = serverGuideFieldsWithin(wide).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(4500);

    // Even the shortest notes do not fit: whole categories are left out rather than breaking the panel.
    const huge = Array.from({ length: 25 }, (_, category) =>
      Array.from({ length: 30 }, (_, index) => channel(`h${category}-${index}`, `c${index}`, `${'Long category name '.repeat(5)}${category}`, [category, index])),
    ).flat();
    const kept = serverGuideFieldsWithin(huge);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(25);
    expect(kept.reduce((sum, f) => sum + f.name.length + f.value.length, 0)).toBeLessThanOrEqual(4500);
  });

  it('tells the AI to link only listed channels, and only when there is a map', () => {
    const base = { question: 'where do I download it', retrievedChunks: [], details: {} };
    const withMap = buildTCPPrompt({ ...base, serverMap: describeServerForAssistant(channels) });
    expect(withMap.system).toContain(SERVER_MAP_INSTRUCTION);
    expect(withMap.context).toContain('<#30>');
    const without = buildTCPPrompt(base);
    expect(without.system).not.toContain('SERVER CHANNELS lists');
    expect(without.context).not.toContain('SERVER CHANNELS');
  });
});

describe('get started', () => {
  const channelsSet = { licence: '20', games: [{ game: 'DayZ', channelId: '40' }], settings: '50', rules: '10', help: '30' };

  it('walks a new player through download, Zen Studio, the licence and the menu, with their button names', () => {
    const playstation = setupChecklist({ platform: 'playstation', hasScript: false, channels: channelsSet, tickets: true, roleGiven: 'PlayStation' });
    expect(playstation.title).toBe('Your T.C.P setup');
    const text = playstation.lines.join('\n');
    expect(text).toContain('You now have the **PlayStation** role.');
    expect(text).toContain('`1` Download it from <#40>.');
    expect(text).toContain('press **X** to see your number, then get your code in <#20>. Codes are for **Elite Supporters**: press **Subscribe** there to join.');
    expect(text).not.toMatch(/trial|free\./i);
    expect(text).toContain('**L2** + **OPTIONS**');
    expect(text).toContain('Ask anything in <#30>');
    expect(text).toContain('Open a ticket');

    const xbox = setupChecklist({ platform: 'xbox', hasScript: false, channels: channelsSet, tickets: false }).lines.join('\n');
    expect(xbox).toContain('press **A**');
    expect(xbox).toContain('**LT** + **Menu**');
    expect(xbox).not.toContain('Open a ticket');
    expect(xbox).not.toContain('role.');
  });

  it('skips the install steps for a player who already has the script', () => {
    const ready = setupChecklist({ platform: 'xbox', hasScript: true, channels: channelsSet, tickets: true });
    expect(ready.title).toBe('Your T.C.P checklist');
    expect(ready.lines.join('\n')).not.toContain('Zen Studio');
    expect(ready.lines.join('\n')).toContain('Press **Generate** in <#20>');
  });

  it('greets a newcomer with a ping outside the card, their member number and a Get started button', () => {
    const message = greetingMessage({ id: '77', bot: false, displayName: 'Ana', avatarURL: 'https://cdn.example/a.png', memberCount: 128 }, 'g1', '10');
    expect(message.content).toBe('<@77>');
    expect(message.allowedMentions).toEqual({ users: ['77'] });
    const card = message.embeds[0]!.toJSON();
    expect(card.title).toBe('Welcome to T.C.P, Ana!');
    expect(card.description?.startsWith("You're member **#128**.")).toBe(true);
    expect(card.thumbnail?.url).toBe('https://cdn.example/a.png');
    const buttons = message.components[0]!.toJSON().components as { label?: string; url?: string }[];
    expect(buttons.map((button) => button.label)).toEqual(['Get started', 'Rules']);
    expect(buttons[1]!.url).toBe('https://discord.com/channels/g1/10');

    const noCount = greetingMessage({ id: '78', bot: false, displayName: 'Bo', avatarURL: 'https://cdn.example/b.png' }, 'g1').embeds[0]!.toJSON();
    expect(noCount.description?.startsWith('T.C.P is')).toBe(true);
  });

  it('never hands out a role with moderator powers, or a bot or integration role', () => {
    const role = (managed: boolean, ...flags: bigint[]) => ({ managed, permissions: new PermissionsBitField(flags) });
    expect(isSafeSelfRole(role(false))).toBe(true);
    expect(isSafeSelfRole(role(false, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages))).toBe(true);
    expect(isSafeSelfRole(role(false, PermissionFlagsBits.Administrator))).toBe(false);
    expect(isSafeSelfRole(role(false, PermissionFlagsBits.ManageMessages))).toBe(false);
    expect(isSafeSelfRole(role(false, PermissionFlagsBits.MentionEveryone))).toBe(false);
    expect(isSafeSelfRole(role(true))).toBe(false);
  });

  it('points the help guide at the help channel when there is one', () => {
    expect(welcomeGuide('help', { help: '30' }, 14)).toContain('Ask anything in <#30>, no @mention needed');
    expect(welcomeGuide('help', {}, 14)).toContain('Mention **@T.C.P. Assistant**');
  });
});

describe('help channel', () => {
  it('names a thread after the question', () => {
    expect(helpThreadName('My M4 keeps climbing\nmore details', 'Ana')).toBe('My M4 keeps climbing');
    expect(helpThreadName('  ', 'Ana')).toBe('Help for Ana');
    const long = helpThreadName('a'.repeat(200), 'Ana');
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith('…')).toBe(true);
  });

  it('only answers messages with some words in them', () => {
    expect(isAnswerable('why does my aim drift')).toBe(true);
    expect(isAnswerable('ok')).toBe(false);
    expect(isAnswerable('<:pepe:123456> !!')).toBe(false);
    expect(isAnswerable('ADS')).toBe(true);
  });

  it('is off without a help channel', () => {
    // No HELP_CHANNEL_ID in the test environment.
    expect(isHelpMessage({ channelId: '30', channel: { isThread: () => false } } as never)).toBe(false);
  });
});
