import { Events, type Client, type Message } from 'discord.js';
import type { AssistantService } from '../ai/assistantService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { ConversationTurn } from '../ai/promptBuilder.js';
import { SpecialIntentRouter } from '../ai/specialIntentRouter.js';
import { normalizeUserQuestion } from '../ai/question.js';

export function registerEvents(client: Client, assistant: AssistantService, specialIntentRouter: SpecialIntentRouter): void {
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
    const isMentioned = client.user !== null && (
      message.mentions.users.has(client.user.id) ||
      new RegExp(`<@!?${client.user.id}>`).test(message.content)
    );
    logger.info('[TCP Message] Received');
    logger.info(`[TCP Message] Author bot: ${message.author.bot}`);
    logger.info(`[TCP Message] Channel: ${message.channelId}`);
    logger.info(`[TCP Message] Mentions bot: ${isMentioned}`);
    logger.info(`[TCP Message] Content available: ${message.content.length > 0}`);
    logger.info(`[TCP Message] Logged-in bot ID: ${client.user?.id ?? '<unavailable>'}`);
    logger.info(`[TCP Message] Parsed mention IDs: ${[...message.mentions.users.keys()].join(', ') || '<none>'}`);
    logger.info(`[TCP Message] Raw mention syntax: ${/<@!?\d+>/.test(message.content)}`);

    if (message.author.bot) return;

    const isTicket = isSupportTicketChannel(message);

    if (isTicket) {
      logger.info('[TCP Ticket] Support category match: YES');
    }
    if (!isTicket && !isMentioned) return;
    logger.info(`[TCP Message] Route: ${isTicket ? 'ticket' : 'mention'}`);

    const guildId = message.guildId ?? 'dm';
    if (message.author.id === env.OWNER_USER_ID) {
      if (specialIntentRouter.isEscalated(guildId, message.channelId)) {
        specialIntentRouter.markOwnerJoined(guildId, message.channelId);
        logger.info(`[TCP Escalation] Owner joined conversation: ${message.channelId}`);
      }
      return;
    }
    if (isTicket) logger.info('[TCP Ticket] User message accepted');

    const question = normalizeUserQuestion(message.content, client.user?.id);
    logger.info(`[TCP Message] Clean question: ${question || '<empty>'}`);

    try {
      if (!question) {
        await message.reply('How can I help with T.C.P.?');
        return;
      }

      logger.info('[TCP Escalation] Checking intent');
      const escalationResult = specialIntentRouter.check(guildId, message.channelId, message.author.id, question);
      if (escalationResult) {
        if (!escalationResult.shouldNotify) {
          logger.info(`[TCP Escalation] Duplicate ping prevented: ${message.channelId}`);
          await message.reply(specialIntentRouter.ownerResponse(true));
          return;
        }

        logger.info(`[TCP Escalation] Human support requested: ${message.channelId}`);
        await message.reply(specialIntentRouter.ownerResponse(false));
        logger.info(`[TCP Escalation] Owner notified: ${message.channelId}`);
        return;
      }
      logger.info('[TCP Escalation] Intent: NONE');

      if (isTicket && specialIntentRouter.isEscalated(guildId, message.channelId) && /^hello(?:[!?. ]*)$/i.test(question)) {
        await message.reply("I'm still here. The owner has already been notified. You can leave any additional details about the issue while you're waiting.");
        return;
      }

      if (specialIntentRouter.isOwnerHandling(guildId, message.channelId) && !isMentioned) return;

      if (isTicket) logger.info('[TCP Ticket] Routing to T.C.P. Assistant');

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
      logger.error({ err: error }, '[TCP Discord ERROR] Message processing failed');
      try {
        await message.reply('T.C.P. Assistant hit an error processing that message.');
      } catch (replyError) {
        logger.error({ err: replyError }, '[TCP Discord ERROR] Missing SendMessages permission or reply failed');
      }
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

  logger.info('[TCP Events] interactionCreate loaded');
  logger.info('[TCP Events] messageCreate loaded');
  logger.info('[TCP Events] channelCreate loaded');
}

export function isSupportTicketChannel(message: Message): boolean {
  return Boolean(
    env.SUPPORT_CATEGORY_ID &&
      'parentId' in message.channel &&
      message.channel.parentId === env.SUPPORT_CATEGORY_ID,
  );
}

declare module 'discord.js' {
  interface Client {
    commands?: Map<string, unknown>;
  }
}
