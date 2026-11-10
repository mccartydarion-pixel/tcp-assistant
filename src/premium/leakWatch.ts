import type { Message } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { tcpEmbed } from '../bot/embeds.js';
import { isStaffMember } from '../bot/staff.js';
import { inspectPremiumText } from './premium.js';
import { isTicketTopic } from '../tickets/ticketRules.js';

// The leak watch: every .gpc (or .txt) file posted anywhere in the server is checked. If it is the Premium
// script (it carries a member's fingerprint, is built like the scrambled release, or is the owner's own
// upload) and the poster is not on the team, the message is deleted, the poster is told why, and the log
// channel says whose copy it was. The team can post it freely, and so can a member in their own private
// ticket (showing the team their file is not a leak).

const MAX_BYTES = 2_000_000;

/** Attachments worth checking: script files and text files small enough to be one. */
export function isScriptAttachment(name: string, size: number): boolean {
  return /\.(gpc|txt)$/i.test(name) && size > 0 && size <= MAX_BYTES;
}

/** Checks a message's attachments. True when it was a Premium leak and was dealt with. */
export async function watchForLeaks(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const files = [...message.attachments.values()].filter((file) => isScriptAttachment(file.name, file.size));
  if (files.length === 0) return false;
  if (isStaffMember(message.member)) return false;
  const channel = message.channel;
  const inTicket =
    ('parentId' in channel && Boolean(env.SUPPORT_CATEGORY_ID) && channel.parentId === env.SUPPORT_CATEGORY_ID) || ('topic' in channel && isTicketTopic(channel.topic));
  if (inTicket) return false;

  for (const file of files) {
    let verdict;
    try {
      const response = await fetch(file.url);
      if (!response.ok) continue;
      verdict = await inspectPremiumText(file.name, Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      logger.warn({ err: error }, '[TCP Leak watch] Could not read an attachment');
      continue;
    }
    if (verdict.owners.length === 0 && !verdict.looksLikeRelease && !verdict.ownUpload) continue;

    const deleted = await message
      .delete()
      .then(() => true)
      .catch((error: unknown) => {
        logger.warn({ err: error }, '[TCP Leak watch] Could not delete a leaked script; give the bot Manage Messages there');
        return false;
      });
    await message.author
      .send({
        embeds: [
          tcpEmbed({
            title: 'Your post was removed',
            tone: 'danger',
            description: `Sharing the T.C.P Premium script is not allowed, so your message in <#${message.channelId}> was ${deleted ? 'removed' : 'reported'}. Every copy is personal to the member it was sent to.`,
          }),
        ],
      })
      .catch(() => undefined);

    const whose =
      verdict.owners.length > 0
        ? verdict.owners.map((mark) => `<@${mark.discordUserId}> (\`${mark.discordUserId}\`)`).join(', ')
        : verdict.ownUpload
          ? 'Your own upload, with no member fingerprint in it'
          : 'No fingerprint found (an older copy, or the line was removed)';
    logger.warn(`[TCP Leak watch] ${message.author.id} posted the Premium script in ${message.channelId}; ${deleted ? 'deleted' : 'not deleted'}`);
    if (env.LOG_CHANNEL_ID) {
      const log = await fetchSendableChannel(message.client, env.LOG_CHANNEL_ID).catch(() => null);
      await log
        ?.send({
          embeds: [
            tcpEmbed({
              title: '🚨 Premium script posted',
              tone: 'danger',
              timestamp: true,
              fields: [
                { name: 'Posted by', value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
                { name: 'Where', value: `<#${message.channelId}>`, inline: true },
                { name: 'File', value: file.name.slice(0, 100), inline: true },
                { name: 'Whose copy', value: whose.slice(0, 1000) },
                { name: 'Action', value: deleted ? 'Message deleted; the poster was told why.' : 'Could not delete it: give the bot Manage Messages in that channel and delete it by hand.' },
              ],
            }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
    }
    return true;
  }
  return false;
}
