export type MessageRoute = 'IGNORE' | 'MENTION' | 'TICKET' | 'TICKET_MENTION' | 'CONTINUATION';

export function determineMessageRoute(params: { isTicket: boolean; mentionsBot: boolean; activeSession?: boolean }): MessageRoute {
  if (params.isTicket && params.mentionsBot) return 'TICKET_MENTION';
  if (params.isTicket) return 'TICKET';
  if (params.mentionsBot) return 'MENTION';
  if (params.activeSession) return 'CONTINUATION';
  return 'IGNORE';
}
