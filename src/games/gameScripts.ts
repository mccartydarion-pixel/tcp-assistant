import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Interaction } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel, findPanel } from '../bot/panels.js';

// One showcase per game: an embed with the T.C.P banner, what the script does, and a Download link button,
// in that game's own channel. To add a game, add an entry to GAME_SCRIPTS and redeploy.
const PREFIX = 'tcp-game:';
const INSTALL_PREFIX = `${PREFIX}install:`;
const GAME_COLOUR = 0xe8352b;
const BANNER_NAME = 'tcp-banner.png';
const BANNER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', BANNER_NAME);

export interface GameScript {
  /** Short ID used in button IDs; never change it once posted. */
  key: string;
  game: string;
  channelId: string;
  downloadUrl: string;
  summary: string;
  features: { name: string; value: string }[];
  details: { name: string; value: string }[];
}

export const GAME_SCRIPTS: GameScript[] = [
  {
    key: 'dayz',
    game: 'DayZ',
    channelId: '1559405473000591411',
    downloadUrl: 'https://gpclib.cmindapi.com/gpc-library/13905',
    summary:
      "The all-in-one DayZ script for Cronus Zen. Anti-recoil, ADS accuracy and movement tools, all tuned from a 26-page menu on the Zen's own screen.",
    features: [
      {
        name: 'Anti-Recoil',
        value: 'Vertical and horizontal control that eases off when you flick and comes back when you settle. **Calibrate Recoil** sets it from one burst.',
      },
      { name: 'ADS Accuracy 2.0', value: 'ADS Sens, Steady Hold, Precision, Easing, Fire Sens and two ADS profiles you can swap between.' },
      { name: 'Movement', value: 'Drop / Crouch Shot, Lean Spam, Follow Lean, Auto Run, Automatic Aim and Auto Movement (moonwalk).' },
      { name: 'Controller', value: 'Hair Triggers, Deadzone and Anti Deadzone.' },
    ],
    details: [
      { name: 'Device', value: 'Cronus Zen' },
      { name: 'Controllers', value: 'PlayStation and Xbox' },
      { name: 'Menu', value: 'On the Zen screen' },
    ],
  },
];

export function findGame(key: string): GameScript | undefined {
  return GAME_SCRIPTS.find((game) => game.key === key);
}

function buildGameEmbed(game: GameScript, withBanner: boolean): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(GAME_COLOUR)
    .setAuthor({ name: 'Tactical Competitive Pro' })
    .setTitle(`T.C.P for ${game.game}`)
    .setURL(game.downloadUrl)
    .setDescription([game.summary, '', 'Press **Download** and sign in to the GPC Library with Discord to get it.'].join('\n'))
    .addFields(
      ...game.features.map((feature) => ({ name: feature.name, value: feature.value })),
      ...game.details.map((detail) => ({ name: detail.name, value: detail.value, inline: true })),
    )
    .setFooter({ text: `T.C.P · ${game.game}` });
  if (withBanner) embed.setImage(`attachment://${BANNER_NAME}`);
  return embed;
}

/** A short fingerprint of what the showcase says, so it is only reposted when it changes. */
export function panelStamp(embed: EmbedBuilder, downloadUrl: string): string {
  return createHash('sha1').update(JSON.stringify(embed.toJSON())).update(downloadUrl).digest('hex').slice(0, 10);
}

/** The showcase message, and the ID of its install button, which carries the fingerprint. */
export function buildGamePanel(game: GameScript, withBanner: boolean) {
  const embed = buildGameEmbed(game, withBanner);
  const installId = `${INSTALL_PREFIX}${game.key}:${panelStamp(embed, game.downloadUrl)}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Download').setStyle(ButtonStyle.Link).setURL(game.downloadUrl),
    new ButtonBuilder().setCustomId(installId).setLabel('How to install').setStyle(ButtonStyle.Secondary),
  );
  return { installId, message: { embeds: [embed], components: [row] } };
}

export function installGuide(game: GameScript, channels: { licence?: string; bugs?: string }): string {
  return [
    `**Installing T.C.P for ${game.game}**`,
    '`1` Press **Download** and sign in to the GPC Library with Discord.',
    '`2` Add the script to Zen Studio and program it to a slot on your Cronus Zen.',
    channels.licence
      ? `\`3\` Load that slot. If it shows a lock screen, press **X** (**A** on Xbox) and get your code in <#${channels.licence}>.`
      : '`3` Load that slot on the Zen.',
    '`4` Open the menu with **L2** + **OPTIONS** (**LT** + **Menu** on Xbox) and tune it from there.',
    '',
    channels.bugs
      ? `Stuck? Mention **@T.C.P. Assistant** with your question, or report a bug in <#${channels.bugs}>.`
      : 'Stuck? Mention **@T.C.P. Assistant** with your question.',
  ].join('\n');
}

/** Posts each game's showcase in its channel, replacing the bot's old one only when the wording changed. */
export async function ensureGamePanels(client: Client): Promise<void> {
  const withBanner = existsSync(BANNER_PATH);
  if (!withBanner) logger.warn(`[TCP Games] ${BANNER_NAME} is missing from assets; posting without the banner.`);
  for (const game of GAME_SCRIPTS) {
    try {
      const channel = await fetchSendableChannel(client, game.channelId);
      if (!channel) {
        logger.error(`[TCP Games ERROR] The ${game.game} channel is not a text channel the bot can post in.`);
        continue;
      }
      const { installId, message } = buildGamePanel(game, withBanner);
      const existing = await findPanel(client, channel, `${INSTALL_PREFIX}${game.key}:`);
      if (existing && JSON.stringify(existing.components).includes(installId)) {
        logger.info(`[TCP Games] ${game.game} showcase is up to date.`);
        continue;
      }
      // Replaced rather than edited, so the banner attachment always matches the embed.
      if (existing) await existing.delete();
      await channel.send({ ...message, files: withBanner ? [new AttachmentBuilder(BANNER_PATH, { name: BANNER_NAME })] : [] });
      logger.info(`[TCP Games] ${game.game} showcase ${existing ? 'updated' : 'posted'}.`);
    } catch (error) {
      logger.error({ err: error }, `[TCP Games ERROR] Could not post the ${game.game} showcase`);
    }
  }
}

export async function handleGameInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(INSTALL_PREFIX)) return false;
  const key = interaction.customId.slice(INSTALL_PREFIX.length).split(':')[0];
  const game = findGame(key);
  if (!game) {
    await interaction.reply({ content: 'This script is no longer listed.', ephemeral: true });
    return true;
  }
  await interaction.reply({ content: installGuide(game, { licence: env.LICENSE_CHANNEL_ID, bugs: env.BUG_REPORT_CHANNEL_ID }), ephemeral: true });
  return true;
}
