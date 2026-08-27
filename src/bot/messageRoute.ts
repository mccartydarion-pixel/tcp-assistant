export type MessageRoute = 'IGNORE' | 'MENTION' | 'TICKET' | 'TICKET_MENTION';

export function determineMessageRoute(params: { isTicket: boolean; mentionsBot: boolean }): MessageRoute {
  if (params.isTicket && params.mentionsBot) return 'TICKET_MENTION';
  if (params.isTicket) return 'TICKET';
  if (params.mentionsBot) return 'MENTION';
  return 'IGNORE';
}
