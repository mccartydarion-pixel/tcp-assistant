import { MessageType, type Client, type GuildMember, type Message, type PartialGuildMember } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { tcpEmbed, type Tone } from '../bot/embeds.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { isMemberEventsActive } from '../welcome/welcome.js';
import { isEliteMember, onPremiumPaid } from '../premium/premium.js';
import { grantBoostReward } from './licensePanel.js';

// Server boost reward: boosting the T.C.P server gives a month of Premium, and another month for every 30 days the
// member keeps boosting. A member already on Premium gets the month on top of the days they have. Boosting, stopping
// and boosting again within 30 days of the last reward gives nothing more (the store keeps when each was given).
export const BOOST_REWARD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const BOOST_REWARD_EVERY_MS = 30 * DAY_MS;
// The sweep finds members still boosting whose next month is due, and boosts the bot missed while it was down.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;

const BOOST_MESSAGES = new Set<MessageType>([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
]);

/** True when a member update is the start of a boost (or may be: Discord sent no earlier state). */
export function startedBoosting(before: Date | null | undefined, after: Date | null | undefined, beforeKnown: boolean): boolean {
  return !!after && (!beforeKnown || !before);
}

/** Discord's "just boosted the server" system message. */
export function isBoostMessage(type: MessageType): boolean {
  return BOOST_MESSAGES.has(type);
}

/** The DM a member gets when a boost adds their month. */
export function boostRewardText(expiresAt: number, licenceLink?: string): { title: string; description: string } {
  return {
    title: 'Thanks for boosting T.C.P! 🚀',
    description: [
      `Your boost just added **${BOOST_REWARD_DAYS} days of T.C.P Premium**. Your license now runs until <t:${Math.floor(expiresAt / 1000)}:D>.`,
      'Already on Premium? The month went on top of the days you had.',
      '',
      `**Keep boosting:** every ${BOOST_REWARD_DAYS} days you stay boosted, another month is added automatically.`,
      '',
      `**Next:** press **Download Premium** on the license panel for the script, then **Generate** to unlock it on your Zen.${licenceLink ? ` ${licenceLink}` : ''}`,
    ].join('\n'),
  };
}

function licenceLink(): string | undefined {
  return env.LICENSE_CHANNEL_ID ? `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${env.LICENSE_CHANNEL_ID}` : undefined;
}

async function ownerLog(client: Client, title: string, description: string, tone: Tone): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;
  try {
    const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [tcpEmbed({ title, description, tone, timestamp: true })], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Boost] Could not write to the log channel');
  }
}

/** Gives a booster their month if one is due, DMs them and tells the owner. Never throws. */
export async function rewardBooster(client: Client, discordUserId: string, why: string): Promise<void> {
  try {
    const result = await grantBoostReward(client, discordUserId, BOOST_REWARD_DAYS, BOOST_REWARD_EVERY_MS);
    if (result.status === 'unavailable') {
      logger.warn(`[TCP Boost] License records not open; ${discordUserId}'s boost reward waits for the next check`);
      return;
    }
    if (result.status === 'too-soon') return;
    // Codes are for Elite Supporters, so the month comes with the role; a booster new to Premium also gets the
    // first-payment welcome (the script by DM and the post in the elite welcome channel).
    const wasElite = await isEliteMember(client, discordUserId);
    await onPremiumPaid(client, discordUserId, !wasElite);
    const text = boostRewardText(result.expiresAt, licenceLink());
    try {
      const user = await client.users.fetch(discordUserId);
      await user.send({ embeds: [tcpEmbed({ title: text.title, description: text.description, tone: 'success' })] });
    } catch (error) {
      logger.info({ err: error }, `[TCP Boost] Could not DM ${discordUserId}`);
    }
    await ownerLog(
      client,
      'Server boost reward',
      `<@${discordUserId}> ${why}: ${BOOST_REWARD_DAYS} days added, license runs until <t:${Math.floor(result.expiresAt / 1000)}:D>.`,
      'success',
    );
  } catch (error) {
    logger.error({ err: error }, `[TCP Boost ERROR] Boost reward failed for ${discordUserId}`);
    // The reward may already be recorded (then the sweep will not retry it), so the owner checks by hand.
    await ownerLog(
      client,
      'Boost reward failed',
      `<@${discordUserId}> ${why}, but adding their ${BOOST_REWARD_DAYS} days failed. Look them up on the owner panel; if their license did not move, use **Add days**.`,
      'danger',
    );
  }
}

/** Server Members Intent on: a member update that starts a boost. */
export async function onMemberUpdate(client: Client, before: GuildMember | PartialGuildMember, member: GuildMember): Promise<void> {
  if (member.guild.id !== env.DISCORD_GUILD_ID || member.user.bot) return;
  if (!startedBoosting(before.premiumSince, member.premiumSince, !before.partial)) return;
  await rewardBooster(client, member.id, 'boosted the server');
}

/** Discord's boost message: works without the Server Members Intent too. */
export async function onBoostMessage(client: Client, message: Message): Promise<void> {
  if (message.guildId !== env.DISCORD_GUILD_ID || message.author.bot) return;
  await rewardBooster(client, message.author.id, 'boosted the server');
}

/** Every 6 hours: each member still boosting whose next month is due gets it. Needs the Server Members Intent. */
export function startBoostRewards(client: Client): void {
  let running = false;
  const run = async () => {
    if (running || !isMemberEventsActive()) return;
    running = true;
    try {
      const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
      const members = await guild.members.fetch();
      for (const member of members.values()) {
        if (member.premiumSince && !member.user.bot) await rewardBooster(client, member.id, 'is still boosting');
      }
    } catch (error) {
      logger.error({ err: error }, '[TCP Boost ERROR] Booster check failed');
    } finally {
      running = false;
    }
  };
  setTimeout(run, FIRST_CHECK_AFTER_MS);
  setInterval(run, CHECK_EVERY_MS);
  logger.info(
    isMemberEventsActive()
      ? '[TCP Boost] Boost rewards on: a month per boost, and every 30 days of boosting (checked every 6 hours).'
      : '[TCP Boost] Boost rewards on from Discord\'s boost messages only; the Server Members Intent is needed for the monthly repeat.',
  );
}
