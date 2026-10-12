import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Interaction,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel, repostPanel } from '../bot/panels.js';

// Members share their T.C.P setups through a form; the bot posts each one as a tidy card in
// SETTINGS_CHANNEL_ID and moves its panel back to the bottom so the button stays in view.
const PREFIX = 'tcp-settings:';
export const SETTINGS_BUTTON_ID = `${PREFIX}share`;
const MODAL_ID = `${PREFIX}modal`;
const INPUT_NAME = `${PREFIX}name`;
const INPUT_RECOIL = `${PREFIX}recoil`;
const INPUT_ADS = `${PREFIX}ads`;
const INPUT_INGAME = `${PREFIX}ingame`;
const INPUT_NOTES = `${PREFIX}notes`;

const SETTINGS_COLOUR = 0xe8352b;
export const SHARE_COOLDOWN_MS = 10 * 60 * 1000;
const lastShare = new Map<string, number>();

export interface SettingsShare {
  name: string;
  recoil: string;
  ads: string;
  inGame: string;
  notes: string;
}

/** Checks a submitted setup: a name, the in-game sensitivity, and at least recoil or ADS values. */
export function parseSettingsShare(raw: SettingsShare): { share: SettingsShare } | { error: string } {
  const share = {
    name: raw.name.trim(),
    recoil: raw.recoil.trim(),
    ads: raw.ads.trim(),
    inGame: raw.inGame.trim(),
    notes: raw.notes.trim(),
  };
  if (!share.name) return { error: 'Give your setup a name, for example "Long range M4".' };
  if (!share.inGame) return { error: 'Add your DayZ in-game aiming sensitivity. The values only work with it.' };
  if (!share.recoil && !share.ads) return { error: 'Add your anti-recoil or ADS values (or both).' };
  return { share };
}

/** Minutes until this member may share again, or 0 if they can share now. */
export function cooldownMinutesLeft(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  const left = SHARE_COOLDOWN_MS - (now - last);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function buildSettingsEmbed(share: SettingsShare, author: { name: string; iconURL?: string }): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SETTINGS_COLOUR)
    .setAuthor({ name: author.name, iconURL: author.iconURL })
    .setTitle(share.name)
    .setFooter({ text: 'These values assume the same DayZ sensitivity. Tune from here, one setting at a time.' })
    .setTimestamp();
  const fields = [];
  if (share.recoil) fields.push({ name: 'Anti-Recoil', value: share.recoil });
  if (share.ads) fields.push({ name: 'ADS', value: share.ads });
  fields.push({ name: 'DayZ in-game sensitivity', value: share.inGame });
  if (share.notes) fields.push({ name: 'Notes', value: share.notes });
  return embed.addFields(fields);
}

export function buildSettingsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Share your T.C.P settings')
    .setColor(SETTINGS_COLOUR)
    .setDescription(
      [
        'Found a setup that works? Share it so others can start from it.',
        '',
        'Press **Share my settings** and fill in:',
        '• **Setup name**, for example "Long range M4"',
        '• **Anti-Recoil** values, for example `V 26 / H 0 / Turn 40`',
        '• **ADS** values, for example `Sens 60 / Precision 30 / Easing 12 / Fire Sens 75`',
        '• **DayZ in-game aiming sensitivity**. Settings only carry over between players with similar in-game sensitivity.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SETTINGS_BUTTON_ID).setLabel('Share my settings').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export async function ensureSettingsPanel(client: Client): Promise<void> {
  if (!env.SETTINGS_CHANNEL_ID) {
    logger.info('[TCP Settings] SETTINGS_CHANNEL_ID not set; settings sharing disabled.');
    return;
  }
  await ensurePanel(client, env.SETTINGS_CHANNEL_ID, SETTINGS_BUTTON_ID, buildSettingsPanel(), 'settings');
}

function input(id: string, label: string, style: TextInputStyle, maxLength: number, required: boolean, placeholder: string) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setMaxLength(maxLength)
      .setRequired(required)
      .setPlaceholder(placeholder),
  );
}

export async function handleSettingsInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith(PREFIX)) return false;

  if (!env.SETTINGS_CHANNEL_ID) {
    await interaction.reply({ content: 'Settings sharing is not set up yet.', ephemeral: true });
    return true;
  }
  const wait = cooldownMinutesLeft(lastShare.get(interaction.user.id), Date.now());
  if (wait > 0) {
    await interaction.reply({ content: `You shared a setup recently. You can share another in ${wait} minute${wait === 1 ? '' : 's'}.`, ephemeral: true });
    return true;
  }

  if (interaction.isButton() && interaction.customId === SETTINGS_BUTTON_ID) {
    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle('Share your T.C.P settings')
      .addComponents(
        input(INPUT_NAME, 'Setup name', TextInputStyle.Short, 60, true, 'Long range M4'),
        input(INPUT_RECOIL, 'Anti-Recoil', TextInputStyle.Short, 200, false, 'V 26 / H 0 / Turn 40'),
        input(INPUT_ADS, 'ADS', TextInputStyle.Short, 200, false, 'Sens 60 / Precision 30 / Easing 12 / Fire Sens 75'),
        input(INPUT_INGAME, 'DayZ in-game aiming sensitivity', TextInputStyle.Short, 100, true, 'Vertical 3 / Horizontal 5'),
        input(INPUT_NOTES, 'Notes (optional)', TextInputStyle.Paragraph, 500, false, 'Gun, range, playstyle, anything that helps'),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (!interaction.isModalSubmit() || interaction.customId !== MODAL_ID) return false;

  const parsed = parseSettingsShare({
    name: interaction.fields.getTextInputValue(INPUT_NAME),
    recoil: interaction.fields.getTextInputValue(INPUT_RECOIL),
    ads: interaction.fields.getTextInputValue(INPUT_ADS),
    inGame: interaction.fields.getTextInputValue(INPUT_INGAME),
    notes: interaction.fields.getTextInputValue(INPUT_NOTES),
  });
  if ('error' in parsed) {
    await interaction.reply({ content: parsed.error, ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const channel = await fetchSendableChannel(interaction.client, env.SETTINGS_CHANNEL_ID);
    if (!channel) throw new Error('SETTINGS_CHANNEL_ID is not a text channel');
    const author = { name: interaction.user.displayName ?? interaction.user.username, iconURL: interaction.user.displayAvatarURL() };
    const message = await channel.send({ embeds: [buildSettingsEmbed(parsed.share, author)], allowedMentions: { parse: [] } });
    lastShare.set(interaction.user.id, Date.now());
    logger.info(`[TCP Settings] ${interaction.user.id} shared "${parsed.share.name}"`);
    await repostPanel(interaction.client, channel, SETTINGS_BUTTON_ID, buildSettingsPanel());
    await interaction.editReply(`Thanks! Your setup is posted: ${message.url}`);
  } catch (error) {
    logger.error({ err: error }, '[TCP Settings ERROR] Could not post a shared setup');
    await interaction.editReply('Something went wrong posting your setup. Please try again later.');
  }
  return true;
}
