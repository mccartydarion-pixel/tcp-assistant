import type { BaseMessageOptions, Client, Message, TextBasedChannel } from 'discord.js';
import { logger } from '../utils/logger.js';

type SendableChannel = TextBasedChannel & { send: (options: BaseMessageOptions) => Promise<Message> };

/** The text channel with this ID, or null if it is missing or not one the bot can post in. */
export async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
  return channel as SendableChannel;
}

/** The bot's own panel in the channel's recent messages: the one whose components carry the marker ID. */
export async function findPanel(client: Client, channel: SendableChannel, marker: string): Promise<Message | undefined> {
  const recent = await channel.messages.fetch({ limit: 50 });
  return recent.find((message) => message.author.id === client.user?.id && JSON.stringify(message.components).includes(marker));
}

/** Posts the panel in the channel, or refreshes the bot's existing one so its wording stays current. */
export async function ensurePanel(client: Client, channelId: string, marker: string, panel: BaseMessageOptions, label: string): Promise<void> {
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
    await channel.send(panel);
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
    await channel.send(panel);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Panels] Could not move the panel to the bottom');
  }
}
