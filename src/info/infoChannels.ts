import { createHash } from 'node:crypto';
import { PermissionFlagsBits, type APIEmbed, type Client, type EmbedBuilder, type Message } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getBrandIcon, tcpEmbed, type EmbedOptions } from '../bot/embeds.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { GAME_SCRIPTS } from '../games/gameScripts.js';
import { INFO_CONTENT } from './infoContent.js';

// The server's four info channels (Overview, FAQ, Disclaimer, Rules) each show one post by the bot: a single
// message with several embeds. The post is known by the bot being its author and the first embed's author
// line (e.g. "T.C.P · FAQ"), so it needs no buttons.
// First run in a channel (no such post yet): every other message there is deleted, then the post goes up.
// After that, startups only edit the post in place when its wording changed, and leave everything else alone,
// so the owner can still post there. If the bot's post is deleted by hand, the next startup counts as a
// first run again and clears the channel.

export type InfoKey = 'overview' | 'faq' | 'disclaimer' | 'rules';
export const INFO_KEYS: InfoKey[] = ['overview', 'faq', 'disclaimer', 'rules'];

/** The owner's channels; each can be moved with its environment variable. */
export const DEFAULT_INFO_CHANNELS: Record<InfoKey, string> = {
  overview: '1541050030411096114',
  faq: '1541050074564403210',
  disclaimer: '1542448018668785705',
  rules: '1541049882947748001',
};

const ENV_NAMES: Record<InfoKey, 'OVERVIEW_CHANNEL_ID' | 'FAQ_CHANNEL_ID' | 'DISCLAIMER_CHANNEL_ID' | 'RULES_CHANNEL_ID'> = {
  overview: 'OVERVIEW_CHANNEL_ID',
  faq: 'FAQ_CHANNEL_ID',
  disclaimer: 'DISCLAIMER_CHANNEL_ID',
  rules: 'RULES_CHANNEL_ID',
};

export const INFO_LABELS: Record<InfoKey, string> = { overview: 'Overview', faq: 'FAQ', disclaimer: 'Disclaimer', rules: 'Rules' };

/** Discord's limits for one message: 10 embeds, 6000 characters across them. */
export const MAX_EMBEDS = 10;
export const MAX_MESSAGE_CHARS = 6000;
/** How far back a channel is read. Past this the bot neither clears nor posts, so it can never bury or wipe a busy channel. */
export const MAX_SCAN = 1000;
const BULK_DELETE_MAX_AGE = 14 * 24 * 60 * 60 * 1000 - 60_000;

/** Each info channel's ID: its environment variable when set, otherwise the default. */
export function infoChannelIds(source: Partial<Record<(typeof ENV_NAMES)[InfoKey], string>> = env): Record<InfoKey, string> {
  const ids = {} as Record<InfoKey, string>;
  for (const key of INFO_KEYS) ids[key] = source[ENV_NAMES[key]]?.trim() || DEFAULT_INFO_CHANNELS[key];
  return ids;
}

/** Where the posts send people. Unset channels are named in plain words instead of linked. */
export interface InfoLinks {
  channels: Record<InfoKey, string>;
  help?: string;
  tickets?: string;
  licence?: string;
  dayz?: string;
  bugs?: string;
}

export function infoLinks(): InfoLinks {
  return {
    channels: infoChannelIds(),
    help: env.HELP_CHANNEL_ID || undefined,
    // The ticket panel sits in the help channel unless it has its own.
    tickets: env.TICKET_PANEL_CHANNEL_ID || env.HELP_CHANNEL_ID || undefined,
    licence: env.LICENSE_CHANNEL_ID || undefined,
    dayz: GAME_SCRIPTS.find((game) => game.key === 'dayz')?.channelId,
    bugs: env.BUG_REPORT_CHANNEL_ID || undefined,
  };
}

/** One embed of a post. The footer goes on the last one only, the marker on the first. */
export type InfoSection = Pick<EmbedOptions, 'title' | 'description' | 'fields' | 'tone'>;

export interface InfoPost {
  key: InfoKey;
  /** The first embed's author line, which marks the post as the bot's. */
  marker: string;
  embeds: EmbedBuilder[];
}

export function infoMarker(key: InfoKey): string {
  return `T.C.P · ${INFO_LABELS[key]}`;
}

export function buildInfoPost(key: InfoKey, links: InfoLinks = infoLinks()): InfoPost {
  const sections = INFO_CONTENT[key](links);
  const marker = infoMarker(key);
  const icon = getBrandIcon();
  const embeds = sections.map((section, index) => {
    const embed = tcpEmbed(section);
    if (index === 0) {
      embed.setAuthor(icon ? { name: marker, iconURL: icon } : { name: marker });
    }
    if (index !== sections.length - 1) embed.setFooter(null);
    return embed;
  });
  return { key, marker, embeds };
}

/** Characters Discord counts toward a message's 6000. */
export function embedChars(embed: APIEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

/** A fingerprint of what the embeds show, the same for the bot's own builders and the copy Discord sends back. */
export function infoStamp(embeds: APIEmbed[]): string {
  const text = (value: string | undefined | null) => (value ?? '').trim();
  const shown = embeds.map((embed) => ({
    title: text(embed.title),
    description: text(embed.description),
    color: embed.color ?? null,
    author: text(embed.author?.name),
    footer: text(embed.footer?.text),
    thumbnail: text(embed.thumbnail?.url),
    fields: (embed.fields ?? []).map((field) => ({ name: text(field.name), value: text(field.value), inline: Boolean(field.inline) })),
  }));
  return createHash('sha1').update(JSON.stringify(shown)).digest('hex').slice(0, 12);
}

// ---- syncing one channel ---------------------------------------------------------------------------------

/** What the sync needs from a message; a thin view of discord.js's Message so tests can stand in for it. */
export interface InfoMessage {
  id: string;
  authorId: string;
  createdTimestamp: number;
  embeds: APIEmbed[];
  edit(payload: { embeds: EmbedBuilder[] }): Promise<unknown>;
  delete(): Promise<unknown>;
}

/** What the sync needs from a channel. */
export interface InfoTarget {
  label: string;
  botId: string;
  canManageMessages: boolean;
  /** Up to 100 messages, newest first, older than `before` when given. */
  fetchPage(before?: string): Promise<InfoMessage[]>;
  /** Deletes 2 to 100 messages under 14 days old in one request. */
  bulkDelete(ids: string[]): Promise<unknown>;
  send(payload: { embeds: EmbedBuilder[] }): Promise<InfoMessage>;
}

export type InfoOutcome =
  | { kind: 'posted'; removed: number; kept: number }
  | { kind: 'edited' }
  | { kind: 'unchanged' }
  | { kind: 'too-busy' };

export function isInfoPost(message: InfoMessage, botId: string, marker: string): boolean {
  return message.authorId === botId && message.embeds[0]?.author?.name === marker;
}

async function readChannel(target: InfoTarget): Promise<{ messages: InfoMessage[]; complete: boolean }> {
  const messages: InfoMessage[] = [];
  let before: string | undefined;
  while (messages.length < MAX_SCAN) {
    const page = await target.fetchPage(before);
    messages.push(...page);
    if (page.length < 100) return { messages, complete: true };
    before = page[page.length - 1].id;
  }
  return { messages, complete: false };
}

/** Deletes what it may: everything with Manage Messages, otherwise only the bot's own messages. */
async function clearChannel(target: InfoTarget, messages: InfoMessage[], now: number): Promise<{ removed: number; kept: number }> {
  const deletable = target.canManageMessages ? messages : messages.filter((message) => message.authorId === target.botId);
  // Bulk delete needs Manage Messages even for the bot's own messages, and only takes messages under 14 days.
  const bulk = (message: InfoMessage) => target.canManageMessages && now - message.createdTimestamp < BULK_DELETE_MAX_AGE;
  const recent = deletable.filter(bulk);
  const old = deletable.filter((message) => !bulk(message));
  let removed = 0;
  for (let start = 0; start < recent.length; start += 100) {
    const group = recent.slice(start, start + 100);
    if (group.length === 1) old.push(group[0]);
    else {
      try {
        await target.bulkDelete(group.map((message) => message.id));
        removed += group.length;
      } catch (error) {
        logger.warn({ err: error }, `[TCP Info] ${target.label}: bulk delete failed; deleting one by one.`);
        old.push(...group);
      }
    }
  }
  for (const message of old) {
    try {
      await message.delete();
      removed += 1;
    } catch (error) {
      logger.warn({ err: error }, `[TCP Info] ${target.label}: could not delete message ${message.id}.`);
    }
  }
  return { removed, kept: messages.length - removed };
}

/** Brings one info channel up to date. See the comment at the top for the rules. */
export async function syncInfoChannel(target: InfoTarget, post: InfoPost, now = Date.now()): Promise<InfoOutcome> {
  const { messages, complete } = await readChannel(target);
  const ours = messages.filter((message) => isInfoPost(message, target.botId, post.marker));

  if (ours.length > 0) {
    // The oldest copy stays; any later copy of the bot's own post (two startups at once) goes.
    const [keep, ...extra] = [...ours].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const message of extra) await message.delete().catch(() => undefined);
    const wanted = post.embeds.map((embed) => embed.toJSON());
    if (infoStamp(keep.embeds) === infoStamp(wanted)) return { kind: 'unchanged' };
    await keep.edit({ embeds: post.embeds });
    return { kind: 'edited' };
  }

  if (!complete) return { kind: 'too-busy' };
  const { removed, kept } = await clearChannel(target, messages, now);
  await target.send({ embeds: post.embeds });
  return { kind: 'posted', removed, kept };
}

// ---- startup ---------------------------------------------------------------------------------------------

function toInfoMessage(message: Message): InfoMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    createdTimestamp: message.createdTimestamp,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    edit: (payload) => message.edit(payload),
    delete: () => message.delete(),
  };
}

/** Puts the bot's post in each of the four info channels, or refreshes it. */
export async function ensureInfoChannels(client: Client): Promise<void> {
  const ids = infoChannelIds();
  const links = infoLinks();
  for (const key of INFO_KEYS) {
    const label = INFO_LABELS[key];
    try {
      const channel = await fetchSendableChannel(client, ids[key]).catch(() => null);
      const botId = client.user?.id;
      if (!channel || !botId || channel.isDMBased() || !('bulkDelete' in channel)) {
        logger.error(`[TCP Info ERROR] ${label}: channel ${ids[key]} is not a server text channel the bot can see.`);
        continue;
      }
      const name = `${label} (#${channel.name})`;
      const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
      const permissions = channel.permissionsFor(me);
      const missing = (['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks'] as const).filter(
        (permission) => !permissions?.has(PermissionFlagsBits[permission]),
      );
      if (missing.length > 0) {
        // Without the history the bot cannot find its own post, and would post a new one at every startup.
        logger.error(`[TCP Info ERROR] ${name}: give the bot ${missing.join(', ')} there. Left as it is.`);
        continue;
      }
      const canManageMessages = Boolean(permissions?.has(PermissionFlagsBits.ManageMessages));
      const target: InfoTarget = {
        label: name,
        botId,
        canManageMessages,
        fetchPage: async (before) => [...(await channel.messages.fetch({ limit: 100, before })).values()].map(toInfoMessage),
        bulkDelete: (messageIds) => channel.bulkDelete(messageIds),
        send: async (payload) => toInfoMessage(await channel.send(payload)),
      };
      const outcome = await syncInfoChannel(target, buildInfoPost(key, links));
      switch (outcome.kind) {
        case 'unchanged':
          logger.info(`[TCP Info] ${name}: post is up to date.`);
          break;
        case 'edited':
          logger.info(`[TCP Info] ${name}: wording changed; post edited in place.`);
          break;
        case 'too-busy':
          logger.warn(
            `[TCP Info] ${name}: no T.C.P post in the last ${MAX_SCAN} messages, so nothing was deleted or posted. Clear the channel by hand and restart to post it.`,
          );
          break;
        case 'posted':
          logger.info(`[TCP Info] ${name}: first post. Deleted ${outcome.removed} old message(s), then posted.`);
          if (outcome.kept > 0) {
            logger.warn(
              canManageMessages
                ? `[TCP Info] ${name}: ${outcome.kept} old message(s) could not be deleted; remove them by hand.`
                : `[TCP Info] ${name}: the bot lacks Manage Messages there, so ${outcome.kept} old message(s) by others were left. Delete them by hand (the bot will not try again now that its post is up).`,
            );
          }
          break;
      }
    } catch (error) {
      logger.error({ err: error }, `[TCP Info ERROR] ${label}: could not update the channel`);
    }
  }
}
