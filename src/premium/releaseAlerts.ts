import { ActionRowBuilder, ButtonBuilder, ChannelType, type Client, type TextChannel } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { tcpEmbed, type Tone } from '../bot/embeds.js';
import { roleMembers } from '../bot/jobs.js';
import { eliteRole, personalCopy, premiumDownloadButton, premiumFileMessage, whatsNewEmbed, type ReleaseInfo } from './premium.js';
import { isEliteHubName } from './eliteHub.js';

// Release alerts: when the owner uploads a new Premium script with /tcp release, the Elite Hub gets an update
// card with the notes and a Download Premium button, and (unless the owner said notify: False) every Elite
// Supporter gets their own fingerprinted copy by DM with the notes. The DMs go out one at a time, a little
// apart, so Discord never sees a burst; the log channel gets the tally at the end.

const DM_GAP_MS = 1200;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function log(client: Client, title: string, description: string, tone: Tone): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;
  try {
    const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [tcpEmbed({ title, description, tone, timestamp: true })], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Releases] Could not write to the log channel');
  }
}

/** The Elite Hub channel if it exists (ELITE_HUB_CHANNEL_ID, or a channel named like the hub). Never creates one. */
function hubChannel(client: Client): TextChannel | null {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return null;
  const channel = env.ELITE_HUB_CHANNEL_ID
    ? guild.channels.cache.get(env.ELITE_HUB_CHANNEL_ID)
    : guild.channels.cache.find((c) => c.type === ChannelType.GuildText && isEliteHubName(c.name));
  return channel && channel.type === ChannelType.GuildText ? channel : null;
}

/** The card posted in the Elite Hub for a new release. */
export function releaseCard(release: Pick<ReleaseInfo, 'notes' | 'fileName' | 'uploadedAt'>) {
  const lines = [
    `A new **T.C.P Premium** build is out (${release.fileName}, <t:${Math.floor(release.uploadedAt / 1000)}:f>).`,
    '',
    release.notes.trim() ? release.notes.trim().slice(0, 3000) : 'Press **Download Premium** below for your copy.',
    '',
    'Press **Download Premium** for your own copy, add it to Zen Studio and program it to your slot. Your unlock code keeps working.',
  ];
  return {
    embeds: [tcpEmbed({ title: '🚀 T.C.P Premium updated', tone: 'success', description: lines.join('\n') })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(premiumDownloadButton())],
  };
}

export async function announceRelease(client: Client, release: ReleaseInfo): Promise<void> {
  const hub = hubChannel(client);
  let posted = false;
  if (hub) {
    posted = await hub
      .send(releaseCard(release))
      .then(() => true)
      .catch((error: unknown) => {
        logger.warn({ err: error }, '[TCP Releases] Could not post in the Elite Hub');
        return false;
      });
  }
  if (!release.notify) {
    await log(client, 'Premium update posted', `${release.fileName}: ${posted ? 'posted in the Elite Hub' : 'no Elite Hub to post in'}. Nobody was messaged (notify: False).`, 'success');
    return;
  }

  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
  const role = eliteRole(guild);
  if (!role) {
    await log(client, 'Premium update not sent', 'The Elite Supporter role was not found, so nobody was messaged.', 'warning');
    return;
  }
  const { members, complete } = await roleMembers(guild, role);
  const recipients = members.filter((member) => member.id !== env.OWNER_USER_ID);
  logger.info(`[TCP Releases] Sending ${release.fileName} to ${recipients.length} Elite Supporters`);
  const news = whatsNewEmbed(release.notes, release.fileName);
  let sent = 0;
  const closed: string[] = [];
  for (const member of recipients) {
    try {
      const message = premiumFileMessage(await personalCopy(member.id), env.LICENSE_CHANNEL_ID);
      await member.send({
        ...message,
        embeds: [tcpEmbed({ title: '🚀 New T.C.P Premium build', tone: 'success', description: 'Your own copy of the new build is attached.' }), ...(news ? [news] : []), ...message.embeds],
      });
      sent += 1;
    } catch (error) {
      logger.info({ err: error }, `[TCP Releases] Could not DM ${member.id}`);
      closed.push(member.id);
    }
    await wait(DM_GAP_MS);
  }
  const lines = [
    `**${release.fileName}** sent to **${sent}** of ${recipients.length} Elite Supporter${recipients.length === 1 ? '' : 's'}.`,
    posted ? 'The update card is in the Elite Hub.' : 'No Elite Hub channel was found for the update card.',
    closed.length > 0 ? `DMs closed (they can press **Download Premium**): ${closed.slice(0, 30).map((id) => `<@${id}>`).join(' ')}${closed.length > 30 ? ` and ${closed.length - 30} more` : ''}` : '',
    complete ? '' : 'The bot could not list every member (Server Members Intent off), so some Elite Supporters may have been missed.',
  ].filter(Boolean);
  await log(client, 'Premium update sent', lines.join('\n'), closed.length > 0 || !complete ? 'warning' : 'success');
}
