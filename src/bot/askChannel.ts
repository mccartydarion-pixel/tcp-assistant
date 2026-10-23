import { env } from '../config/env.js';

/**
 * Where the assistant answers: the help channel (HELP_CHANNEL_ID, #ask-tcp) and its threads, and support tickets
 * (each member's own private help room). Anywhere else, an @mention or /tcp ask gets a pointer to the help
 * channel instead of an answer. With no help channel configured there is nowhere to send people, so the
 * assistant answers wherever it is asked, as before.
 */
export function assistantAllowedIn(
  where: { channelId: string; parentId?: string | null; isTicket: boolean },
  helpChannelId: string | undefined = env.HELP_CHANNEL_ID,
): boolean {
  if (!helpChannelId) return true;
  if (where.isTicket) return true;
  return where.channelId === helpChannelId || where.parentId === helpChannelId;
}

/** The reply to someone who asks the assistant outside the help channel. */
export function askChannelRedirect(helpChannelId: string | undefined = env.HELP_CHANNEL_ID): string {
  return `I only answer questions in <#${helpChannelId}>. Post your question there (no @mention needed) and I'll help you in a thread.`;
}
