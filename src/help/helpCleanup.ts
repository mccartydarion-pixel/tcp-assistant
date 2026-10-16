import {
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
  SnowflakeUtil,
  type AnyThreadChannel,
  type Client,
  type Message,
  type TextChannel,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { tcpEmbed } from '../bot/embeds.js';
import { fetchTranscriptMessages } from '../tickets/ticketSystem.js';
import { HELP_PANEL_ID, SOLVED_GRACE_MS, helpTranscript, looseMessageIsDone, threadIsDone, wasSolved } from './helpCleanupRules.js';

// Keeps the help channel tidy. A help thread is deleted, with the question it was started from, once the
// member is done: a few minutes after Solved, or after a day with no messages. A transcript of each goes to
// the log channel first. Messages left in the channel itself go after a day, except pinned ones, the owner's
// and the help panel. Only threads the bot started are touched. Needs Manage Threads and Manage Messages.
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const FIRST_SWEEP_MS = 60 * 1000;
// At most this many threads per sweep, so a backlog does not flood the log channel.
const THREADS_PER_SWEEP = 20;
const LOOSE_MESSAGE_PAGES = 3;

const removing = new Set<string>();
let started = false;
let warnedAboutPermissions = false;

export function startHelpCleanup(client: Client): void {
  if (!env.HELP_CHANNEL_ID || started) return;
  started = true;
  const sweep = () => void sweepHelpChannel(client).catch((error: unknown) => logger.warn({ err: error }, '[TCP Help] Clean-up sweep failed'));
  setTimeout(sweep, FIRST_SWEEP_MS).unref();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
  logger.info('[TCP Help] Clean-up on: solved threads go after 5 minutes, quiet threads and loose messages after a day.');
}

/** After Solved: clear the thread away once the grace period is over, unless the member has written again. */
export function cleanUpSolvedSoon(client: Client, threadId: string): void {
  setTimeout(() => {
    void (async () => {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread?.isThread() || !thread.archived) return;
      const parent = await helpChannel(client);
      if (parent && thread.parentId === parent.id) await removeThread(client, parent, thread);
    })().catch((error: unknown) => logger.warn({ err: error }, '[TCP Help] Could not clear away a solved thread'));
  }, SOLVED_GRACE_MS + 5_000).unref();
}

async function helpChannel(client: Client): Promise<TextChannel | null> {
  if (!env.HELP_CHANNEL_ID) return null;
  const channel = await client.channels.fetch(env.HELP_CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
  const permissions = channel.permissionsFor(me);
  const missing = (['ManageThreads', 'ManageMessages', 'ReadMessageHistory'] as const).filter((name) => !permissions?.has(PermissionFlagsBits[name]));
  if (missing.length > 0) {
    if (!warnedAboutPermissions) {
      logger.warn(`[TCP Help] Cannot tidy the help channel: give the bot ${missing.join(', ')} there.`);
      warnedAboutPermissions = true;
    }
    return null;
  }
  return channel;
}

export async function sweepHelpChannel(client: Client): Promise<void> {
  const channel = await helpChannel(client);
  const botId = client.user?.id;
  if (!channel || !botId) return;
  const now = Date.now();

  const active = await channel.threads.fetchActive();
  const archived = await channel.threads.fetchArchived({ type: 'public', limit: 100 });
  let removed = 0;
  for (const thread of [...active.threads.values(), ...archived.threads.values()]) {
    if (removed >= THREADS_PER_SWEEP) break;
    if (thread.parentId !== channel.id || thread.ownerId !== botId) continue;
    const lastActivityAt = thread.lastMessageId ? SnowflakeUtil.timestampFrom(thread.lastMessageId) : (thread.createdTimestamp ?? now);
    if (!threadIsDone({ archived: Boolean(thread.archived), archivedAt: thread.archiveTimestamp, lastActivityAt }, now)) continue;
    if (await removeThread(client, channel, thread)) removed += 1;
  }

  let before: string | undefined;
  let loose = 0;
  for (let page = 0; page < LOOSE_MESSAGE_PAGES; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    for (const message of batch.values()) {
      const done = looseMessageIsDone(
        {
          at: message.createdTimestamp,
          pinned: message.pinned,
          fromOwner: Boolean(env.OWNER_USER_ID) && message.author.id === env.OWNER_USER_ID,
          isPanel: message.author.id === botId && isHelpPanel(message),
          hasThread: message.hasThread,
        },
        now,
      );
      if (done && (await message.delete().then(() => true).catch(() => false))) loose += 1;
    }
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  if (removed > 0 || loose > 0) logger.info(`[TCP Help] Tidied the help channel: ${removed} thread(s), ${loose} loose message(s).`);
}

function isHelpPanel(message: Message): boolean {
  return JSON.stringify(message.components.map((row) => row.toJSON())).includes(`"${HELP_PANEL_ID}"`);
}

/** Logs the thread's transcript, then deletes the thread and the question it was started from. */
async function removeThread(client: Client, channel: TextChannel, thread: AnyThreadChannel): Promise<boolean> {
  if (removing.has(thread.id)) return false;
  removing.add(thread.id);
  try {
    const starter = await channel.messages.fetch(thread.id).catch(() => null);
    const { messages, names } = await fetchTranscriptMessages(thread);
    const solved = wasSolved(messages);
    const askedBy = starter ? (starter.member?.displayName ?? starter.author.username) : 'unknown';
    const outcome = solved ? 'Solved' : 'No reply for a day';
    const now = Date.now();
    const transcript = helpTranscript(
      { threadName: thread.name, askedBy, startedAt: starter?.createdTimestamp ?? thread.createdTimestamp ?? now, question: starter?.content ?? thread.name, outcome, closedAt: now },
      messages,
      names,
    );
    await logThread(client, {
      memberId: starter?.author.id ?? null,
      question: starter?.content || thread.name,
      outcome,
      messageCount: messages.length,
      transcript,
      fileName: `help-${thread.id}.txt`,
    });
    await thread.delete(solved ? 'T.C.P help question solved' : 'T.C.P help thread had no reply for a day');
    if (starter && !starter.pinned) await starter.delete().catch((error: unknown) => logger.info({ err: error }, '[TCP Help] Could not delete a help question'));
    logger.info(`[TCP Help] Cleared away help thread ${thread.id} (${outcome.toLowerCase()})`);
    return true;
  } catch (error) {
    logger.warn({ err: error }, `[TCP Help] Could not clear away help thread ${thread.id}`);
    return false;
  } finally {
    removing.delete(thread.id);
  }
}

async function logThread(
  client: Client,
  entry: { memberId: string | null; question: string; outcome: string; messageCount: number; transcript: string; fileName: string },
): Promise<void> {
  const channelId = env.TICKET_LOG_CHANNEL_ID ?? env.LOG_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel = await fetchSendableChannel(client, channelId);
    if (!channel) return;
    const question = entry.question.length > 300 ? `${entry.question.slice(0, 297)}...` : entry.question;
    await channel.send({
      embeds: [
        tcpEmbed({
          title: 'Help thread cleared away',
          tone: entry.outcome === 'Solved' ? 'success' : 'muted',
          timestamp: true,
          fields: [
            { name: 'Member', value: entry.memberId ? `<@${entry.memberId}>` : 'Unknown', inline: true },
            { name: 'Outcome', value: entry.outcome, inline: true },
            { name: 'Messages', value: String(entry.messageCount), inline: true },
            { name: 'Question', value: question || '(empty)' },
          ],
        }),
      ],
      files: [new AttachmentBuilder(Buffer.from(entry.transcript, 'utf8'), { name: entry.fileName })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Help] Could not write a help transcript to the log channel');
  }
}
