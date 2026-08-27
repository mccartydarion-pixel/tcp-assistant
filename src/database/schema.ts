export const schema = {
  users: 'users',
  tickets: 'tickets',
  ticketMessages: 'ticketMessages',
  ticketSummaries: 'ticketSummaries',
  bugReports: 'bugReports',
  conversationSessions: 'conversationSessions',
  tuningSessions: 'tuningSessions',
  botSettings: 'botSettings',
};

export type UserRow = {
  id: string;
  discordUserId: string;
  createdAt: number;
};

export type TicketRow = {
  id: string;
  discordChannelId: string;
  discordUserId: string;
  category: string;
  status: string;
  confidence: string;
  summary: string;
  settingsJson: string;
  createdAt: number;
  updatedAt: number;
};

export type BugReportRow = {
  id: string;
  reporterId: string;
  version: string | null;
  category: string;
  description: string;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  reproductionSteps: string;
  frequency: string | null;
  settingsJson: string | null;
  attachmentsJson: string;
  status: string;
  createdAt: number;
};
