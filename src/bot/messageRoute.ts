export type MessageRoute = 'IGNORE' | 'MENTION' | 'TICKET' | 'TICKET_MENTION' | 'CONTINUATION';

export function determineMessageRoute(params: { isTicket: boolean; mentionsBot: boolean; activeSession?: boolean }): MessageRoute {
  if (params.isTicket && params.mentionsBot) return 'TICKET_MENTION';
  if (params.isTicket) return 'TICKET';
  if (params.mentionsBot) return 'MENTION';
  if (params.activeSession) return 'CONTINUATION';
  return 'IGNORE';
}

/**
 * Whether the bot answers the owner. The owner gets answers like any member when they @mention the bot
 * or are mid-conversation with it, but a plain message in a support ticket is the owner talking to the
 * member, so the bot stays out of it.
 */
export function shouldAnswerOwner(route: MessageRoute): boolean {
  return route !== 'IGNORE' && route !== 'TICKET';
}
