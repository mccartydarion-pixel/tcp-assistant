import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';

// Owner announcements: a form, a private preview, then a post to ANNOUNCEMENT_CHANNEL_ID only when the
// owner presses Post. The buttons that start it live on the owner panel (licensePanel.ts).
const PREFIX = 'tcp-announce:';
export const ANNOUNCE_BUTTON_ID = `${PREFIX}new`;
export const ANNOUNCE_FLYER_BUTTON_ID = `${PREFIX}new-flyer`;
const MODAL_ID = `${PREFIX}modal:`; // followed by 1 when the flyer is attached, 0 when not
const POST_ID = `${PREFIX}post`;
const POST_EVERYONE_ID = `${PREFIX}post-everyone`;
const CANCEL_ID = `${PREFIX}cancel`;
const INPUT_TITLE = `${PREFIX}title`;
const INPUT_VERSION = `${PREFIX}version`;
const INPUT_NOTES = `${PREFIX}notes`;
const INPUT_LINK = `${PREFIX}link`;

const FLYER_NAME = 'tcp-flyer.gif';
const FLYER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', FLYER_NAME);
const ANNOUNCE_COLOUR = 0xe8352b;
const DRAFT_LIFETIME_MS = 30 * 60 * 1000;

export interface AnnouncementDraft {
  title: string;
  version: string;
  notes: string;
  link: string;
  withFlyer: boolean;
}

/** Checks the form. Title and notes are required; a link must be a web address. */
export function parseAnnouncement(
  fields: { title: string; version: string; notes: string; link: string },
  withFlyer: boolean,
): { draft: AnnouncementDraft } | { error: string } {
  const title = fields.title.trim();
  const notes = fields.notes.trim();
  const version = fields.version.trim();
  const link = fields.link.trim();
  if (!title) return { error: 'The announcement needs a title.' };
  if (!notes) return { error: 'The announcement needs some text.' };
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { error: 'The link must start with https:// and contain no spaces.' };
  return { draft: { title, version, notes, link, withFlyer } };
}

export function buildAnnouncementEmbed(draft: AnnouncementDraft): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(draft.title)
    .setColor(ANNOUNCE_COLOUR)
    .setDescription(draft.notes)
    .setFooter({ text: 'T.C.P | Tactical Competitive Pro' })
    .setTimestamp();
  const fields = [];
  if (draft.version) fields.push({ name: 'Version', value: draft.version, inline: true });
  if (draft.link) fields.push({ name: 'Link', value: draft.link, inline: true });
  if (fields.length > 0) embed.addFields(fields);
  if (draft.withFlyer) embed.setImage(`attachment://${FLYER_NAME}`);
  return embed;
}

const drafts = new Map<string, { draft: AnnouncementDraft; createdAt: number }>();

function flyerFiles(draft: AnnouncementDraft): AttachmentBuilder[] {
  return draft.withFlyer ? [new AttachmentBuilder(FLYER_PATH, { name: FLYER_NAME })] : [];
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

export async function handleAnnounceInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId;
  if (!id.startsWith(PREFIX)) return false;

  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ content: 'Only the owner can post announcements.', ephemeral: true });
    return true;
  }
  if (!env.ANNOUNCEMENT_CHANNEL_ID) {
    await interaction.reply({ content: 'Set ANNOUNCEMENT_CHANNEL_ID in Railway first, so the bot knows where to post.', ephemeral: true });
    return true;
  }

  if (interaction.isButton() && (id === ANNOUNCE_BUTTON_ID || id === ANNOUNCE_FLYER_BUTTON_ID)) {
    const withFlyer = id === ANNOUNCE_FLYER_BUTTON_ID;
    if (withFlyer && !existsSync(FLYER_PATH)) {
      await interaction.reply({ content: 'The flyer image is missing from the bot (assets/tcp-flyer.gif).', ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_ID}${withFlyer ? 1 : 0}`)
      .setTitle(withFlyer ? 'Announcement with flyer' : 'Announcement')
      .addComponents(
        input(INPUT_TITLE, 'Title', TextInputStyle.Short, 200, true, 'T.C.P v2.1 is out'),
        input(INPUT_VERSION, 'Version (optional)', TextInputStyle.Short, 40, false, '2.1'),
        input(INPUT_NOTES, 'Patch notes / message', TextInputStyle.Paragraph, 4000, true, 'What is new in this version...'),
        input(INPUT_LINK, 'Link (optional)', TextInputStyle.Short, 300, false, 'https://...'),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && id.startsWith(MODAL_ID)) {
    const parsed = parseAnnouncement(
      {
        title: interaction.fields.getTextInputValue(INPUT_TITLE),
        version: interaction.fields.getTextInputValue(INPUT_VERSION),
        notes: interaction.fields.getTextInputValue(INPUT_NOTES),
        link: interaction.fields.getTextInputValue(INPUT_LINK),
      },
      id.endsWith('1'),
    );
    if ('error' in parsed) {
      await interaction.reply({ content: parsed.error, ephemeral: true });
      return true;
    }
    drafts.set(interaction.user.id, { draft: parsed.draft, createdAt: Date.now() });
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(POST_ID).setLabel('Post').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(POST_EVERYONE_ID).setLabel('Post + @everyone').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content: `**Preview.** This is how it will look in <#${env.ANNOUNCEMENT_CHANNEL_ID}>. Nothing has been posted yet.`,
      embeds: [buildAnnouncementEmbed(parsed.draft)],
      files: flyerFiles(parsed.draft),
      components: [buttons],
      ephemeral: true,
    });
    return true;
  }

  if (!interaction.isButton()) return false;

  if (id === CANCEL_ID) {
    drafts.delete(interaction.user.id);
    await interaction.update({ content: 'Cancelled. Nothing was posted.', embeds: [], components: [], attachments: [] });
    return true;
  }

  if (id === POST_ID || id === POST_EVERYONE_ID) {
    const saved = drafts.get(interaction.user.id);
    if (!saved || Date.now() - saved.createdAt > DRAFT_LIFETIME_MS) {
      drafts.delete(interaction.user.id);
      await interaction.update({ content: 'This preview has expired. Start the announcement again.', embeds: [], components: [], attachments: [] });
      return true;
    }
    const everyone = id === POST_EVERYONE_ID;
    try {
      const channel = await fetchSendableChannel(interaction.client, env.ANNOUNCEMENT_CHANNEL_ID);
      if (!channel) throw new Error('ANNOUNCEMENT_CHANNEL_ID is not a text channel');
      const message = await channel.send({
        content: everyone ? '@everyone' : undefined,
        embeds: [buildAnnouncementEmbed(saved.draft)],
        files: flyerFiles(saved.draft),
        allowedMentions: everyone ? { parse: ['everyone'] } : { parse: [] },
      });
      drafts.delete(interaction.user.id);
      logger.info(`[TCP Announce] Posted "${saved.draft.title}"${everyone ? ' with @everyone' : ''}`);
      await interaction.update({ content: `Posted: ${message.url}`, embeds: [], components: [], attachments: [] });
    } catch (error) {
      logger.error({ err: error }, '[TCP Announce ERROR] Could not post the announcement');
      await interaction.update({
        content: 'Could not post it. Check the bot can view and send messages (and attach files, and mention everyone if used) in the announcement channel.',
        embeds: [],
        components: [],
        attachments: [],
      });
    }
    return true;
  }
  return false;
}
