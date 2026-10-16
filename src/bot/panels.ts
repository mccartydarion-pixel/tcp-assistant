import type { BaseMessageOptions, Client, Message, TextBasedChannel } from 'discord.js';
import { logger } from '../utils/logger.js';

type SendableChannel = TextBasedChannel & { send: (options: BaseMessageOptions) => Promise<Message> };

/** Where each panel was last seen this run, by channel and marker, so a refresh finds it without searching. */
const knownPanels = new Map<string, string>();

/** The text channel with this ID, or null if it is missing or not one the bot can post in. */
export async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
  return channel as SendableChannel;
}

/**
 * The bot's own panel in the channel: the one whose components carry the marker ID. Looks where it was last
 * seen, then through the channel's latest messages (up to maxMessages; busy channels bury panels).
 */
export async function findPanel(client: Client, channel: SendableChannel, marker: string, maxMessages = 200): Promise<Message | undefined> {
  const isPanel = (message: Message) => message.author.id === client.user?.id && JSON.stringify(message.components).includes(marker);
  const known = knownPanels.get(`${channel.id}:${marker}`);
  if (known) {
    const message = await channel.messages.fetch(known).catch(() => null);
    if (message && isPanel(message)) return message;
    knownPanels.delete(`${channel.id}:${marker}`);
  }
  let before: string | undefined;
  for (let seen = 0; seen < maxMessages; ) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    const found = batch.find(isPanel);
    if (found) {
      knownPanels.set(`${channel.id}:${marker}`, found.id);
      return found;
    }
    if (batch.size < 100) return undefined;
    seen += batch.size;
    before = batch.last()!.id;
  }
  return undefined;
}

/**
 * Posts the panel in the channel, or refreshes the bot's existing one so its wording stays current. With
 * postIfMissing false it only ever edits, for refreshes that must never add a second panel.
 */
export async function ensurePanel(
  client: Client,
  channelId: string,
  marker: string,
  panel: BaseMessageOptions,
  label: string,
  options: { postIfMissing?: boolean } = {},
): Promise<void> {
  try {
    const channel = await fetchSendableChannel(client, channelId);
    if (!channel) {
      logger.error(`[TCP Panels ERROR] The ${label} channel is not a text channel.`);
      return;
    }
    const existing = await findPanel(client, channel, marker);
    if (existing) {
      await existing.edit(panel);
      logger.info(`[TCP Panels] ${label} panel already posted; refreshed.`);
      return;
    }
    if (options.postIfMissing === false) {
      logger.info(`[TCP Panels] ${label} panel not found; left for the next startup to post.`);
      return;
    }
    const posted = await channel.send(panel);
    knownPanels.set(`${channel.id}:${marker}`, posted.id);
    logger.info(`[TCP Panels] ${label} panel posted.`);
  } catch (error) {
    logger.error({ err: error }, `[TCP Panels ERROR] Could not post the ${label} panel`);
  }
}

/** Moves the bot's panel to the bottom of the channel, so it stays visible under new posts. */
export async function repostPanel(client: Client, channel: SendableChannel, marker: string, panel: BaseMessageOptions): Promise<void> {
  try {
    const existing = await findPanel(client, channel, marker);
    if (existing) await existing.delete();
    const posted = await channel.send(panel);
    knownPanels.set(`${channel.id}:${marker}`, posted.id);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Panels] Could not move the panel to the bottom');
  }
}
