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

const PREFIX = 'tcp-license:';
export const LICENSE_BUTTON_ID = `${PREFIX}generate`;
export const LICENSE_MODAL_ID = `${PREFIX}modal`;
export const LICENSE_INPUT_ID = `${PREFIX}number`;
// Owner panel. The member being managed travels in the custom ID after the last colon.
export const ADMIN_USER_SELECT_ID = `${PREFIX}admin-user`;
const ADMIN_ADD_ID = `${PREFIX}admin-add:`;
const ADMIN_REVOKE_ID = `${PREFIX}admin-revoke:`;
const ADMIN_DAYS_MODAL_ID = `${PREFIX}admin-days:`;
const ADMIN_DAYS_INPUT_ID = `${PREFIX}days`;

const PANEL_COLOUR = 0x2b8a3e;
const ADMIN_COLOUR = 0x1971c2;
const DAY_MS = 24 * 60 * 60 * 1000;

const licenseKey = parseLicenseKey(env.LICENSE_SECRET);
let store: LicenseStore | null = null;

export function buildLicensePanel() {
  const embed = new EmbedBuilder()
    .setTitle('T.C.P. Licence Generator')
    .setColor(PANEL_COLOUR)
    .setDescription(
      [
        'Unlock your copy of **Tactical Competitive Pro**.',
        '',
        '**1.** Load the script on your Cronus Zen and press X. The screen shows a five-digit number.',
        '**2.** Press **Generate** below and type that number in.',
        '**3.** Enter the six-digit code you get back on the Zen.',
        '',
        'Your code only works with your number, so sharing it will not unlock anyone else.',
        'Every so often the script asks for a new code. Come back here and press **Generate** again.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LICENSE_BUTTON_ID).setLabel('Generate').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export function buildAdminPanel() {
  const embed = new EmbedBuilder()
    .setTitle('T.C.P. Licence Admin')
    .setColor(ADMIN_COLOUR)
    .setDescription('Pick a member to see their subscription, add days, or end their access. Only the owner can use this.');
  const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(ADMIN_USER_SELECT_ID).setPlaceholder('Pick a member').setMinValues(1).setMaxValues(1),
  );
  return { embeds: [embed], components: [row] };
}

async function ensurePanel(client: Client, channelId: string, marker: string, panel: ReturnType<typeof buildLicensePanel> | ReturnType<typeof buildAdminPanel>, label: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      logger.error(`[TCP License ERROR] The ${label} channel is not a text channel.`);
      return;
    }
    const recent = await channel.messages.fetch({ limit: 50 });
    const existing = recent.find((message) => message.author.id === client.user?.id && JSON.stringify(message.components).includes(marker));
    if (existing) {
      // Keep the wording current without posting a second panel.
      await existing.edit(panel);
      logger.info(`[TCP License] ${label} panel already posted; refreshed.`);
      return;
    }
    await channel.send(panel);
    logger.info(`[TCP License] ${label} panel posted.`);
  } catch (error) {
    logger.error({ err: error }, `[TCP License ERROR] Could not post the ${label} panel`);
  }
}

/** Opens the licence records and posts the member and owner panels unless ours are already there. */
export async function ensureLicensePanel(client: Client): Promise<void> {
  if (!env.LICENSE_CHANNEL_ID) {
    logger.info('[TCP License] LICENSE_CHANNEL_ID not set; licence generator disabled.');
    return;
  }
  if (!licenseKey) {
    logger.error('[TCP License ERROR] LICENSE_SECRET is missing or malformed; licence generator disabled.');
    return;
  }
  try {
    const opened = createLicenseStore();
    await opened.init();
    store = opened;
    logger.info(`[TCP License] Records ready (${opened.kind}).`);
    if (opened.kind === 'sqlite' && env.NODE_ENV === 'production') {
      logger.warn('[TCP License] Using the local SQLite file in production; subscriptions will be lost on redeploy. Point DATABASE_URL at Postgres.');
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP License ERROR] Could not open the licence records; licence generator disabled.');
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
    new ButtonBuilder().setCustomId(`${ADMIN_REVOKE_ID}${userId}`).setLabel('End access').setStyle(ButtonStyle.Danger),
  );
}

async function handleAdmin(interaction: Interaction, records: LicenseStore): Promise<boolean> {
  if (!interaction.isUserSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId;
  const isAdmin = id === ADMIN_USER_SELECT_ID || id.startsWith(ADMIN_ADD_ID) || id.startsWith(ADMIN_REVOKE_ID) || id.startsWith(ADMIN_DAYS_MODAL_ID);
  if (!isAdmin) return false;

  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ content: 'Only the owner can use this panel.', ephemeral: true });
    return true;
  }
  const now = Date.now();

  if (interaction.isUserSelectMenu()) {
    const userId = interaction.values[0]!;
    const expiresAt = await records.getExpiry(userId);
    const issuedToday = await records.countCodesSince(userId, now - DAY_MS);
    const embed = new EmbedBuilder()
      .setTitle('Member licence')
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

  if (interaction.isButton() && id.startsWith(ADMIN_REVOKE_ID)) {
    const userId = id.slice(ADMIN_REVOKE_ID.length);
    await records.setExpiry(userId, now);
    logger.info(`[TCP License] Owner ended access for ${userId}`);
    await interaction.reply({
      content: `Access ended for <@${userId}>. They cannot generate new codes. A code already on their Zen keeps working until its power-ups run out.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (interaction.isModalSubmit() && id.startsWith(ADMIN_DAYS_MODAL_ID)) {
    const userId = id.slice(ADMIN_DAYS_MODAL_ID.length);
    const days = parseDays(interaction.fields.getTextInputValue(ADMIN_DAYS_INPUT_ID));
    if (days === null) {
      await interaction.reply({ content: 'Enter a whole number of days between 1 and 3650.', ephemeral: true });
      return true;
    }
    const expiresAt = extendExpiry(await records.getExpiry(userId), days, now);
    await records.setExpiry(userId, expiresAt);
    logger.info(`[TCP License] Owner added ${days} days for ${userId}`);
    await interaction.reply({
      content: `Added ${days} day${days === 1 ? '' : 's'} for <@${userId}>. ${describeSubscription(expiresAt, now)}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }
  return false;
}

/** Handles the licence panels' buttons, menus and forms. Returns true when the interaction was one of ours. */
export async function handleLicenseInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) return false;
  if (!interaction.customId.startsWith(PREFIX)) return false;

  if (!licenseKey || !store) {
    await interaction.reply({ content: 'The licence generator is not set up yet. Please let the owner know.', ephemeral: true });
    return true;
  }
  if (await handleAdmin(interaction, store)) return true;

  if (interaction.isButton() && interaction.customId === LICENSE_BUTTON_ID) {
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
      .setTitle('T.C.P. Licence')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (!interaction.isModalSubmit() || interaction.customId !== LICENSE_MODAL_ID) return false;

  const challenge = parseChallenge(interaction.fields.getTextInputValue(LICENSE_INPUT_ID));
  if (challenge === null) {
    await interaction.reply({
      content: 'That is not the number from the Zen. It is exactly five digits, shown on the lock screen. Press **Generate** to try again.',
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;
  const now = Date.now();
  const isOwner = Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID;

  const days = daysLeft(await store.getExpiry(userId), now);
  // The owner always gets the longest-lasting code, with or without a subscription of their own.
  const tier = isOwner ? 5 : tierForDaysLeft(days);
  if (tier === null) {
    logger.info(`[TCP License] Refused ${userId}: no active subscription`);
    await interaction.editReply('You do not have an active T.C.P. subscription, so no code can be generated. Open a support ticket to get access or renew.');
    return true;
  }

  const alreadyIssued = await store.hasCode(userId, challenge);
  const issuedToday = await store.countCodesSince(userId, now - DAY_MS);
  const decision = decideLicense({ alreadyIssued, issuedToday, maxPerDay: env.LICENSE_MAX_CODES, isOwner });
  if (decision === 'LIMIT') {
    logger.info(`[TCP License] Daily limit reached for ${userId}`);
    await interaction.editReply(`You have generated ${issuedToday} codes in the last day, which is the limit. Try again tomorrow, or open a support ticket.`);
    return true;
  }
  if (decision === 'ISSUE') await store.recordCode(userId, challenge, tier);

  const code = computeLicenseCode(challenge, licenseKey, tier);
  const embed = new EmbedBuilder()
    .setTitle('Your T.C.P. licence code')
    .setColor(PANEL_COLOUR)
    .addFields(
      { name: 'Your number', value: `\`${challenge}\``, inline: true },
      { name: 'Your code', value: `\`${code}\``, inline: true },
    )
    .setDescription(
      [
        'Enter the code on your Zen: Up/Down changes a digit, Left/Right moves along, X confirms.',
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
          content: `Licence generated by <@${userId}> for number \`${challenge}\`: ${TIER_USES[tier]} power-ups, ${isOwner ? 'owner' : `${days} days left`}.`,
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      logger.warn({ err: error }, '[TCP License] Could not write to the log channel');
    }
  }
  return true;
}
