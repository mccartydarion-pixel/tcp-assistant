import { Events, MessageType, type Client, type Message } from 'discord.js';
import type { AssistantService } from '../ai/assistantService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { SpecialIntentRouter } from '../ai/specialIntentRouter.js';
import { normalizeUserQuestion } from '../ai/question.js';
import { detectBotMention } from './mention.js';
import { determineMessageRoute, shouldAnswerOwner } from './messageRoute.js';
import { ConversationMemory } from '../ai/conversationMemory.js';
import { extractQuestionDetails } from '../ai/question.js';
import { handleLicenseInteraction } from '../license/licensePanel.js';
import { handleAnnounceInteraction } from '../owner/announcer.js';
import { handleSettingsInteraction } from '../settings/settingsPanel.js';
import { handleBugInteraction } from '../bugs/bugReports.js';
import { greetFromJoinMessage, greetMember, handleWelcomeInteraction, isMemberEventsActive } from '../welcome/welcome.js';
import { reportUnanswered } from '../ai/unanswered.js';

export function registerEvents(
  client: Client,
  assistant: AssistantService,
  specialIntentRouter: SpecialIntentRouter,
  memory: ConversationMemory,
): void {

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) {
      try {
        // Each panel claims only the components whose IDs carry its own prefix.
        (await handleLicenseInteraction(interaction)) ||
          (await handleAnnounceInteraction(interaction)) ||
          (await handleSettingsInteraction(interaction)) ||
          (await handleBugInteraction(interaction)) ||
          (await handleWelcomeInteraction(interaction));
      } catch (error) {
        logger.error({ err: error }, '[TCP Panels ERROR] Interaction failed');
        const response = { content: 'Something went wrong. Please try again.', ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.followUp(response);
        else await interaction.reply(response);
      }
      return;
    }
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
    const botId = client.user?.id;
    const mentionedIds = [...message.mentions.users.keys()];
    const isMentioned = detectBotMention(message, botId);
    logger.info('[TCP Message] Received');
    logger.info(`[TCP Message] Author bot: ${message.author.bot}`);
    logger.info(`[TCP Message] Channel: ${message.channelId}`);
    logger.info(`[TCP Message] Bot ID: ${botId ?? '<unavailable>'}`);
    logger.info(`[TCP Message] Mentioned IDs: ${mentionedIds.join(', ') || '<none>'}`);
    logger.info(`[TCP Message] Raw content: ${message.content}`);
    logger.info(`[TCP Message] Mentions bot: ${isMentioned}`);
    logger.info(`[TCP Message] Content available: ${message.content.length > 0}`);
    logger.info(`[TCP Message] Raw mention syntax: ${/<@!?\d+>/.test(message.content)}`);

    if (message.author.bot) return;

    // Discord's own "joined the server" message: greet the new member (its author) unless the Server
    // Members Intent already did, and stop there.
    if (message.type === MessageType.UserJoin) {
      await greetFromJoinMessage(message);
      return;
    }

    const isTicket = isSupportTicketChannel(message);

    logger.info(`[TCP Message] Support category match: ${isTicket ? 'YES' : 'NO'}`);
    const guildId = message.guildId ?? 'dm';
    const activeSession = memory.hasActive(guildId, message.channelId, message.author.id, isTicket);
    logger.info(`[TCP Session] Key: ${memory.key(guildId, message.channelId, message.author.id)}`);
    logger.info(`[TCP Session] Active: ${activeSession}`);
    const route = determineMessageRoute({ isTicket, mentionsBot: isMentioned, activeSession });
    logger.info(`[TCP Message] Route: ${route}`);
    if (route === 'IGNORE') return;

    const isOwner = Boolean(env.OWNER_USER_ID) && message.author.id === env.OWNER_USER_ID;
    if (isOwner) {
      if (specialIntentRouter.isEscalated(guildId, message.channelId)) {
        specialIntentRouter.markOwnerJoined(guildId, message.channelId);
        logger.info(`[TCP Escalation] Owner joined conversation: ${message.channelId}`);
      }
      if (!shouldAnswerOwner(route)) return;
      logger.info('[TCP Message] Answering the owner');
    }
    if (isTicket) logger.info('[TCP Ticket] User message accepted');

    const question = normalizeUserQuestion(
      message.content,
      route === 'MENTION' || route === 'TICKET_MENTION' ? botId : undefined,
    );
    logger.info(`[TCP Message] Clean question: ${question || '<empty>'}`);

    try {
      if (!question) {
        await message.reply('How can I help with T.C.P.?');
        return;
      }

      logger.info('[TCP Escalation] Checking intent');
      // The owner asking for "a human" would only ping themselves.
      const escalationResult = isOwner ? null : specialIntentRouter.check(guildId, message.channelId, message.author.id, question);
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

      if (route === 'TICKET' && specialIntentRouter.isOwnerHandling(guildId, message.channelId)) return;

      if (route === 'TICKET' || route === 'TICKET_MENTION') logger.info('[TCP Ticket] Routing to T.C.P. Assistant');

      logger.info('[TCP AI] Request started');
      const session = memory.getOrCreate(guildId, message.channelId, message.author.id, isTicket);
      const followUpIntent = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
      const result = await assistant.answerDetailed(question, session.turns, botId, session.tuning, followUpIntent);
      memory.record(session, question, result.text);
      await message.reply(result.text);
      if (result.unanswered) {
        await reportUnanswered(client, { question, userId: message.author.id, where: message.url, sources: result.sources });
      }
    } catch (error) {
      logger.error({ err: error }, '[TCP Discord ERROR] Message processing failed');
      try {
        await message.reply('T.C.P. Assistant hit an error processing that message.');
      } catch (replyError) {
        logger.error({ err: replyError }, '[TCP Discord ERROR] Missing SendMessages permission or reply failed');
      }
    }
  });

  // Only delivered when the Server Members Intent is on.
  client.on(Events.GuildMemberAdd, async (member) => {
    if (!isMemberEventsActive() || member.guild.id !== env.DISCORD_GUILD_ID) return;
    await greetMember(client, member.user);
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
