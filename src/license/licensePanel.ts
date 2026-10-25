import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Client,
  type Interaction,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  TIER_USES,
  computeLicenseCode,
  daysLeft,
  decideLicense,
  extendExpiry,
  parseChallenge,
  parseDays,
  parseLicenseKey,
  tierForDaysLeft,
} from './licenseCode.js';
import { createLicenseStore, type LicenseStore } from './licenseStore.js';
import { codeLine, isOnTrial, joinLines, subscriptionLine, summarizeSubscriptions } from './ownerReports.js';
import { describeMemberLicence } from './memberLicence.js';
import { startReminderLoop } from './reminders.js';
import { ensurePanel } from '../bot/panels.js';
import { notice } from '../bot/embeds.js';
import { ANNOUNCE_BUTTON_ID, ANNOUNCE_FLYER_BUTTON_ID } from '../owner/announcer.js';
import { manageButton, paymentButtons, paymentsEnabled, planButtons, priceText, renewsAutomatically, subscriptionSummary, yearlyPriceText } from '../payments/stripeBilling.js';
import { eliteRoleName, isEliteMember, premiumAvailable, premiumDownloadButton, setEliteRole } from '../premium/premium.js';

const PREFIX = 'tcp-license:';
export const LICENSE_BUTTON_ID = `${PREFIX}generate`;
export const LICENSE_MODAL_ID = `${PREFIX}modal`;
export const LICENSE_INPUT_ID = `${PREFIX}number`;
const MY_LICENCE_ID = `${PREFIX}mine`;
// Owner panel. The member being managed travels in the custom ID after the last colon.
export const ADMIN_USER_SELECT_ID = `${PREFIX}admin-user`;
const ADMIN_ADD_ID = `${PREFIX}admin-add:`;
const ADMIN_REVOKE_ID = `${PREFIX}admin-revoke:`;
const ADMIN_RESET_CODES_ID = `${PREFIX}admin-reset-codes:`;
const ADMIN_DAYS_MODAL_ID = `${PREFIX}admin-days:`;
const ADMIN_DAYS_INPUT_ID = `${PREFIX}days`;
const ADMIN_ACTIVE_ID = `${PREFIX}admin-active`;
const ADMIN_EXPIRING_ID = `${PREFIX}admin-expiring`;
const ADMIN_CODES_ID = `${PREFIX}admin-codes`;
const RECENT_CODES = 20;

const PANEL_COLOUR = 0x2b8a3e;
const ADMIN_COLOUR = 0x1971c2;
const DAY_MS = 24 * 60 * 60 * 1000;
// A member who makes codes for this many different Zens within the window is flagged to the owner.
const SHARING_WINDOW_MS = 7 * DAY_MS;
const SHARING_ALERT_ZENS = 3;

const licenseKey = parseLicenseKey(env.LICENSE_SECRET);
let store: LicenseStore | null = null;

export function buildLicensePanel() {
  const embed = new EmbedBuilder()
    .setTitle('T.C.P. License Generator')
    .setColor(PANEL_COLOUR)
    .setDescription(
      [
        'Unlock your copy of **Tactical Competitive Pro**.',
        '',
        '**1.** Load the script on your Cronus Zen and press X (A on an Xbox controller). The screen shows a five-digit number.',
        '**2.** Press **Generate** below and type that number in.',
        '**3.** Enter the six-digit code you get back on the Zen.',
        '',
        'Your code only works with your number, so sharing it will not unlock anyone else.',
        'Every so often the script asks for a new code. Come back here and press **Generate** again.',
        '',
        'Codes are for **Elite Supporters** only.',
        'Press **My license** any time to see how many days you have left.',
        ...(paymentsEnabled()
          ? [
              '',
              `**T.C.P Premium${priceText() ? `: ${[priceText(), yearlyPriceText()].filter(Boolean).join(' or ')}` : ''}.** Press **Subscribe**${yearlyPriceText() ? ' (or **Yearly**)' : ''} to become an Elite Supporter: you get the role, the Premium script in your DMs and your codes. Every payment adds days to your license automatically; cancel any time with **Manage subscription**.`,
            ]
          : []),
      ].join('\n'),
    );
  return { embeds: [embed], components: licencePanelRows() };
}

/**
 * The panel's buttons, one purpose per row: what members use (green), the plans (blue), their account (grey).
 * Rows without buttons are left out, so with payments off it is Generate and My licence.
 */
export function licencePanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  const use = [
    new ButtonBuilder().setCustomId(LICENSE_BUTTON_ID).setLabel('Generate').setStyle(ButtonStyle.Success),
    ...(paymentsEnabled() && premiumAvailable() ? [premiumDownloadButton()] : []),
  ];
  const plans = planButtons();
  const manage = manageButton();
  const account = [new ButtonBuilder().setCustomId(MY_LICENCE_ID).setLabel('My license').setStyle(ButtonStyle.Secondary), ...(manage ? [manage] : [])];
  return [use, plans, account].filter((row) => row.length > 0).map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(...row));
}

/** How a member renews: Subscribe when payments are on, else a ticket. */
function renewHint(): string {
  return paymentsEnabled() ? 'Press **Subscribe** on the license panel to renew.' : 'Open a support ticket to renew.';
}

/**
 * Adds paid days to a member's licence (a Stripe payment) and gives them the member role. Returns the new
 * end of their access, or null when the licence records are not open yet (Stripe then retries).
 */
export async function grantPaidDays(client: Client, discordUserId: string, days: number): Promise<number | null> {
  if (!store) return null;
  const now = Date.now();
  const expiresAt = extendExpiry(await store.getExpiry(discordUserId), days, now);
  await store.setExpiry(discordUserId, expiresAt);
  logger.info(`[TCP License] Payment added ${days} days for ${discordUserId}`);
  await giveLicensedRole(client, discordUserId);
  return expiresAt;
}

export type BoostGrant = { status: 'granted'; expiresAt: number } | { status: 'too-soon' } | { status: 'unavailable' };

/**
 * A server-boost reward: adds `days` to a member's licence (on top of the days they have, or from now) and gives
 * them the member role, unless they had a boost reward less than `everyMs` ago. 'unavailable' when the licence
 * records are not open yet, so a later check can try again.
 */
export async function grantBoostReward(client: Client, discordUserId: string, days: number, everyMs: number): Promise<BoostGrant> {
  if (!store) return { status: 'unavailable' };
  const now = Date.now();
  if (!(await store.claimBoostReward(discordUserId, now, everyMs))) return { status: 'too-soon' };
  const expiresAt = extendExpiry(await store.getExpiry(discordUserId), days, now);
  await store.setExpiry(discordUserId, expiresAt);
  logger.info(`[TCP License] Server boost added ${days} days for ${discordUserId}`);
  await giveLicensedRole(client, discordUserId, 'T.C.P Premium server boost');
  return { status: 'granted', expiresAt };
}

/** After a payment or a boost reward: the role in LICENSE_MEMBER_ROLE_ID, if set. Best effort. */
async function giveLicensedRole(client: Client, discordUserId: string, reason = 'T.C.P Premium payment'): Promise<void> {
  if (!env.LICENSE_MEMBER_ROLE_ID) return;
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const member = await guild.members.fetch(discordUserId);
    if (!member.roles.cache.has(env.LICENSE_MEMBER_ROLE_ID)) await member.roles.add(env.LICENSE_MEMBER_ROLE_ID, reason);
  } catch (error) {
    logger.warn({ err: error }, '[TCP License] Could not give the member role (left the server, or Manage Roles missing).');
  }
}

/**
 * Extends a member's licence to at least the given time (a plan change paid in Stripe) and gives them the
 * member role. The new end and the whole days added, or null when the licence records are not open yet.
 */
export async function grantPaidUntil(client: Client, discordUserId: string, until: number): Promise<{ expiresAt: number; addedDays: number } | null> {
  if (!store) return null;
  const now = Date.now();
  const current = await store.getExpiry(discordUserId);
  const from = Math.max(now, current ?? now);
  if (until <= from) return { expiresAt: Math.max(current ?? now, until), addedDays: 0 };
  await store.setExpiry(discordUserId, until);
  logger.info(`[TCP License] Plan change extended ${discordUserId} to ${new Date(until).toISOString()}`);
  await giveLicensedRole(client, discordUserId);
  return { expiresAt: until, addedDays: Math.round((until - from) / DAY_MS) };
}

export function buildAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('T.C.P. License Admin')
    .setColor(ADMIN_COLOUR)
    .setDescription(
      [
        '**Members:** pick one below to see their subscription, add days, or end their access.',
        '**Reports:** who is subscribed, who runs out this week, and the latest codes.',
        '**Announce:** post patch notes to the announcement channel, with or without the flyer.',
        '',
        'Only the owner can use this panel.',
      ].join('\n'),
    );
  const members = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(ADMIN_USER_SELECT_ID).setPlaceholder('Pick a member').setMinValues(1).setMaxValues(1),
  );
  const reports = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ADMIN_ACTIVE_ID).setLabel('Active subscriptions').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ADMIN_EXPIRING_ID).setLabel('Expiring this week').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ADMIN_CODES_ID).setLabel('Recent codes').setStyle(ButtonStyle.Secondary),
  );
  const announce = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ANNOUNCE_BUTTON_ID).setLabel('Post announcement').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ANNOUNCE_FLYER_BUTTON_ID).setLabel('Post announcement + flyer').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [members, reports, announce] };
}

/** Opens the licence records and posts the member and owner panels unless ours are already there. */
/** Redraws the member panel, for example after a Premium upload adds Download Premium. Never posts a new one. */
export async function refreshLicensePanel(client: Client): Promise<void> {
  if (!env.LICENSE_CHANNEL_ID || !store) return;
  await ensurePanel(client, env.LICENSE_CHANNEL_ID, LICENSE_BUTTON_ID, buildLicensePanel(), 'generator', { postIfMissing: false });
}

export async function ensureLicensePanel(client: Client): Promise<void> {
  if (!env.LICENSE_CHANNEL_ID) {
    logger.info('[TCP License] LICENSE_CHANNEL_ID not set; license generator disabled.');
    return;
  }
  if (!licenseKey) {
    logger.error('[TCP License ERROR] LICENSE_SECRET is missing or malformed; license generator disabled.');
    return;
  }
  try {
    const opened = createLicenseStore();
    await opened.init();
    store = opened;
    logger.info(`[TCP License] Records ready (${opened.kind}).`);
    if (env.LICENSE_REMINDERS !== 'false') {
      startReminderLoop(client, opened, {
        ownerId: env.OWNER_USER_ID,
        trialDays: env.LICENSE_TRIAL_DAYS,
        guildId: env.DISCORD_GUILD_ID,
        licenceChannelId: env.LICENSE_CHANNEL_ID,
        renewsAutomatically,
        canSubscribe: paymentsEnabled,
      });
    }
    if (opened.kind === 'sqlite' && env.NODE_ENV === 'production') {
      logger.warn('[TCP License] Using the local SQLite file in production; subscriptions will be lost on redeploy. Point DATABASE_URL at Postgres.');
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP License ERROR] Could not open the license records; license generator disabled.');
    return;
  }

  await ensurePanel(client, env.LICENSE_CHANNEL_ID, LICENSE_BUTTON_ID, buildLicensePanel(), 'generator');
  if (!env.LICENSE_ADMIN_CHANNEL_ID) {
    logger.warn('[TCP License] LICENSE_ADMIN_CHANNEL_ID not set; there is no way to give members days yet.');
  } else if (!env.OWNER_USER_ID) {
    logger.warn('[TCP License] OWNER_USER_ID not set; the owner panel is disabled.');
  } else {
    await ensurePanel(client, env.LICENSE_ADMIN_CHANNEL_ID, ADMIN_USER_SELECT_ID, buildAdminPanel(), 'owner');
  }
}

/** Since when a member's codes count toward the daily limit and the sharing alert: the window's start, or the
 *  owner's last Reset code usage if that is later. */
async function usageSince(records: LicenseStore, userId: string, since: number): Promise<number> {
  return Math.max(since, await records.codeUsageResetAt(userId));
}

function describeSubscription(expiresAt: number | null, now: number): string {
  const days = daysLeft(expiresAt, now);
  if (expiresAt === null) return 'No subscription.';
  const when = `<t:${Math.floor(expiresAt / 1000)}:D>`;
  if (days <= 0) return `Expired ${when}.`;
  return `${days} day${days === 1 ? '' : 's'} left (until ${when}).`;
}

function adminButtons(userId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${ADMIN_ADD_ID}${userId}`).setLabel('Add days').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${ADMIN_RESET_CODES_ID}${userId}`).setLabel('Reset code usage').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${ADMIN_REVOKE_ID}${userId}`).setLabel('End access').setStyle(ButtonStyle.Danger),
  );
}

async function handleAdmin(interaction: Interaction, records: LicenseStore): Promise<boolean> {
  if (!interaction.isUserSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId;
  const isReport = id === ADMIN_ACTIVE_ID || id === ADMIN_EXPIRING_ID || id === ADMIN_CODES_ID;
  const isAdmin =
    isReport ||
    id === ADMIN_USER_SELECT_ID ||
    id.startsWith(ADMIN_ADD_ID) ||
    id.startsWith(ADMIN_REVOKE_ID) ||
    id.startsWith(ADMIN_RESET_CODES_ID) ||
    id.startsWith(ADMIN_DAYS_MODAL_ID);
  if (!isAdmin) return false;

  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this panel.', { tone: 'danger' }), ephemeral: true });
    return true;
  }
  const now = Date.now();

  if (interaction.isButton() && isReport) {
    await interaction.deferReply({ ephemeral: true });
    const embed = new EmbedBuilder().setColor(ADMIN_COLOUR).setTimestamp();
    if (id === ADMIN_CODES_ID) {
      const codes = await records.listRecentCodes(RECENT_CODES);
      embed.setTitle(`Recent codes (latest ${RECENT_CODES})`).setDescription(joinLines(codes.map(codeLine), 'No codes have been generated yet.'));
    } else {
      const summary = summarizeSubscriptions(await records.listSubscriptions(), now, env.LICENSE_TRIAL_DAYS);
      const rows = id === ADMIN_EXPIRING_ID ? summary.expiringSoon : summary.active;
      const lines = rows.map((row) => subscriptionLine(row, now, env.LICENSE_TRIAL_DAYS));
      if (id === ADMIN_EXPIRING_ID) {
        embed.setTitle(`Expiring this week: ${rows.length}`).setDescription(joinLines(lines, 'Nobody runs out in the next 7 days.'));
      } else {
        embed
          .setTitle(`Active subscriptions: ${summary.active.length}`)
          .setDescription(joinLines(lines, 'No active subscriptions.'))
          .setFooter({ text: `${summary.trialCount} on the free trial · ${summary.expiredCount} expired` });
      }
    }
    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  if (interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const expiresAt = await records.getExpiry(userId);
    const issuedToday = await records.countCodesSince(userId, await usageSince(records, userId, now - DAY_MS));
    const embed = new EmbedBuilder()
      .setTitle('Member license')
      .setColor(ADMIN_COLOUR)
      .setDescription(`<@${userId}>\n${describeSubscription(expiresAt, now)}\nCodes generated in the last day: ${issuedToday}`);
    await interaction.reply({ embeds: [embed], components: [adminButtons(userId)], ephemeral: true });
    return true;
  }

  if (interaction.isButton() && id.startsWith(ADMIN_ADD_ID)) {
    const userId = id.slice(ADMIN_ADD_ID.length);
    const input = new TextInputBuilder()
      .setCustomId(ADMIN_DAYS_INPUT_ID)
      .setLabel('Days to add')
      .setPlaceholder('For example 30')
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(4)
      .setRequired(true);
    const modal = new ModalBuilder()
      .setCustomId(`${ADMIN_DAYS_MODAL_ID}${userId}`)
      .setTitle('Add subscription days')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isButton() && id.startsWith(ADMIN_RESET_CODES_ID)) {
    const userId = id.slice(ADMIN_RESET_CODES_ID.length);
    await records.resetCodeUsage(userId, now);
    logger.info(`[TCP License] Owner reset the code usage of ${userId}`);
    await interaction.reply({
      ...notice(
        `Code usage reset for <@${userId}>. Their daily count is back to 0, so they can generate codes again now (up to ${env.LICENSE_MAX_CODES} in the next day), and the 7-day code-sharing check starts again from now. The codes they already have keep working, and they stay in **Recent codes**. A Zen's own power-up count lives on the Zen: a new code gives it a full count.`,
        { title: 'Code usage reset', tone: 'success' },
      ),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (interaction.isButton() && id.startsWith(ADMIN_REVOKE_ID)) {
    const userId = id.slice(ADMIN_REVOKE_ID.length);
    await records.setExpiry(userId, now);
    const roleTaken = await setEliteRole(interaction.client, userId, false, 'Owner ended access');
    logger.info(`[TCP License] Owner ended access for ${userId}`);
    const roleNote = roleTaken ? ` The ${eliteRoleName(interaction.client)} role was taken away.` : '';
    const stripeNote = (await renewsAutomatically(userId)) ? ' They still have a Stripe subscription: cancel it in Stripe, or their next payment gives access back.' : '';
    await interaction.reply({
      ...notice(`Access ended for <@${userId}>. They cannot generate new codes. A code already on their Zen keeps working until its power-ups run out.${roleNote}${stripeNote}`, {
        title: 'Access ended',
        tone: 'danger',
      }),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (interaction.isModalSubmit() && id.startsWith(ADMIN_DAYS_MODAL_ID)) {
    const userId = id.slice(ADMIN_DAYS_MODAL_ID.length);
    const days = parseDays(interaction.fields.getTextInputValue(ADMIN_DAYS_INPUT_ID));
    if (days === null) {
      await interaction.reply({ ...notice('Enter a whole number of days between 1 and 3650.', { tone: 'warning' }), ephemeral: true });
      return true;
    }
    const expiresAt = extendExpiry(await records.getExpiry(userId), days, now);
    await records.setExpiry(userId, expiresAt);
    // Codes are for Elite Supporters, so days the owner gives come with the role.
    const roleGiven = await setEliteRole(interaction.client, userId, true, 'Owner added days');
    logger.info(`[TCP License] Owner added ${days} days for ${userId}`);
    const roleNote = roleGiven
      ? ` They have the ${eliteRoleName(interaction.client)} role.`
      : ` Could not give them the ${eliteRoleName(interaction.client)} role, so they cannot generate yet: give it by hand.`;
    await interaction.reply({
      ...notice(`Added ${days} day${days === 1 ? '' : 's'} for <@${userId}>. ${describeSubscription(expiresAt, now)}${roleNote}`, { title: 'Days added', tone: 'success' }),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }
  return false;
}

/** Only Elite Supporters and the owner can generate codes. */
async function mayGenerate(client: Client, userId: string): Promise<boolean> {
  if (env.OWNER_USER_ID && userId === env.OWNER_USER_ID) return true;
  return isEliteMember(client, userId);
}

function eliteOnlyReply(client: Client) {
  const role = eliteRoleName(client);
  const payments = paymentButtons();
  return {
    ...notice(
      paymentsEnabled()
        ? `Unlock codes are for **${role}s** (T.C.P Premium members). Press **Subscribe** to join: you get the role, the Premium script in your DMs and your codes.`
        : `Unlock codes are for **${role}s** (T.C.P Premium members). Open a support ticket to join.`,
      { title: `${role}s only`, tone: 'muted' },
    ),
    components: payments ? [payments] : [],
  };
}

/**
 * Tells the owner when a member has made codes for several different Zens in a week: a sign they are
 * handing codes to friends. Every new number after the limit is flagged again. Never throws.
 */
async function flagSharing(client: Client, records: LicenseStore, userId: string, now: number): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;
  try {
    const codes = await records.listCodesSince(userId, await usageSince(records, userId, now - SHARING_WINDOW_MS));
    if (codes.length < SHARING_ALERT_ZENS) return;
    logger.warn(`[TCP License] ${userId} has made codes for ${codes.length} different Zens in 7 days`);
    const channel = await client.channels.fetch(env.LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return;
    const numbers = codes.map((code) => `\`${code.challenge}\` <t:${Math.floor(code.createdAt / 1000)}:R>`).join('\n');
    await channel.send({
      ...notice(
        `<@${userId}> has generated codes for **${codes.length} different Zens** in the last 7 days. One player rarely needs more than one or two, so they may be sharing codes.\n\n${numbers}\n\nUse **End access** on the owner panel if they are.`,
        { title: 'Possible code sharing', tone: 'warning' },
      ),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn({ err: error }, '[TCP License] Could not flag possible code sharing');
  }
}

/** Give the member the licensed-member role. Best effort: needs Manage Roles and the right hierarchy. */
async function grantMemberRole(interaction: Interaction, userId: string): Promise<void> {
  if (!env.LICENSE_MEMBER_ROLE_ID || !interaction.guild) return;
  try {
    const member = await interaction.guild.members.fetch(userId);
    if (!member.roles.cache.has(env.LICENSE_MEMBER_ROLE_ID)) {
      await member.roles.add(env.LICENSE_MEMBER_ROLE_ID);
      logger.info(`[TCP License] Gave the member role to ${userId}`);
    }
  } catch (error) {
    logger.warn(
      { err: error },
      '[TCP License] Could not assign the member role; check the bot has Manage Roles and its own role sits above the member role.',
    );
  }
}

/**
 * A member's licence as an embed: days left, power-ups a new code would get, codes used. For the My licence
 * button and for licence tickets. Null when the licence records are not open.
 */
export async function memberLicenceEmbed(userId: string, heading: string): Promise<EmbedBuilder | null> {
  if (!store) return null;
  const now = Date.now();
  const subscription = await store.getSubscription(userId);
  const summary = describeMemberLicence({
    expiresAt: subscription?.expiresAt ?? null,
    hadTrial: subscription?.trialGrantedAt != null,
    onTrial: subscription !== null && isOnTrial(subscription, env.LICENSE_TRIAL_DAYS),
    codesToday: await store.countCodesSince(userId, await usageSince(store, userId, now - DAY_MS)),
    maxPerDay: env.LICENSE_MAX_CODES,
    latest: await store.latestCodeFor(userId),
    now,
    isOwner: Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID,
    renewHint: renewHint(),
    joinHint: paymentsEnabled() ? 'Press **Subscribe** on the license panel to join.' : 'Open a support ticket to join.',
  });
  const payment = await subscriptionSummary(userId);
  return new EmbedBuilder()
    .setTitle(`${heading}: ${summary.title}`)
    .setColor(summary.active ? PANEL_COLOUR : 0x868e96)
    .setDescription([...summary.lines, ...(payment ? ['', `**Subscription:** ${payment}`] : [])].join('\n'));
}

/** Handles the licence panels' buttons, menus and forms. Returns true when the interaction was one of ours. */
export async function handleLicenseInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) return false;
  if (!interaction.customId.startsWith(PREFIX)) return false;

  if (!licenseKey || !store) {
    await interaction.reply({ ...notice('The license generator is not set up yet. Please let the owner know.', { tone: 'muted' }), ephemeral: true });
    return true;
  }
  if (await handleAdmin(interaction, store)) return true;

  if (interaction.isButton() && interaction.customId === MY_LICENCE_ID) {
    await interaction.deferReply({ ephemeral: true });
    const embed = await memberLicenceEmbed(interaction.user.id, 'Your license');
    const payments = paymentButtons();
    await interaction.editReply({
      embeds: embed ? [embed] : notice('The license generator is not set up yet.', { tone: 'muted' }).embeds,
      components: payments ? [payments] : [],
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === LICENSE_BUTTON_ID) {
    if (!(await mayGenerate(interaction.client, interaction.user.id))) {
      await interaction.reply({ ...eliteOnlyReply(interaction.client), ephemeral: true });
      return true;
    }
    const input = new TextInputBuilder()
      .setCustomId(LICENSE_INPUT_ID)
      .setLabel('Number shown on your Zen')
      .setPlaceholder('5 digits, for example 48213')
      .setStyle(TextInputStyle.Short)
      .setMinLength(5)
      .setMaxLength(7)
      .setRequired(true);
    const modal = new ModalBuilder()
      .setCustomId(LICENSE_MODAL_ID)
      .setTitle('T.C.P. License')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (!interaction.isModalSubmit() || interaction.customId !== LICENSE_MODAL_ID) return false;

  const challenge = parseChallenge(interaction.fields.getTextInputValue(LICENSE_INPUT_ID));
  if (challenge === null) {
    await interaction.reply({
      ...notice('That is not the number from the Zen. It is exactly five digits, shown on the lock screen. Press **Generate** to try again.', {
        tone: 'warning',
      }),
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;
  const now = Date.now();
  const isOwner = Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID;

  // Codes are for Elite Supporters. Checked again here: the role may have gone while the form was open.
  if (!(await mayGenerate(interaction.client, userId))) {
    logger.info(`[TCP License] Refused ${userId}: not an Elite Supporter`);
    await interaction.editReply(eliteOnlyReply(interaction.client));
    return true;
  }
  const days = daysLeft(await store.getExpiry(userId), now);

  // The owner always gets the longest-lasting code, with or without a subscription of their own.
  const tier = isOwner ? 5 : tierForDaysLeft(days);
  if (tier === null) {
    logger.info(`[TCP License] Refused ${userId}: no days left`);
    const payments = paymentButtons();
    await interaction.editReply({
      ...notice(`Your T.C.P Premium days have run out, so no new code can be generated. ${renewHint()}`, {
        title: 'Subscription ended',
        tone: 'muted',
      }),
      components: payments ? [payments] : [],
    });
    return true;
  }

  // Mark them as a licensed member in the server.
  await grantMemberRole(interaction, userId);

  const alreadyIssued = await store.hasCode(userId, challenge);
  const issuedToday = await store.countCodesSince(userId, await usageSince(store, userId, now - DAY_MS));
  const decision = decideLicense({ alreadyIssued, issuedToday, maxPerDay: env.LICENSE_MAX_CODES, isOwner });
  if (decision === 'LIMIT') {
    logger.info(`[TCP License] Daily limit reached for ${userId}`);
    await interaction.editReply(
      notice(`You have generated ${issuedToday} codes in the last day, which is the limit. Try again tomorrow, or open a support ticket.`, { tone: 'warning' }),
    );
    return true;
  }
  if (decision === 'ISSUE') await store.recordCode(userId, challenge, tier);
  if (decision === 'ISSUE' && !isOwner) await flagSharing(interaction.client, store, userId, now);

  const code = computeLicenseCode(challenge, licenseKey, tier);
  const embed = new EmbedBuilder()
    .setTitle('Your T.C.P. license code')
    .setColor(PANEL_COLOUR)
    .addFields(
      { name: 'Your number', value: `\`${challenge}\``, inline: true },
      { name: 'Your code', value: `\`${code}\``, inline: true },
    )
    .setDescription(
      [
        'Enter the code on your Zen: Up/Down changes a digit, Left/Right moves along, X confirms (A on an Xbox controller).',
        '',
        `This code lasts **${TIER_USES[tier]} power-ups** of the script. After that the Zen shows a new number; come back and press **Generate** again.`,
      ].join('\n'),
    )
    .setFooter({ text: isOwner ? 'Owner' : `Subscription: ${days} day${days === 1 ? '' : 's'} left` });
  await interaction.editReply({ embeds: [embed] });
  logger.info(`[TCP License] ${decision === 'REISSUE' ? 'Re-sent' : 'Issued'} tier ${tier} code to ${userId} for number ${challenge}`);

  if (decision === 'ISSUE' && env.LOG_CHANNEL_ID) {
    try {
      const logChannel = await interaction.client.channels.fetch(env.LOG_CHANNEL_ID);
      if (logChannel && logChannel.isTextBased() && 'send' in logChannel) {
        await logChannel.send({
          ...notice(`License generated by <@${userId}> for number \`${challenge}\`: ${TIER_USES[tier]} power-ups, ${isOwner ? 'owner' : `${days} days left`}.`, {
            tone: 'success',
          }),
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      logger.warn({ err: error }, '[TCP License] Could not write to the log channel');
    }
  }
  return true;
}
