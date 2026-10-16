import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ThreadAutoArchiveDuration,
  type Client,
  type Interaction,
  type Message,
  type SendableChannels,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel } from '../bot/panels.js';
import { answerMessages, notice, tcpEmbed } from '../bot/embeds.js';
import type { AssistantService } from '../ai/assistantService.js';
import type { ConversationMemory } from '../ai/conversationMemory.js';
import type { SpecialIntentRouter } from '../ai/specialIntentRouter.js';
import { extractQuestionDetails, normalizeUserQuestion } from '../ai/question.js';
import { reportUnanswered } from '../ai/unanswered.js';
import { serverMapFor } from '../server/serverMap.js';
import { startTicket, ticketButtons, ticketPanelLines, ticketsEnabled } from '../tickets/ticketSystem.js';
import { cleanUpSolvedSoon } from './helpCleanup.js';
import { HELP_PANEL_ID, SOLVED_GRACE_MS, SOLVED_NOTICE } from './helpCleanupRules.js';

// The help channel (HELP_CHANNEL_ID): the assistant answers every question there, no @mention needed. Each
// question gets its own thread, so conversations do not mix; the asker's follow-ups in the thread continue
// the same conversation. Every answer has Solved (archives the thread, which is cleared away a few minutes
// later) and Still stuck (opens a ticket with the question filled in). When the owner writes in a thread, the
// assistant leaves that thread to them. helpCleanup.ts keeps the channel tidy.
const PREFIX = 'tcp-help:';
const SOLVED_PREFIX = `${PREFIX}solved:`;
const STUCK_ID = `${PREFIX}stuck`;
/** The panel's "How this channel works" button; its ID is also how the panel is found again. */
const HOW_IT_WORKS_ID = HELP_PANEL_ID;
export const HELP_PANEL_MARKER = HOW_IT_WORKS_ID;

/** The first question asked in each help thread, for Still stuck's ticket form. */
const threadQuestions = new Map<string, { question: string; at: number }>();
/** Help threads the owner has stepped into, and when. */
const ownerThreads = new Map<string, number>();
/**
 * Each member's questions are answered one at a time, in order: a message sent while an answer is still on
 * its way waits for it. Past MAX_WAITING queued messages, more are ignored (flood guard).
 */
const queues = new Map<string, { tail: Promise<void>; waiting: number }>();
const MAX_WAITING = 3;
const QUESTION_MEMORY_MS = 3 * 24 * 60 * 60 * 1000;

let deps: { assistant: AssistantService; memory: ConversationMemory; router: SpecialIntentRouter } | null = null;

export function initHelpChannel(dependencies: { assistant: AssistantService; memory: ConversationMemory; router: SpecialIntentRouter }): void {
  deps = dependencies;
}

/** Whether a message was posted in the help channel or one of its threads. */
export function isHelpMessage(message: Pick<Message, 'channelId' | 'channel'>): boolean {
  if (!env.HELP_CHANNEL_ID) return false;
  if (message.channelId === env.HELP_CHANNEL_ID) return true;
  return message.channel.isThread() && message.channel.parentId === env.HELP_CHANNEL_ID;
}

/** A thread name from the question: its first line, trimmed to fit, or the asker's name. */
export function helpThreadName(question: string, askerName: string): string {
  const firstLine = question.split('\n').find((line) => line.trim())?.trim() ?? '';
  const flat = firstLine.replace(/\s+/g, ' ');
  if (flat.length < 3) return `Help for ${askerName}`.slice(0, 100);
  return flat.length > 90 ? `${flat.slice(0, 89).trimEnd()}…` : flat;
}

/** Whether a message in the help channel is worth answering: it has some words, not just "ok" or an emoji. */
export function isAnswerable(question: string): boolean {
  const letters = question.replace(/<a?:\w+:\d+>/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return letters.length >= 3;
}

function answerButtons(askerId: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${SOLVED_PREFIX}${askerId}`).setLabel('Solved').setStyle(ButtonStyle.Success),
  );
  if (ticketsEnabled()) row.addComponents(new ButtonBuilder().setCustomId(STUCK_ID).setLabel('Still stuck? Open a ticket').setStyle(ButtonStyle.Secondary));
  return row;
}

export function buildHelpPanel() {
  const withTickets = ticketsEnabled() && !env.TICKET_PANEL_CHANNEL_ID;
  const embed = tcpEmbed({
    title: 'Ask T.C.P. Assistant',
    description: [
      'Post your question in this channel, no @mention needed. I reply in a thread so every question keeps its own conversation; keep talking to me there.',
      '',
      '**Get a better answer faster by including:**',
      '• Your controller (PlayStation or Xbox)',
      '• Your DayZ in-game aiming sensitivity',
      '• The T.C.P values you use (Vertical, Horizontal, ADS Sens...)',
      '',
      withTickets ? "**Can't sort it here?** Open a private ticket with the owner:" : "Can't sort it here? Press **Still stuck** under any answer to open a ticket.",
      ...(withTickets ? ticketPanelLines() : []),
    ].join('\n'),
  });
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(HOW_IT_WORKS_ID).setLabel('How this channel works').setStyle(ButtonStyle.Secondary),
    ),
  ];
  if (withTickets) rows.push(ticketButtons());
  return { embeds: [embed], components: rows };
}

export async function ensureHelpPanel(client: Client): Promise<void> {
  if (!env.HELP_CHANNEL_ID) {
    logger.info('[TCP Help] HELP_CHANNEL_ID not set; the help channel is off. Members can still @mention the bot.');
    return;
  }
  await ensurePanel(client, env.HELP_CHANNEL_ID, HELP_PANEL_MARKER, buildHelpPanel(), 'help');
}

async function sendAll(channel: SendableChannels, parts: ReturnType<typeof answerMessages>): Promise<Message | undefined> {
  let last: Message | undefined;
  for (const part of parts) last = await channel.send(part);
  return last;
}

/** Answers a message in the help channel or one of its threads. Returns true when the message was handled. */
export async function handleHelpMessage(message: Message, isOwner: boolean, mentionsBot: boolean): Promise<boolean> {
  if (!deps || !isHelpMessage(message)) return false;
  const inThread = message.channel.isThread();
  // The owner writing in someone's thread takes it over; elsewhere the owner is only answered when they @mention the bot.
  if (isOwner) {
    if (inThread) ownerThreads.set(message.channelId, Date.now());
    if (!mentionsBot) return true;
  }
  if (inThread && ownerThreads.has(message.channelId) && !mentionsBot) return true;

  const question = normalizeUserQuestion(message.content, message.client.user?.id);
  if (!isAnswerable(question)) return true;

  const userId = message.author.id;
  const queue = queues.get(userId) ?? { tail: Promise.resolve(), waiting: 0 };
  if (queue.waiting >= MAX_WAITING) return true;
  queue.waiting += 1;
  queues.set(userId, queue);
  const run = queue.tail
    .then(() => answerHelp(message, question, isOwner))
    .finally(() => {
      queue.waiting -= 1;
      if (queue.waiting === 0 && queues.get(userId) === queue) queues.delete(userId);
    });
  queue.tail = run;
  await run;
  return true;
}

async function answerHelp(message: Message, question: string, isOwner: boolean): Promise<void> {
  if (!deps) return;
  const inThread = message.channel.isThread();
  const botId = message.client.user?.id;
  const { assistant, memory, router } = deps;
  try {
    let channel: SendableChannels = message.channel as SendableChannels;
    let replyTo: Message | null = inThread ? message : null;
    if (!inThread) {
      try {
        const thread = await message.startThread({
          name: helpThreadName(question, message.member?.displayName ?? message.author.username),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
          reason: 'T.C.P help question',
        });
        channel = thread;
        pruneHelpMemory();
        threadQuestions.set(thread.id, { question, at: Date.now() });
      } catch (error) {
        // No Create Public Threads permission: answer in the channel instead.
        logger.warn({ err: error }, '[TCP Help] Could not start a thread; answering in the channel. Give the bot Create Public Threads there.');
        replyTo = message;
      }
    }
    await channel.sendTyping();

    const guildId = message.guildId ?? 'dm';
    const escalation = isOwner ? null : router.check(guildId, channel.id, message.author.id, question);
    if (escalation) {
      await channel.send(router.ownerResponse(!escalation.shouldNotify));
      return;
    }

    const session = memory.getOrCreate(guildId, channel.id, message.author.id);
    const followUp = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    const result = await assistant.answerDetailed(question, session.turns, botId, session.tuning, followUp, serverMapFor(message.guild, message.member));
    memory.record(session, question, result.text);
    const parts = answerMessages(result.text, {}, [answerButtons(message.author.id)]);
    if (replyTo) {
      const [first, ...rest] = parts;
      await replyTo.reply(first!);
      await sendAll(channel, rest);
    } else {
      await sendAll(channel, parts);
    }
    if (result.unanswered) {
      await reportUnanswered(message.client, { question, userId: message.author.id, where: `<#${channel.id}> (help)`, sources: result.sources });
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP Help ERROR] Could not answer a help question');
    await message.reply(notice('Sorry, I hit an error with that question. Please try again in a moment.', { tone: 'danger' })).catch(() => undefined);
  }
}

/**
 * The question to fill into a Still stuck ticket: the thread's first question, else the message replied to.
 * Only from what the bot already holds, never a fetch: the ticket form must open within Discord's 3 seconds.
 */
function stuckQuestion(interaction: Interaction & { message: Message }): string {
  const channel = interaction.channel;
  const botId = interaction.client.user?.id;
  if (channel?.isThread()) {
    const remembered = threadQuestions.get(channel.id);
    if (remembered) return remembered.question;
    // A thread started from a message shares that message's ID, in the parent channel.
    const starter = channel.parent && 'messages' in channel.parent ? channel.parent.messages.cache.get(channel.id) : undefined;
    if (starter) return normalizeUserQuestion(starter.content, botId);
  }
  const referenced = interaction.message.reference?.messageId;
  if (referenced && channel && 'messages' in channel) {
    const original = channel.messages.cache.get(referenced);
    if (original) return normalizeUserQuestion(original.content, botId);
  }
  return '';
}

export async function handleHelpInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  const id = interaction.customId;

  if (id === HOW_IT_WORKS_ID) {
    await interaction.reply({
      ...notice(
        [
          '`1` Post your question in this channel.',
          '`2` I start a thread for it and answer there. Reply in the thread to keep the conversation going.',
          `\`3\` Sorted? Press **Solved** and the thread is cleared away ${SOLVED_GRACE_MS / 60_000} minutes later. Not sorted? Press **Still stuck** to open a private ticket with the owner.`,
          '`4` Threads with no reply for a day are cleared away too, so the channel stays tidy.',
        ].join('\n'),
        { title: 'How this channel works' },
      ),
      ephemeral: true,
    });
    return true;
  }

  if (id === STUCK_ID) {
    await startTicket(interaction, 'setup', stuckQuestion(interaction));
    return true;
  }

  if (id.startsWith(SOLVED_PREFIX)) {
    const askerId = id.slice(SOLVED_PREFIX.length);
    const owner = Boolean(env.OWNER_USER_ID) && interaction.user.id === env.OWNER_USER_ID;
    if (interaction.user.id !== askerId && !owner) {
      await interaction.reply({ ...notice('Only the person who asked can mark this solved.', { tone: 'muted' }), ephemeral: true });
      return true;
    }
    await interaction.update({ components: [] });
    const channel = interaction.channel;
    if (channel && 'send' in channel) await channel.send(notice(SOLVED_NOTICE, { tone: 'success' }));
    if (channel?.isThread()) {
      threadQuestions.delete(channel.id);
      await channel.setArchived(true, 'T.C.P help question solved').catch((error: unknown) => logger.info({ err: error }, '[TCP Help] Could not archive a solved thread'));
      cleanUpSolvedSoon(interaction.client, channel.id);
    }
    return true;
  }
  return false;
}

/** Forgets old thread questions and owner threads, so these maps do not grow forever. */
export function pruneHelpMemory(now = Date.now()): void {
  for (const [threadId, entry] of threadQuestions) if (now - entry.at > QUESTION_MEMORY_MS) threadQuestions.delete(threadId);
  for (const [threadId, at] of ownerThreads) if (now - at > QUESTION_MEMORY_MS) ownerThreads.delete(threadId);
}
