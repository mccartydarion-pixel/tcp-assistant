import { describe, expect, it } from 'vitest';
import type { APIEmbed, EmbedBuilder } from 'discord.js';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const {
  DEFAULT_INFO_CHANNELS,
  INFO_KEYS,
  MAX_EMBEDS,
  MAX_MESSAGE_CHARS,
  MAX_SCAN,
  buildInfoPost,
  embedChars,
  infoChannelIds,
  infoMarker,
  infoStamp,
  syncInfoChannel,
} = await import('../src/info/infoChannels.js');
type InfoLinks = import('../src/info/infoChannels.js').InfoLinks;
type InfoMessage = import('../src/info/infoChannels.js').InfoMessage;
type InfoTarget = import('../src/info/infoChannels.js').InfoTarget;

const BOT = 'bot-1';
const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;

const linked: InfoLinks = {
  channels: { ...DEFAULT_INFO_CHANNELS },
  help: '900000000000000001',
  tickets: '900000000000000002',
  licence: '900000000000000003',
  dayz: '1559405473000591411',
  bugs: '900000000000000004',
};
const unlinked: InfoLinks = { channels: { ...DEFAULT_INFO_CHANNELS } };

/** A channel in memory: messages newest first, and a record of what the sync did to it. */
function fakeChannel(options: { canManageMessages?: boolean } = {}) {
  let next = 1;
  const messages: InfoMessage[] = [];
  const log = { bulk: [] as string[][], single: [] as string[], edits: 0, sent: 0 };
  const remove = (id: string) => {
    const index = messages.findIndex((message) => message.id === id);
    if (index >= 0) messages.splice(index, 1);
  };
  const make = (authorId: string, createdTimestamp: number, embeds: APIEmbed[]): InfoMessage => {
    const message: InfoMessage = {
      id: String(next++).padStart(6, '0'),
      authorId,
      createdTimestamp,
      embeds,
      edit: async (payload: { embeds: EmbedBuilder[] }) => {
        log.edits += 1;
        message.embeds = payload.embeds.map((embed) => embed.toJSON());
      },
      delete: async () => {
        log.single.push(message.id);
        remove(message.id);
      },
    };
    return message;
  };
  const add = (authorId: string, createdTimestamp: number, embeds: APIEmbed[] = [{ description: 'old post' }]) => {
    const message = make(authorId, createdTimestamp, embeds);
    messages.unshift(message);
    return message;
  };
  const target: InfoTarget = {
    label: 'Test (#test)',
    botId: BOT,
    canManageMessages: options.canManageMessages ?? true,
    fetchPage: async (before?: string) => {
      const start = before ? messages.findIndex((message) => message.id === before) + 1 : 0;
      return messages.slice(start, start + 100);
    },
    bulkDelete: async (ids: string[]) => {
      if (ids.length < 2 || ids.length > 100) throw new Error('bulk delete takes 2 to 100 messages');
      log.bulk.push(ids);
      ids.forEach(remove);
    },
    send: async (payload: { embeds: EmbedBuilder[] }) => {
      log.sent += 1;
      return add(BOT, now, payload.embeds.map((embed) => embed.toJSON()));
    },
  };
  return { target, messages, log, add };
}

describe('info posts', () => {
  it.each(INFO_KEYS)('%s fits in one message within Discord limits', (key) => {
    for (const links of [linked, unlinked]) {
      const embeds = buildInfoPost(key, links).embeds.map((embed) => embed.toJSON());
      expect(embeds.length).toBeGreaterThan(1);
      expect(embeds.length).toBeLessThanOrEqual(MAX_EMBEDS);
      expect(embeds.reduce((sum, embed) => sum + embedChars(embed), 0)).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      for (const embed of embeds) {
        expect((embed.title ?? '').length).toBeLessThanOrEqual(256);
        expect((embed.description ?? '').length).toBeLessThanOrEqual(4096);
        expect((embed.fields ?? []).length).toBeLessThanOrEqual(25);
        for (const field of embed.fields ?? []) {
          expect(field.name.length).toBeGreaterThan(0);
          expect(field.name.length).toBeLessThanOrEqual(256);
          expect(field.value.length).toBeLessThanOrEqual(1024);
        }
        // Built from whole strings, never cut short by tcpEmbed's limits.
        expect(embed.description ?? '').not.toMatch(/\s$/);
      }
    }
  });

  it('marks the first embed and puts the footer on the last only', () => {
    for (const key of INFO_KEYS) {
      const embeds = buildInfoPost(key, linked).embeds.map((embed) => embed.toJSON());
      expect(embeds[0].author?.name).toBe(infoMarker(key));
      expect(embeds.slice(1).every((embed) => !embed.author)).toBe(true);
      expect(embeds[embeds.length - 1].footer?.text).toBe('T.C.P Assistant');
      expect(embeds.slice(0, -1).every((embed) => !embed.footer)).toBe(true);
    }
    expect(new Set(INFO_KEYS.map(infoMarker)).size).toBe(INFO_KEYS.length);
  });

  it('links channels it knows and names the rest in words', () => {
    const text = (links: InfoLinks) => INFO_KEYS.map((key) => JSON.stringify(buildInfoPost(key, links).embeds.map((embed) => embed.toJSON()))).join('\n');
    const withLinks = text(linked);
    expect(withLinks).toContain('<#900000000000000001>');
    expect(withLinks).toContain('<#900000000000000003>');
    expect(withLinks).toContain('<#1559405473000591411>');
    const without = text(unlinked);
    expect(without).not.toContain('<#9000');
    expect(without).toContain('#ask-tcp');
    expect(without).toContain(`<#${DEFAULT_INFO_CHANNELS.rules}>`);
  });

  it('says what the knowledge doc says', () => {
    const all = INFO_KEYS.map((key) => JSON.stringify(buildInfoPost(key, unlinked).embeds.map((embed) => embed.toJSON()))).join('\n');
    expect(all).toContain('$7 a month');
    expect(all).toContain('$70 a year');
    expect(all).toMatch(/no free trial/i);
    expect(all).toContain('Elite Supporter');
    expect(all).toContain('L2 + OPTIONS');
    expect(all).toContain('Higher = your stick takes over more');
    expect(all).toContain('Bohemia Interactive');
    expect(all).toContain('case by case');
    expect(all).not.toMatch(/14-day|free trial of/i);
  });

  it('numbers the rules and ends with the consequences', () => {
    const embeds = buildInfoPost('rules', unlinked).embeds.map((embed) => embed.toJSON());
    const rules = embeds[1].description ?? '';
    const numbers = [...rules.matchAll(/^\*\*(\d+)\./gm)].map((match) => Number(match[1]));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    expect(numbers.length).toBeGreaterThanOrEqual(10);
    expect(embeds[embeds.length - 1].description).toMatch(/Warning.*Mute.*Ban/);
  });
});

describe('info channel IDs', () => {
  it('uses the owner\'s channels by default', () => {
    expect(infoChannelIds({})).toEqual({
      overview: '1541050030411096114',
      faq: '1541050074564403210',
      disclaimer: '1542448018668785705',
      rules: '1541049882947748001',
    });
  });

  it('lets each environment variable move its channel, and ignores an empty one', () => {
    const ids = infoChannelIds({ INFO_FAQ_CHANNEL_ID: '111', INFO_RULES_CHANNEL_ID: ' 222 ', INFO_DISCLAIMER_CHANNEL_ID: '', INFO_OVERVIEW_CHANNEL_ID: '444' });
    expect(ids).toEqual({ overview: '444', faq: '111', disclaimer: DEFAULT_INFO_CHANNELS.disclaimer, rules: '222' });
  });
});

describe('info stamp', () => {
  it('stays the same until the wording changes', () => {
    const embeds = buildInfoPost('faq', linked).embeds.map((embed) => embed.toJSON());
    // Discord sends embeds back with extra fields; they do not count.
    const echoed = embeds.map((embed) => ({ ...embed, type: 'rich' as const, footer: embed.footer && { ...embed.footer, proxy_icon_url: 'https://x' } }));
    expect(infoStamp(echoed)).toBe(infoStamp(embeds));
    expect(infoStamp(buildInfoPost('faq', unlinked).embeds.map((embed) => embed.toJSON()))).not.toBe(infoStamp(embeds));
  });
});

describe('syncing an info channel', () => {
  it('first run: deletes every old message, recent ones in bulk and older ones one by one, then posts', async () => {
    const channel = fakeChannel();
    const old = [channel.add('owner', now - 40 * DAY), channel.add('someone', now - 20 * DAY)];
    const recent = [channel.add('owner', now - 3 * DAY), channel.add(BOT, now - 2 * DAY), channel.add('owner', now - DAY)];
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now);
    expect(outcome).toEqual({ kind: 'posted', removed: 5, kept: 0 });
    expect(channel.log.bulk).toEqual([recent.map((message) => message.id).reverse()]);
    expect(channel.log.single.sort()).toEqual(old.map((message) => message.id).sort());
    expect(channel.log.sent).toBe(1);
    expect(channel.messages).toHaveLength(1);
    expect(channel.messages[0].embeds[0].author?.name).toBe(infoMarker('faq'));
  });

  it('first run with a long history: bulk deletes in groups of at most 100', async () => {
    const channel = fakeChannel();
    for (let index = 0; index < 250; index += 1) channel.add('owner', now - DAY + index);
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('rules', linked), now);
    expect(outcome).toMatchObject({ kind: 'posted', removed: 250 });
    expect(channel.log.bulk.map((ids) => ids.length)).toEqual([100, 100, 50]);
    expect(channel.messages).toHaveLength(1);
  });

  it('a lone recent message is deleted on its own (bulk delete needs two)', async () => {
    const channel = fakeChannel();
    channel.add('owner', now - DAY);
    await syncInfoChannel(channel.target, buildInfoPost('rules', linked), now);
    expect(channel.log.bulk).toEqual([]);
    expect(channel.log.single).toHaveLength(1);
  });

  it('without Manage Messages: deletes only its own messages one by one, keeps the rest and still posts', async () => {
    const channel = fakeChannel({ canManageMessages: false });
    const others = [channel.add('owner', now - 3 * DAY), channel.add('owner', now - 2 * DAY)];
    const own = channel.add(BOT, now - DAY);
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('overview', linked), now);
    expect(outcome).toEqual({ kind: 'posted', removed: 1, kept: 2 });
    expect(channel.log.bulk).toEqual([]);
    expect(channel.log.single).toEqual([own.id]);
    expect(channel.messages.map((message) => message.id)).toEqual(expect.arrayContaining(others.map((message) => message.id)));
    expect(channel.log.sent).toBe(1);
  });

  it('later runs: leaves an unchanged post and everything else alone', async () => {
    const channel = fakeChannel();
    await syncInfoChannel(channel.target, buildInfoPost('disclaimer', linked), now);
    const ownerPost = channel.add('owner', now + DAY);
    const before = { ...channel.log, bulk: [...channel.log.bulk], single: [...channel.log.single] };
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('disclaimer', linked), now + 2 * DAY);
    expect(outcome).toEqual({ kind: 'unchanged' });
    expect(channel.log).toEqual(before);
    expect(channel.messages.map((message) => message.id)).toContain(ownerPost.id);
  });

  it('later runs: edits the post in place when the wording changed, and deletes nothing', async () => {
    const channel = fakeChannel();
    await syncInfoChannel(channel.target, buildInfoPost('overview', unlinked), now);
    const posted = channel.messages[0];
    channel.add('owner', now + DAY);
    const deletedBefore = channel.log.single.length + channel.log.bulk.length;
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('overview', linked), now + 2 * DAY);
    expect(outcome).toEqual({ kind: 'edited' });
    expect(channel.log.edits).toBe(1);
    expect(channel.log.sent).toBe(1);
    expect(channel.log.single.length + channel.log.bulk.length).toBe(deletedBefore);
    expect(channel.messages).toHaveLength(2);
    expect(infoStamp(posted.embeds)).toBe(infoStamp(buildInfoPost('overview', linked).embeds.map((embed) => embed.toJSON())));
    // And the next startup finds nothing to do.
    expect(await syncInfoChannel(channel.target, buildInfoPost('overview', linked), now + 3 * DAY)).toEqual({ kind: 'unchanged' });
  });

  it('finds its post even when it is buried under the owner\'s later posts', async () => {
    const channel = fakeChannel();
    await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now);
    for (let index = 0; index < 150; index += 1) channel.add('owner', now + index);
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now + DAY);
    expect(outcome).toEqual({ kind: 'unchanged' });
    expect(channel.messages).toHaveLength(151);
  });

  it('does not take another channel\'s post, or someone else\'s copy, for its own', async () => {
    const channel = fakeChannel();
    const rulesPost = buildInfoPost('rules', linked).embeds.map((embed) => embed.toJSON());
    channel.add(BOT, now - DAY, rulesPost);
    channel.add('owner', now - DAY, buildInfoPost('faq', linked).embeds.map((embed) => embed.toJSON()));
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now);
    expect(outcome).toMatchObject({ kind: 'posted', removed: 2 });
  });

  it('removes a second copy of its own post', async () => {
    const channel = fakeChannel();
    const post = buildInfoPost('faq', linked).embeds.map((embed) => embed.toJSON());
    const first = channel.add(BOT, now - 2 * DAY, post);
    const second = channel.add(BOT, now - DAY, post);
    expect(await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now)).toEqual({ kind: 'unchanged' });
    expect(channel.log.single).toEqual([second.id]);
    expect(channel.messages.map((message) => message.id)).toEqual([first.id]);
  });

  it('in a channel busier than it reads, deletes and posts nothing', async () => {
    const channel = fakeChannel();
    for (let index = 0; index < MAX_SCAN + 50; index += 1) channel.add('owner', now - DAY + index);
    const outcome = await syncInfoChannel(channel.target, buildInfoPost('faq', linked), now);
    expect(outcome).toEqual({ kind: 'too-busy' });
    expect(channel.log).toEqual({ bulk: [], single: [], edits: 0, sent: 0 });
  });
});
