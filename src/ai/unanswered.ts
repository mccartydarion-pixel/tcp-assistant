import { EmbedBuilder, type Client } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { shouldLog } from './unansweredMarker.js';

// Questions the documentation could not answer are posted to LOG_CHANNEL_ID, once a day at most per
// question, so the owner can see what is missing from knowledge/T.C.P_DOCUMENTATION.md.
const recentlyLogged = new Map<string, number>();

export async function reportUnanswered(
  client: Client,
  details: { question: string; userId: string; where?: string; sources: string[] },
): Promise<void> {
  if (!env.LOG_CHANNEL_ID || !shouldLog(details.question, Date.now(), recentlyLogged)) return;
  try {
    const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle("Question the bot couldn't answer")
      .setColor(0xf59f00)
      .setDescription(`> ${details.question.slice(0, 1000).replace(/\n/g, '\n> ')}`)
      .addFields(
        { name: 'Asked by', value: `<@${details.userId}>`, inline: true },
        { name: 'Where', value: details.where ?? 'Unknown', inline: true },
        { name: 'Closest documentation', value: details.sources.length > 0 ? details.sources.slice(0, 5).join('\n') : 'Nothing matched' },
      )
      .setFooter({ text: 'Add the answer to knowledge/T.C.P_DOCUMENTATION.md so the bot can answer it next time.' })
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    logger.info('[TCP AI] Logged an unanswered question');
  } catch (error) {
    logger.warn({ err: error }, '[TCP AI] Could not log an unanswered question');
  }
}
