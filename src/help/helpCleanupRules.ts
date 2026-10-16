import { stamp, transcriptText, type TranscriptMessage } from '../tickets/ticketRules.js';

// When the help channel is tidied up. A thread goes a few minutes after Solved, or a day after its last
// message (Discord archives it then, and the sweep removes archived threads). Messages left in the channel
// itself go after a day too, except pinned ones, the owner's and the bot's help panel.

/** The help panel's "How this channel works" button; its ID is also how the panel is found again. */
export const HELP_PANEL_ID = 'tcp-help:panel';
export const SOLVED_GRACE_MS = 5 * 60 * 1000;
export const IDLE_MS = 24 * 60 * 60 * 1000;
export const SOLVED_NOTICE = `Marked as solved. Glad it is sorted! This thread will be cleared away in ${SOLVED_GRACE_MS / 60_000} minutes.`;

/**
 * Whether a help thread is done with: archived for a few minutes (Solved archives it, and Discord archives
 * one after a day without messages), or open with nothing said for a day.
 */
export function threadIsDone(thread: { archived: boolean; archivedAt: number | null; lastActivityAt: number }, now: number): boolean {
  if (thread.archived) return thread.archivedAt === null || now - thread.archivedAt >= SOLVED_GRACE_MS;
  return now - thread.lastActivityAt >= IDLE_MS;
}

/** Whether a message posted in the help channel itself (not in a thread) can go. */
export function looseMessageIsDone(
  message: { at: number; pinned: boolean; fromOwner: boolean; isPanel: boolean; hasThread: boolean },
  now: number,
): boolean {
  if (message.pinned || message.fromOwner || message.isPanel || message.hasThread) return false;
  return now - message.at >= IDLE_MS;
}

/** True when the member pressed Solved in this thread. */
export function wasSolved(messages: TranscriptMessage[]): boolean {
  return messages.some((message) => message.bot && message.embeds.some((embed) => (embed.description ?? '').startsWith('Marked as solved')));
}

/** The transcript kept in the log channel when a help thread is cleared away. */
export function helpTranscript(
  meta: { threadName: string; askedBy: string; startedAt: number; question: string; outcome: string; closedAt: number },
  messages: TranscriptMessage[],
  names: Map<string, string> = new Map(),
): string {
  const header = [
    `T.C.P help thread · ${meta.threadName}`,
    `Asked by ${meta.askedBy} on ${stamp(meta.startedAt)}`,
    `${meta.outcome}; cleared away on ${stamp(meta.closedAt)}`,
  ];
  const question: TranscriptMessage = { at: meta.startedAt, author: meta.askedBy, bot: false, content: meta.question, embeds: [], attachments: [] };
  // Leave out Discord's empty "thread started" placeholder.
  const said = messages.filter((message) => message.content.trim() || message.embeds.length > 0 || message.attachments.length > 0);
  return transcriptText(header, [question, ...said], names);
}
