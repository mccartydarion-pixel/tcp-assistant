export interface BotMentionMessage {
  content: string;
  mentions: { users: { has: (userId: string) => boolean } };
}

export function detectBotMention(message: BotMentionMessage, botId: string | undefined): boolean {
  if (!botId) return false;
  return message.mentions.users.has(botId)
    || message.content.includes(`<@${botId}>`)
    || message.content.includes(`<@!${botId}>`);
}
