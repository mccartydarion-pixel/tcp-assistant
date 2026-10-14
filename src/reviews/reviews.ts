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
import { createReviewStore, type ReviewRecord, type ReviewStore } from './reviewStore.js';

// Member reviews. A "Leave a review" panel in REVIEW_CHANNEL_ID: pick 1 to 5 stars, write a few words,
// and the bot posts the review as a card there. One review per member; a new one replaces the old card.
// The panel shows the average, and the voice channel REVIEW_VOICE_CHANNEL_ID is renamed to show it in
// stars in the channel list. The owner can take a review down with the Remove button on its card.
const PREFIX = 'tcp-review:';
export const REVIEW_BUTTON_ID = `${PREFIX}start`;
const STARS_PREFIX = `${PREFIX}stars:`;
const MODAL_PREFIX = `${PREFIX}modal:`;
const CANCEL_ID = `${PREFIX}cancel`;
const REMOVE_PREFIX = `${PREFIX}remove:`;

const REVIEW_COLOUR = 0xf5b301;
export const STAR = '⭐';
export const REVIEW_MIN_LENGTH = 10;
export const REVIEW_COOLDOWN_MS = 10 * 60 * 1000;
const DRAFT_LIFETIME_MS = 20 * 60 * 1000;
// Discord allows two renames of a channel per ten minutes, so the rating name changes at most once per
// five minutes; reviews that land in between are picked up by the next rename.
const RENAME_GAP_MS = 5 * 60 * 1000 + 5_000;

export interface RatingSummary {
  count: number;
  average: number;
  /** How many reviews gave each star count: index 0 is one star, index 4 is five. */
  byStars: number[];
}

export interface ReviewInput {
  stars: number;
  headline: string;
  text: string;
}

interface ReviewDraft {
  existing: ReviewRecord | null;
  headline: string;
  text: string;
  createdAt: number;
}

let store: ReviewStore | null = null;
const drafts = new Map<string, ReviewDraft>();
const lastReview = new Map<string, number>();
let lastRename = 0;
let renameTimer: NodeJS.Timeout | null = null;

export function summarizeRatings(stars: number[]): RatingSummary {
  const valid = stars.filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  const byStars = [0, 0, 0, 0, 0];
  for (const value of valid) byStars[value - 1] += 1;
  const total = valid.reduce((sum, value) => sum + value, 0);
  return { count: valid.length, average: valid.length ? total / valid.length : 0, byStars };
}

export function starString(stars: number): string {
  return STAR.repeat(Math.min(5, Math.max(0, stars)));
}

/** The average as whole stars, for showing it as a row of stars: never less than one. */
export function roundedStars(average: number): number {
  return Math.min(5, Math.max(1, Math.round(average)));
}

/** The voice channel's name, e.g. "⭐⭐⭐⭐⭐ 4.8 (23 reviews)". */
export function ratingChannelName(summary: RatingSummary): string {
  if (summary.count === 0) return `${STAR} No reviews yet`;
  return `${starString(roundedStars(summary.average))} ${summary.average.toFixed(1)} (${summary.count} review${summary.count === 1 ? '' : 's'})`;
}

/** Checks the form: stars 1 to 5 and a few words; the headline is optional. */
export function readReviewForm(form: { stars: number; headline: string; text: string }): ReviewInput | { error: string } {
  if (!Number.isInteger(form.stars) || form.stars < 1 || form.stars > 5) return { error: 'Pick between 1 and 5 stars.' };
  const text = form.text.trim();
  if (text.length < REVIEW_MIN_LENGTH) return { error: `Write at least ${REVIEW_MIN_LENGTH} characters about your experience.` };
  return { stars: form.stars, headline: form.headline.trim(), text };
}

export function cooldownMinutesLeft(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  const left = REVIEW_COOLDOWN_MS - (now - last);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

function distributionLines(summary: RatingSummary): string[] {
  const most = Math.max(...summary.byStars, 1);
  const lines: string[] = [];
  for (let stars = 5; stars >= 1; stars -= 1) {
    const count = summary.byStars[stars - 1];
    const bar = '█'.repeat(Math.round((count / most) * 10));
    lines.push(`\`${stars}\` ${STAR} ${bar} ${count}`);
  }
  return lines;
}

export function buildReviewPanel(summary: RatingSummary) {
  const rating =
    summary.count === 0
      ? ['No reviews yet. Be the first to rate **Tactical Competitive Pro**.']
      : [
          `${starString(roundedStars(summary.average))}  **${summary.average.toFixed(1)}** out of 5 from **${summary.count}** review${summary.count === 1 ? '' : 's'}`,
          '',
          ...distributionLines(summary),
        ];
  const embed = new EmbedBuilder()
    .setTitle('Rate T.C.P')
    .setColor(REVIEW_COLOUR)
    .setDescription(
      [
        ...rating,
        '',
        'Used T.C.P? Press **Leave a review**, pick your stars and say what you think.',
        'You can review once; leaving a new review replaces your old one.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(REVIEW_BUTTON_ID).setLabel('Leave a review').setEmoji(STAR).setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

export function buildReviewCard(review: ReviewInput, reviewerId: string, author: { name: string; iconURL?: string }): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(REVIEW_COLOUR)
    .setAuthor({ name: author.name, iconURL: author.iconURL })
    .setTitle(review.headline ? `${starString(review.stars)}  ${review.headline}` : starString(review.stars))
    .setDescription(review.text)
    .addFields(
      { name: 'Rating', value: `${review.stars} / 5`, inline: true },
      { name: 'Reviewed by', value: `<@${reviewerId}>`, inline: true },
    )
    .setFooter({ text: 'T.C.P review' })
    .setTimestamp();
}

function removeRow(reviewerId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${REMOVE_PREFIX}${reviewerId}`).setLabel('Remove').setStyle(ButtonStyle.Secondary),
  );
}

function cancelButton() {
  return new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
}

function starPicker(existing: ReviewRecord | null) {
  const lines = ['**Leave a review · Step 1 of 2**', 'How many stars do you give T.C.P?'];
  if (existing) lines.push(`You already left a ${starString(existing.stars)} review. A new one replaces it.`);
  const stars = new ActionRowBuilder<ButtonBuilder>().addComponents(
    [1, 2, 3, 4, 5].map((count) =>
      new ButtonBuilder().setCustomId(`${STARS_PREFIX}${count}`).setLabel(String(count)).setEmoji(STAR).setStyle(ButtonStyle.Primary),
    ),
  );
  return { content: lines.join('\n'), embeds: [], components: [stars, new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton())] };
}

function input(id: string, label: string, style: TextInputStyle, min: number, max: number, required: boolean, placeholder: string, value: string) {
  const box = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setPlaceholder(placeholder);
  if (min > 0) box.setMinLength(min);
  if (value) box.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(box);
}

function reviewModal(stars: number, draft: ReviewDraft) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${stars}`)
    .setTitle(`Leave a review · ${stars} star${stars === 1 ? '' : 's'}`)
    .addComponents(
      input('headline', 'Headline (optional)', TextInputStyle.Short, 0, 80, false, 'Recoil control is unreal', draft.headline),
      input('text', 'Your review', TextInputStyle.Paragraph, REVIEW_MIN_LENGTH, 1000, true, 'What you like, what could be better, which features you use', draft.text),
    );
}

const ended = (content: string) => ({ content, embeds: [], components: [] });

/** Opens the review records, posts or refreshes the panel, and sets the rating channel's name. */
export async function ensureReviewPanel(client: Client): Promise<void> {
  if (!env.REVIEW_CHANNEL_ID) {
    logger.info('[TCP Reviews] REVIEW_CHANNEL_ID not set; reviews disabled.');
    return;
  }
  try {
    const opened = createReviewStore();
    await opened.init();
    store = opened;
    logger.info(`[TCP Reviews] Records ready (${opened.kind}).`);
    if (opened.kind === 'sqlite' && env.NODE_ENV === 'production') {
      logger.warn('[TCP Reviews] Using the local SQLite file in production; reviews will be lost on redeploy. Point DATABASE_URL at Postgres.');
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP Reviews ERROR] Could not open the review records; reviews disabled.');
    return;
  }
  await ensurePanel(client, env.REVIEW_CHANNEL_ID, REVIEW_BUTTON_ID, buildReviewPanel(await currentSummary()), 'review');
  if (env.REVIEW_VOICE_CHANNEL_ID) scheduleRatingName(client);
  else logger.info('[TCP Reviews] REVIEW_VOICE_CHANNEL_ID not set; the rating is shown on the panel only.');
}

async function currentSummary(): Promise<RatingSummary> {
  return summarizeRatings(store ? await store.listStars() : []);
}

/** Renames the rating channel soon, at most once per RENAME_GAP_MS, using the rating at that moment. */
function scheduleRatingName(client: Client): void {
  if (!env.REVIEW_VOICE_CHANNEL_ID || renameTimer) return;
  const wait = Math.max(0, lastRename + RENAME_GAP_MS - Date.now());
  renameTimer = setTimeout(() => {
    renameTimer = null;
    void applyRatingName(client);
  }, wait);
}

async function applyRatingName(client: Client): Promise<void> {
  const channelId = env.REVIEW_VOICE_CHANNEL_ID;
  if (!channelId) return;
  try {
    const name = ratingChannelName(await currentSummary());
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.isDMBased()) {
      logger.error('[TCP Reviews ERROR] REVIEW_VOICE_CHANNEL_ID is not a channel in the server.');
      return;
    }
    if (channel.name === name) return;
    lastRename = Date.now();
    await channel.setName(name, 'T.C.P review rating');
    logger.info(`[TCP Reviews] Rating channel renamed to "${name}"`);
  } catch (error) {
    logger.error({ err: error }, '[TCP Reviews ERROR] Could not rename the rating channel; check the bot has Manage Channels on it.');
  }
}

/** After a review is added or removed: the panel and the rating channel show the new average. */
async function refreshRating(client: Client, moveToBottom: boolean): Promise<void> {
  if (!env.REVIEW_CHANNEL_ID) return;
  const panel = buildReviewPanel(await currentSummary());
  if (moveToBottom) {
    const channel = await fetchSendableChannel(client, env.REVIEW_CHANNEL_ID);
    if (channel) await repostPanel(client, channel, REVIEW_BUTTON_ID, panel);
  } else {
    await ensurePanel(client, env.REVIEW_CHANNEL_ID, REVIEW_BUTTON_ID, panel, 'review');
  }
  scheduleRatingName(client);
}

export async function handleReviewInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId;
  if (!id.startsWith(PREFIX)) return false;

  // Remove button on a posted review: owner only.
  if (interaction.isButton() && id.startsWith(REMOVE_PREFIX)) {
    if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
      await interaction.reply({ content: 'Only the owner can remove a review.', ephemeral: true });
      return true;
    }
    const reviewerId = id.slice(REMOVE_PREFIX.length);
    await interaction.deferReply({ ephemeral: true });
    // Forget the review only if this card is still the member's current one.
    const current = store ? await store.get(reviewerId) : null;
    if (store && current?.messageId === interaction.message.id) await store.remove(reviewerId);
    await interaction.message.delete();
    logger.info(`[TCP Reviews] Owner removed the review by ${reviewerId}`);
    await interaction.editReply('Review removed. The rating has been updated.');
    await refreshRating(interaction.client, false);
    return true;
  }

  if (!store || !env.REVIEW_CHANNEL_ID) {
    await interaction.reply({ content: 'Reviews are not set up yet.', ephemeral: true });
    return true;
  }
  const userId = interaction.user.id;
  const now = Date.now();

  if (interaction.isButton() && id === REVIEW_BUTTON_ID) {
    const wait = cooldownMinutesLeft(lastReview.get(userId), now);
    if (wait > 0) {
      await interaction.reply({ content: `You reviewed recently. You can update your review in ${wait} minute${wait === 1 ? '' : 's'}.`, ephemeral: true });
      return true;
    }
    const existing = await store.get(userId);
    // Fetched now, so the form can open straight away later with the old review filled in.
    drafts.set(userId, { existing, headline: existing?.headline ?? '', text: existing?.text ?? '', createdAt: now });
    await interaction.reply({ ...starPicker(existing), ephemeral: true });
    return true;
  }

  const draft = drafts.get(userId);
  if (!draft || now - draft.createdAt > DRAFT_LIFETIME_MS) {
    drafts.delete(userId);
    const message = ended('This review has expired. Press **Leave a review** to start again.');
    if (interaction.isModalSubmit()) {
      if (interaction.isFromMessage()) await interaction.update(message);
      else await interaction.reply({ ...message, ephemeral: true });
    } else {
      await interaction.update(message);
    }
    return true;
  }

  if (interaction.isButton()) {
    if (id === CANCEL_ID) {
      drafts.delete(userId);
      await interaction.update(ended('Cancelled. Nothing was posted.'));
      return true;
    }
    if (id.startsWith(STARS_PREFIX)) {
      const stars = Number(id.slice(STARS_PREFIX.length));
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return true;
      await interaction.showModal(reviewModal(stars, draft));
      return true;
    }
    return false;
  }

  if (!interaction.isModalSubmit() || !interaction.isFromMessage() || !id.startsWith(MODAL_PREFIX)) return false;
  const stars = Number(id.slice(MODAL_PREFIX.length));
  draft.headline = interaction.fields.getTextInputValue('headline');
  draft.text = interaction.fields.getTextInputValue('text');
  const result = readReviewForm({ stars, headline: draft.headline, text: draft.text });
  if ('error' in result) {
    await interaction.update({
      content: `**Leave a review · Step 2 of 2**\n${result.error} Press the button to fix it; what you typed is kept.`,
      embeds: [],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${STARS_PREFIX}${stars}`).setLabel('Fix review').setStyle(ButtonStyle.Primary),
          cancelButton(),
        ),
      ],
    });
    return true;
  }

  await interaction.deferUpdate();
  try {
    const channel = await fetchSendableChannel(interaction.client, env.REVIEW_CHANNEL_ID);
    if (!channel) throw new Error('REVIEW_CHANNEL_ID is not a text channel');
    const author = { name: interaction.user.displayName ?? interaction.user.username, iconURL: interaction.user.displayAvatarURL() };
    const message = await channel.send({
      embeds: [buildReviewCard(result, userId, author)],
      components: [removeRow(userId)],
      allowedMentions: { parse: [] },
    });
    const previous = await store.get(userId);
    await store.save({ discordUserId: userId, ...result, messageId: message.id, createdAt: previous?.createdAt ?? now, updatedAt: now });
    if (previous?.messageId) {
      try {
        await (await channel.messages.fetch(previous.messageId)).delete();
      } catch (error) {
        logger.info({ err: error }, `[TCP Reviews] Old review card ${previous.messageId} was already gone`);
      }
    }
    lastReview.set(userId, now);
    drafts.delete(userId);
    logger.info(`[TCP Reviews] ${userId} left ${result.stars} stars`);
    await interaction.editReply(
      ended([`Thanks for your ${starString(result.stars)} review! It is posted here: ${message.url}`, previous ? 'It replaces your earlier review.' : ''].filter(Boolean).join('\n')),
    );
    await refreshRating(interaction.client, true);
  } catch (error) {
    logger.error({ err: error }, '[TCP Reviews ERROR] Could not post a review');
    await interaction.editReply(ended('Something went wrong posting your review. Please try again later.'));
  }
  return true;
}
