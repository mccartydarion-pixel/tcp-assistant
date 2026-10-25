import { Events, MessageType, type Client, type GuildBasedChannel, type Message } from 'discord.js';
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
import { handleReviewInteraction } from '../reviews/reviews.js';
import { handleGameInteraction } from '../games/gameScripts.js';
import {
  greetFromJoinMessage,
  greetMember,
  handleWelcomeInteraction,
  isMemberEventsActive,
  newcomerFromMember,
  scheduleServerGuideRefresh,
} from '../welcome/welcome.js';
import { handleHelpInteraction, handleHelpMessage, isHelpMessage } from '../help/helpChannel.js';
import { handlePaymentInteraction } from '../payments/stripeBilling.js';
import { handlePremiumInteraction } from '../premium/premium.js';
import { reportUnanswered } from '../ai/unanswered.js';
import { answerMessages, notice, tcpEmbed } from './embeds.js';
import {
  handleTicketChannelDeleted,
  handleTicketInteraction,
  isAssistantQuietInTicket,
  noteOwnerInTicket,
  ticketAudience,
} from '../tickets/ticketSystem.js';
import { isTicketTopic } from '../tickets/ticketRules.js';
import { serverMapFor } from '../server/serverMap.js';
import { askChannelRedirect } from './askChannel.js';

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
        (await handleTicketInteraction(interaction)) ||
          (await handlePaymentInteraction(interaction)) ||
          (await handlePremiumInteraction(interaction)) ||
          (await handleHelpInteraction(interaction)) ||
          (await handleLicenseInteraction(interaction)) ||
          (await handleAnnounceInteraction(interaction)) ||
          (await handleSettingsInteraction(interaction)) ||
          (await handleBugInteraction(interaction)) ||
          (await handleReviewInteraction(interaction)) ||
          (await handleGameInteraction(interaction)) ||
          (await handleWelcomeInteraction(interaction));
      } catch (error) {
        logger.error({ err: error }, '[TCP Panels ERROR] Interaction failed');
        const response = { ...notice('Something went wrong. Please try again.', { tone: 'danger' }), ephemeral: true };
        // The interaction may have expired too (Discord allows 3 seconds); then there is no one to tell.
        try {
          if (interaction.deferred || interaction.replied) await interaction.followUp(response);
          else await interaction.reply(response);
        } catch (replyError) {
          logger.warn({ err: replyError }, '[TCP Panels] Could not report the failure to the member');
        }
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
      const response = { ...notice('Something went wrong while handling that command.', { tone: 'danger' }), ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(response);
        else await interaction.reply(response);
      } catch (replyError) {
        logger.warn({ err: replyError }, '[TCP Discord] Could not report the command failure');
      }
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
    // Other system messages (thread created, thread renamed, pins...) carry a member as author but are not questions.
    if (message.system) return;

    // The help channel and its threads: every question is answered there, no @mention needed.
    if (isHelpMessage(message)) {
      const fromOwner = Boolean(env.OWNER_USER_ID) && message.author.id === env.OWNER_USER_ID;
      await handleHelpMessage(message, fromOwner, isMentioned);
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

    // The assistant answers only in the help channel (#ask-tcp, handled above) and in support tickets. An
    // @mention anywhere else gets a pointer to the help channel; a plain message there is left alone.
    if (!isTicket && env.HELP_CHANNEL_ID) {
      if (route === 'MENTION') {
        logger.info('[TCP Message] Outside the help channel: pointing to it');
        try {
          await message.reply(notice(askChannelRedirect(), { tone: 'muted' }));
        } catch (error) {
          logger.warn({ err: error }, '[TCP Message] Could not point the member to the help channel');
        }
      }
      return;
    }

    const isOwner = Boolean(env.OWNER_USER_ID) && message.author.id === env.OWNER_USER_ID;
    if (isOwner) {
      // The owner writing in a T.C.P ticket takes it over; the assistant steps back.
      if (isTicket) await noteOwnerInTicket(message.channelId);
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
        // A screenshot posted on its own, or a bare message in a ticket, is for the owner, not a prompt to ask again.
        if (isTicket || message.attachments.size > 0) return;
        await message.reply(notice('How can I help with T.C.P.? Ask me anything about the script, your license or this server.'));
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
        await message.reply(notice("I'm still here. The owner has already been notified; leave any extra details about the issue while you wait.", { tone: 'muted' }));
        return;
      }

      // In a T.C.P ticket the assistant stays quiet once the owner has it, and in licence and payment tickets,
      // unless the member @mentions it (TICKET_MENTION).
      if (route === 'TICKET' && (specialIntentRouter.isOwnerHandling(guildId, message.channelId) || (await isAssistantQuietInTicket(message.channelId)))) return;

      if (route === 'TICKET' || route === 'TICKET_MENTION') logger.info('[TCP Ticket] Routing to T.C.P. Assistant');

      logger.info('[TCP AI] Request started');
      const session = memory.getOrCreate(guildId, message.channelId, message.author.id, isTicket);
      const followUpIntent = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
      // Channels the asker and whoever reads the answer can both see: the ticket's member in a ticket, else everyone.
      const audience = isTicket && message.guild ? await ticketAudience(message.guild, message.channelId) : null;
      const serverMap = serverMapFor(message.guild, message.member, audience);
      const result = await assistant.answerDetailed(question, session.turns, botId, session.tuning, followUpIntent, serverMap);
      memory.record(session, question, result.text);
      await replyWithAnswer(message, result.text);
      if (result.unanswered) {
        await reportUnanswered(client, { question, userId: message.author.id, where: message.url, sources: result.sources });
      }
    } catch (error) {
      logger.error({ err: error }, '[TCP Discord ERROR] Message processing failed');
      try {
        await message.reply(notice('Sorry, I hit an error with that message. Please try again in a moment.', { tone: 'danger' }));
      } catch (replyError) {
        logger.error({ err: replyError }, '[TCP Discord ERROR] Missing SendMessages permission or reply failed');
      }
    }
  });

  // Only delivered when the Server Members Intent is on.
  client.on(Events.GuildMemberAdd, async (member) => {
    if (!isMemberEventsActive() || member.guild.id !== env.DISCORD_GUILD_ID) return;
    await greetMember(client, newcomerFromMember(member));
  });

  client.on(Events.ChannelCreate, async (channel) => {
    refreshGuideFor(client, channel);
    if (!('parentId' in channel) || channel.parentId !== env.SUPPORT_CATEGORY_ID || !channel.isTextBased()) return;
    // T.C.P's own tickets post their own opening message.
    if ('topic' in channel && isTicketTopic(channel.topic)) return;
    logger.info(`[TCP Ticket] New support channel detected: ${channel.id}`);
    try {
      await channel.send({
        embeds: [
          tcpEmbed({
            title: 'T.C.P. Support Assistant',
            description: "I'll help troubleshoot your issue before the owner reviews it.\n\nPlease describe the problem you're having.",
          }),
        ],
      });
    } catch (error) {
      logger.error({ err: error }, '[TCP Ticket ERROR] Welcome message failed');
    }
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.isDMBased()) refreshGuideFor(client, channel);
    await handleTicketChannelDeleted(channel.id);
  });

  // Renames, moves, topic and permission changes all show in the Server guide.
  client.on(Events.ChannelUpdate, (_old, channel) => {
    if (!channel.isDMBased()) refreshGuideFor(client, channel);
  });

  logger.info('[TCP Events] interactionCreate loaded');
  logger.info('[TCP Events] messageCreate loaded');
  logger.info('[TCP Events] channelCreate loaded');
}

/** A channel in the server changed: refresh the Server guide, except for ticket channels, which it never shows. */
function refreshGuideFor(client: Client, channel: GuildBasedChannel): void {
  if (channel.guild.id !== env.DISCORD_GUILD_ID) return;
  if ('topic' in channel && isTicketTopic(channel.topic)) return;
  scheduleServerGuideRefresh(client);
}

/** Replies with an answer as embeds; a long answer continues in further messages. */
async function replyWithAnswer(message: Message, text: string): Promise<void> {
  const [first, ...rest] = answerMessages(text);
  await message.reply(first!);
  for (const part of rest) {
    if ('send' in message.channel) await message.channel.send(part);
  }
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
