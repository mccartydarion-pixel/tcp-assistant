import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Interaction,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel } from '../bot/panels.js';
import { plainName } from '../bot/roles.js';
import { notice } from '../bot/embeds.js';
import { LICENSE_BUTTON_ID, memberLicenceEmbed } from '../license/licensePanel.js';
import { manageButton, paymentButtons, paymentsEnabled, planButtons, yearlyPriceText } from '../payments/stripeBilling.js';
import { eliteRole, eliteWelcomeChannel, premiumAvailable, premiumDownloadButton } from './premium.js';

// The Elite Hub: a channel only Elite Supporters (and the owner) can see, with one panel for everything about
// their Premium: their plan, renewing or changing it, the script and their unlock codes. The buttons other than
// My plan are the licence and payment panels' own, so they behave exactly as they do there.
const PREFIX = 'tcp-elite:';
export const ELITE_PLAN_ID = `${PREFIX}plan`;
export const ELITE_HUB_NAME = '💎・elite-hub';
const HUB_COLOUR = 0x9b59ff;

/** A channel name the hub can live in: "elite" and "hub" in it, whatever the emoji or separators. */
export function isEliteHubName(name: string): boolean {
  const plain = plainName(name);
  return plain.includes('elite') && plain.includes('hub');
}

export function buildEliteHubPanel() {
  const yearly = yearlyPriceText();
  const lines = [
    'Everything about your **T.C.P Premium** in one place. Only Elite Supporters can see this channel.',
    '',
    '📋 **My plan:** your days left, when your access ends, and your subscription: monthly or yearly, and whether it renews by itself.',
    ...(paymentsEnabled()
      ? [
          '🔁 **Manage subscription:** renew, cancel, switch between monthly and yearly, or update your card.',
          `➕ **Subscribe${yearly ? ' / Yearly' : ''}:** start your plan again if it has ended${yearly ? `, or go yearly (${yearly})` : ''}. Every payment adds its days to your license.`,
        ]
      : ['🔁 **Renew:** open a support ticket.']),
    ...(premiumAvailable() ? ['⬇️ **Download Premium:** the newest Premium script, sent to you privately.'] : []),
    '🔓 **Generate:** your unlock code. Load the script, press X (A on Xbox) and type the number you see.',
    '',
    '🚀 **Free month:** boost the server and a month is added to your plan, and another every 30 days you stay boosted.',
  ];
  const embed = new EmbedBuilder().setTitle('💎 Elite Supporter Hub').setColor(HUB_COLOUR).setDescription(lines.join('\n'));
  return { embeds: [embed], components: eliteHubRows() };
}

/** My plan and the codes first (what members use most), then the plans, then the account. */
export function eliteHubRows(): ActionRowBuilder<ButtonBuilder>[] {
  const use = [
    new ButtonBuilder().setCustomId(ELITE_PLAN_ID).setLabel('My plan').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(LICENSE_BUTTON_ID).setLabel('Generate').setStyle(ButtonStyle.Success),
    ...(premiumAvailable() ? [premiumDownloadButton()] : []),
  ];
  const manage = manageButton();
  const rows = [use, planButtons(), manage ? [manage] : []];
  return rows.filter((row) => row.length > 0).map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(...row));
}

/** Who can see the hub: the Elite role and the owner read it; nobody but the bot posts in it. */
export function eliteHubPermissions(guild: Guild, roleId: string, botId: string, ownerId?: string): OverwriteResolvable[] {
  const read = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  // Each entry says whether it is a role or a member: discord.js cannot tell from a bare ID unless that member
  // happens to be cached (the owner usually is not at startup).
  return [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: roleId, type: OverwriteType.Role, allow: read, deny: [PermissionFlagsBits.SendMessages] },
    {
      id: botId,
      type: OverwriteType.Member,
      allow: [...read, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages],
    },
    ...(ownerId ? [{ id: ownerId, type: OverwriteType.Member, allow: read }] : []),
  ];
}

/** ELITE_HUB_CHANNEL_ID, else an "elite hub" text channel, else a new one beside the elite welcome channel. */
async function hubChannel(client: Client): Promise<TextChannel | null> {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
  await guild.channels.fetch();
  if (env.ELITE_HUB_CHANNEL_ID) {
    const set = guild.channels.cache.get(env.ELITE_HUB_CHANNEL_ID);
    return set && set.type === ChannelType.GuildText ? set : null;
  }
  const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && isEliteHubName(c.name));
  if (found && found.type === ChannelType.GuildText) return found;

  await guild.roles.fetch();
  const role = eliteRole(guild);
  if (!role || !client.user) {
    logger.warn('[TCP Elite] No Elite Supporter role found, so the Elite Hub was not created (it would not be private).');
    return null;
  }
  const created = await guild.channels.create({
    name: ELITE_HUB_NAME,
    type: ChannelType.GuildText,
    parent: eliteWelcomeChannel(guild)?.parentId ?? undefined,
    topic: 'Your T.C.P Premium: your plan, renewing, the script and your unlock codes.',
    permissionOverwrites: eliteHubPermissions(guild, role.id, client.user.id, env.OWNER_USER_ID),
    reason: 'T.C.P Elite Hub for Elite Supporters',
  });
  logger.info(`[TCP Elite] Created the Elite Hub channel (${created.id}).`);
  return created;
}

/** Startup: finds or creates the Elite Hub and posts (or refreshes) its panel. Never throws. */
export async function ensureEliteHub(client: Client): Promise<void> {
  try {
    const channel = await hubChannel(client);
    if (!channel) return;
    await ensurePanel(client, channel.id, ELITE_PLAN_ID, buildEliteHubPanel(), 'Elite Hub');
  } catch (error) {
    logger.error({ err: error }, '[TCP Elite ERROR] Could not set up the Elite Hub; check the bot has Manage Channels.');
  }
}

/** My plan: the member's licence and subscription, privately, with the plan buttons. */
export async function handleEliteInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || interaction.customId !== ELITE_PLAN_ID) return false;
  await interaction.deferReply({ ephemeral: true });
  const embed = await memberLicenceEmbed(interaction.user.id, 'Your plan');
  const payments = paymentButtons();
  await interaction.editReply({
    embeds: embed ? [embed] : notice('Your plan cannot be shown right now. Please try again in a moment.', { tone: 'muted' }).embeds,
    components: payments ? [payments] : [],
  });
  return true;
}
