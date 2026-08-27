import { Events, type Client, type Message } from 'discord.js';
import type { AssistantService } from '../ai/assistantService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ConversationTurn } from '../ai/promptBuilder.js';

export function registerEvents(client: Client, assistant: AssistantService): void {
  const conversations = new Map<string, ConversationTurn[]>();

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands?.get(interaction.commandName) as { execute: (value: typeof interaction) => Promise<void> } | undefined;
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error({ err: error }, '[TCP Discord ERROR] Command execution failed');
      const response = { content: 'Something went wrong while handling that command.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(response);
      else await interaction.reply(response);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.trim()) return;
    if (!isRelevantMessage(message)) return;

    const question = message.content
      .replace(new RegExp(`<@!?${client.user?.id ?? '0'}>`, 'g'), '')
      .trim();
    if (!question) return;

    try {
      logger.info('[TCP AI] Request started');
      const history = conversations.get(message.channelId) ?? [];
      const answer = await assistant.answer(question, history, client.user?.id);
      const turns: ConversationTurn[] = [
        ...history,
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
      ];
      conversations.set(message.channelId, turns.slice(-8));
      await message.reply(answer);
    } catch (error) {
      logger.error({ err: error }, '[TCP Discord ERROR] Message response failed');
      await message.reply('I could not process that request right now. Please try again or open a support ticket.');
    }
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!('parentId' in channel) || channel.parentId !== env.SUPPORT_CATEGORY_ID || !channel.isTextBased()) return;
    logger.info(`[TCP Ticket] New support channel detected: ${channel.id}`);
    try {
      await channel.send("**T.C.P. Support Assistant**\n\nI'll help troubleshoot your issue before owner review.\n\nPlease describe the problem you're having.");
    } catch (error) {
      logger.error({ err: error }, '[TCP Ticket ERROR] Welcome message failed');
    }
  });

  logger.info('[TCP Discord] interactionCreate: LOADED');
  logger.info('[TCP Discord] messageCreate: LOADED');
  logger.info('[TCP Discord] channelCreate: LOADED');
}

function isRelevantMessage(message: Message): boolean {
  const mentioned = Boolean(message.client.user && message.mentions.has(message.client.user));
  const inSupportChannel = Boolean(env.SUPPORT_CATEGORY_ID && 'parentId' in message.channel && message.channel.parentId === env.SUPPORT_CATEGORY_ID);
  const configuredChannel = [
    env.FAQ_CHANNEL_ID,
    env.BUG_REPORT_CHANNEL_ID,
    env.DOWNLOAD_CHANNEL_ID,
  ].includes(message.channelId);
  return mentioned || inSupportChannel || configuredChannel;
}

declare module 'discord.js' {
  interface Client {
    commands?: Map<string, unknown>;
  }
}
