import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type Client,
  type Interaction,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel, repostPanel } from '../bot/panels.js';
import { finalNotice, notice, tcpEmbed } from '../bot/embeds.js';

// Bug reports, as a short private wizard (area and build, then a form, then a preview), posted as a card
// in BUG_REPORT_CHANNEL_ID. The owner sets each card's status with its buttons, and the reporter gets a
// DM when it changes.
const PREFIX = 'tcp-bug:';
export const BUG_BUTTON_ID = `${PREFIX}report`;
const AREA_SELECT_ID = `${PREFIX}area`;
const BUILD_SELECT_ID = `${PREFIX}build`;
const NEXT_ID = `${PREFIX}next`;
const EDIT_ID = `${PREFIX}edit`;
const SUBMIT_ID = `${PREFIX}submit`;
const CANCEL_ID = `${PREFIX}cancel`;
const MODAL_ID = `${PREFIX}modal`;
const STATUS_PREFIX = `${PREFIX}status:`;

export const BUG_AREAS = [
  'Anti-Recoil',
  'ADS Accuracy',
  'Drop / Crouch Shot',
  'Lean Spam',
  'Auto Movement',
  'Auto Run / Aim / Follow Lean',
  'Menu / OLED screen',
  'Licence / unlock',
  'Discord bot',
  'Other',
] as const;
export const BUG_BUILDS = ['Free (marketplace)', 'Licensed (Discord)', 'Not sure'] as const;

export const BUG_STATUSES = {
  open: { label: 'Open', colour: 0xf59f00 },
  investigating: { label: 'Investigating', colour: 0x1971c2 },
  fixed: { label: 'Fixed', colour: 0x2b8a3e },
  cantrepro: { label: "Can't reproduce", colour: 0x868e96 },
} as const;
export type BugStatus = keyof typeof BUG_STATUSES;

export const REPORT_COOLDOWN_MS = 5 * 60 * 1000;
const DRAFT_LIFETIME_MS = 20 * 60 * 1000;

export interface BugDraft {
  area?: string;
  build?: string;
  summary: string;
  happened: string;
  expected: string;
  steps: string;
  version: string;
  createdAt: number;
}

const drafts = new Map<string, BugDraft>();
const lastReport = new Map<string, number>();

/** Checks the form: everything but version and settings is required. */
export function readBugForm(form: { summary: string; happened: string; expected: string; steps: string; version: string }):
  | Omit<BugDraft, 'area' | 'build' | 'createdAt'>
  | { error: string } {
  const read = {
    summary: form.summary.trim(),
    happened: form.happened.trim(),
    expected: form.expected.trim(),
    steps: form.steps.trim(),
    version: form.version.trim(),
  };
  if (!read.summary) return { error: 'Add a short summary of the problem.' };
  if (!read.happened) return { error: 'Describe what happened.' };
  if (!read.expected) return { error: 'Say what you expected to happen instead.' };
  if (!read.steps) return { error: 'List the steps that make it happen, so it can be reproduced.' };
  return read;
}

export function cooldownMinutesLeft(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  const left = REPORT_COOLDOWN_MS - (now - last);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function buildBugCard(draft: BugDraft, reporterId: string, author: { name: string; iconURL?: string }, status: BugStatus = 'open'): EmbedBuilder {
  const tags = [draft.area, draft.build].filter(Boolean).map((tag) => `**${tag}**`).join('  ·  ');
  const embed = new EmbedBuilder()
    .setColor(BUG_STATUSES[status].colour)
    .setAuthor({ name: author.name, iconURL: author.iconURL })
    .setTitle(`Bug: ${draft.summary}`)
    .addFields(
      { name: 'Status', value: BUG_STATUSES[status].label, inline: true },
      { name: 'Reported by', value: `<@${reporterId}>`, inline: true },
      { name: 'What happened', value: draft.happened },
      { name: 'Expected', value: draft.expected },
      { name: 'Steps to reproduce', value: draft.steps },
    )
    .setFooter({ text: 'T.C.P bug report' })
    .setTimestamp();
  if (tags) embed.setDescription(tags);
  if (draft.version) embed.addFields({ name: 'Version and settings', value: draft.version });
  return embed;
}

/** The same card with a new status: the Status field and the colour change, everything else stays. */
export function withStatus(card: APIEmbed, status: BugStatus): EmbedBuilder {
  const embed = new EmbedBuilder(card).setColor(BUG_STATUSES[status].colour);
  const fields = (card.fields ?? []).map((field) => (field.name === 'Status' ? { ...field, value: BUG_STATUSES[status].label } : field));
  return embed.setFields(fields);
}

/** The reporter's ID, read back from the card's "Reported by" mention. */
export function reporterOf(card: APIEmbed): string | null {
  const field = (card.fields ?? []).find((entry) => entry.name === 'Reported by');
  return field?.value.match(/<@!?(\d+)>/)?.[1] ?? null;
}

function statusButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${STATUS_PREFIX}investigating`).setLabel('Investigating').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${STATUS_PREFIX}fixed`).setLabel('Fixed').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${STATUS_PREFIX}cantrepro`).setLabel("Can't reproduce").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${STATUS_PREFIX}open`).setLabel('Reopen').setStyle(ButtonStyle.Secondary),
  );
}

export function buildBugPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Report a bug')
    .setColor(BUG_STATUSES.open.colour)
    .setDescription(
      [
        'Something not working the way it should? Report it here.',
        '',
        '**A good report has**',
        '`1` Which feature, and which build you use',
        '`2` What happened, and what you expected',
        '`3` The steps that make it happen',
        '`4` Your script version and the settings involved',
        '',
        'You will get a DM when the status of your report changes.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUG_BUTTON_ID).setLabel('Report a bug').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

export async function ensureBugPanel(client: Client): Promise<void> {
  if (!env.BUG_REPORT_CHANNEL_ID) {
    logger.info('[TCP Bugs] BUG_REPORT_CHANNEL_ID not set; bug reports disabled.');
    return;
  }
  await ensurePanel(client, env.BUG_REPORT_CHANNEL_ID, BUG_BUTTON_ID, buildBugPanel(), 'bug report');
}

function selectRow(id: string, placeholder: string, options: readonly string[], chosen?: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .addOptions(options.map((option) => ({ label: option, value: option, default: option === chosen }))),
  );
}

function stepOne(draft: BugDraft) {
  return {
    content: '',
    embeds: [tcpEmbed({ title: 'Report a bug · Step 1 of 2', description: 'Which feature is it, and which build do you use?' })],
    components: [
      selectRow(AREA_SELECT_ID, 'Feature', BUG_AREAS, draft.area),
      selectRow(BUILD_SELECT_ID, 'Build', BUG_BUILDS, draft.build),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(NEXT_ID).setLabel('Next: describe it').setStyle(ButtonStyle.Primary).setDisabled(!draft.area || !draft.build),
        new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function input(id: string, label: string, style: TextInputStyle, max: number, required: boolean, placeholder: string, value: string) {
  const box = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setPlaceholder(placeholder);
  if (value) box.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(box);
}

function bugModal(draft: BugDraft) {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Report a bug · Step 2 of 2')
    .addComponents(
      input('summary', 'Summary', TextInputStyle.Short, 100, true, 'Recoil stops after the first burst', draft.summary),
      input('happened', 'What happened', TextInputStyle.Paragraph, 1000, true, 'Describe what you saw', draft.happened),
      input('expected', 'What you expected', TextInputStyle.Paragraph, 500, true, 'What should have happened', draft.expected),
      input('steps', 'Steps to reproduce', TextInputStyle.Paragraph, 1000, true, '1. Turn on...\n2. Aim and fire...', draft.steps),
      input('version', 'Version and settings (optional)', TextInputStyle.Short, 200, false, 'v2.0, V 26 / H 0, ADS Sens 60', draft.version),
    );
}

function preview(draft: BugDraft, reporterId: string, author: { name: string; iconURL?: string }) {
  return {
    content: '',
    embeds: [tcpEmbed({ title: 'Preview', description: 'Check your report, then submit it.' }), buildBugCard(draft, reporterId, author)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(SUBMIT_ID).setLabel('Submit report').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(EDIT_ID).setLabel('Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

const ended = (text: string, tone: 'brand' | 'success' | 'danger' = 'brand') => finalNotice(text, { tone });

export async function handleBugInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
  const id = interaction.customId;
  if (!id.startsWith(PREFIX)) return false;

  // Status buttons on a posted card: owner only.
  if (interaction.isButton() && id.startsWith(STATUS_PREFIX)) {
    if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
      await interaction.reply({ ...notice('Only the owner can change a report status.', { tone: 'danger' }), ephemeral: true });
      return true;
    }
    const status = id.slice(STATUS_PREFIX.length) as BugStatus;
    const card = interaction.message.embeds[0]?.toJSON();
    if (!card || !(status in BUG_STATUSES)) return true;
    await interaction.update({ embeds: [withStatus(card, status)] });
    const reporter = reporterOf(card);
    if (reporter && reporter !== interaction.user.id) {
      try {
        const user = await interaction.client.users.fetch(reporter);
        await user.send(
          notice(`Your report **${card.title?.replace(/^Bug: /, '') ?? ''}** is now: **${BUG_STATUSES[status].label}**.\n${interaction.message.url}`, {
            title: 'Bug report update',
          }),
        );
      } catch (error) {
        logger.info({ err: error }, `[TCP Bugs] Could not DM reporter ${reporter}`);
      }
    }
    logger.info(`[TCP Bugs] Status set to ${status} on ${interaction.message.id}`);
    return true;
  }

  if (!env.BUG_REPORT_CHANNEL_ID) {
    await interaction.reply({ ...notice('Bug reports are not set up yet.', { tone: 'muted' }), ephemeral: true });
    return true;
  }
  const userId = interaction.user.id;
  const now = Date.now();
  const author = { name: interaction.user.displayName ?? interaction.user.username, iconURL: interaction.user.displayAvatarURL() };

  if (interaction.isButton() && id === BUG_BUTTON_ID) {
    const wait = cooldownMinutesLeft(lastReport.get(userId), now);
    if (wait > 0) {
      await interaction.reply({
        ...notice(`You reported a bug recently. You can send another in ${wait} minute${wait === 1 ? '' : 's'}.`, { tone: 'warning' }),
        ephemeral: true,
      });
      return true;
    }
    const draft: BugDraft = { summary: '', happened: '', expected: '', steps: '', version: '', createdAt: now };
    drafts.set(userId, draft);
    await interaction.reply({ ...stepOne(draft), ephemeral: true });
    return true;
  }

  const draft = drafts.get(userId);
  if (!draft || now - draft.createdAt > DRAFT_LIFETIME_MS) {
    drafts.delete(userId);
    const message = ended('This report has expired. Press **Report a bug** to start again.');
    if (interaction.isModalSubmit()) {
      if (interaction.isFromMessage()) await interaction.update(message);
      else await interaction.reply({ ...message, ephemeral: true });
    } else {
      await interaction.update(message);
    }
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    if (id === AREA_SELECT_ID) draft.area = interaction.values[0];
    if (id === BUILD_SELECT_ID) draft.build = interaction.values[0];
    await interaction.update(stepOne(draft));
    return true;
  }

  if (interaction.isButton()) {
    if (id === CANCEL_ID) {
      drafts.delete(userId);
      await interaction.update(ended('Cancelled. Nothing was sent.'));
      return true;
    }
    if (id === NEXT_ID || id === EDIT_ID) {
      await interaction.showModal(bugModal(draft));
      return true;
    }
    if (id === SUBMIT_ID) {
      try {
        const channel = await fetchSendableChannel(interaction.client, env.BUG_REPORT_CHANNEL_ID);
        if (!channel) throw new Error('BUG_REPORT_CHANNEL_ID is not a text channel');
        const message = await channel.send({
          embeds: [buildBugCard(draft, userId, author)],
          components: [statusButtons()],
          allowedMentions: { parse: [] },
        });
        lastReport.set(userId, now);
        drafts.delete(userId);
        logger.info(`[TCP Bugs] ${userId} reported "${draft.summary}"`);
        await interaction.update(ended(`Thanks, your report is in: ${message.url}\nYou will get a DM when its status changes.`, 'success'));
        await repostPanel(interaction.client, channel, BUG_BUTTON_ID, buildBugPanel());
      } catch (error) {
        logger.error({ err: error }, '[TCP Bugs ERROR] Could not post a bug report');
        await interaction.update(ended('Something went wrong sending your report. Please try again later.', 'danger'));
      }
      return true;
    }
    return false;
  }

  if (!interaction.isModalSubmit() || !interaction.isFromMessage() || id !== MODAL_ID) return false;
  const value = (key: string) => interaction.fields.getTextInputValue(key);
  for (const key of ['summary', 'happened', 'expected', 'steps', 'version'] as const) draft[key] = value(key);
  const result = readBugForm(draft);
  if ('error' in result) {
    await interaction.update({
      content: '',
      embeds: [tcpEmbed({ title: 'Report a bug · Step 2 of 2', description: `${result.error} Press the button to fix it; what you typed is kept.`, tone: 'warning' })],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(EDIT_ID).setLabel('Fix report').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return true;
  }
  Object.assign(draft, result);
  await interaction.update(preview(draft, userId, author));
  return true;
}
