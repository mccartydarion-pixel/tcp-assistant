import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Interaction,
  type Message,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getBrandIcon, notice, tcpEmbed } from '../bot/embeds.js';
import { fetchSendableChannel, findPanel } from '../bot/panels.js';
import { isOwnerId, isStaffMember } from '../bot/staff.js';
import { jsonStore } from '../database/jsonStore.js';
import { PREMIUM_DOWNLOAD_ID, premiumReleaseNotes, type ReleaseInfo } from '../premium/premium.js';
import { startTicket } from '../tickets/ticketSystem.js';
import {
  SCRIPTS,
  STATES,
  applyChange,
  bannerFile,
  cardDescription,
  cardFields,
  cardSignature,
  cardTitle,
  effectiveStatus,
  scriptOf,
  type ScriptConfig,
  type ScriptStatus,
  type StatusChange,
} from './scriptStatusRules.js';

// The live status card in each script channel (SCRIPTS): an embed with an animated banner (one GIF per game
// and state, rendered by branding/make_status_gif.ps1 in the script project), the script's status, build and
// details, and buttons: Download, Changelog, Setup guide, Report a problem. The team changes it with
// /tcp script; a Premium release (/tcp release) sets DayZ back to Online with the new build. The card is only
// re-posted when something on it changed.

const PREFIX = 'tcp-status:';
const STATUS_ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'status');
/** The card's own button, by which the bot finds the card in its channel. */
const markerId = (script: ScriptConfig) => `${PREFIX}setup:${script.key}`;

interface StoredCard extends Partial<ScriptStatus> {
  messageId?: string;
  signature?: string;
}

const store = jsonStore<Record<string, StoredCard>>('scripts.status', () => ({}));

function cardView(script: ScriptConfig, status: ScriptStatus) {
  const banner = bannerFile(script, status.state);
  const icon = getBrandIcon();
  const embed = new EmbedBuilder()
    .setColor(STATES[status.state].colour)
    .setAuthor(icon ? { name: 'T.C.P · SCRIPT STATUS', iconURL: icon } : { name: 'T.C.P · SCRIPT STATUS' })
    .setTitle(cardTitle(script, status).slice(0, 256))
    .setDescription(cardDescription(script, status))
    .addFields(cardFields(status))
    .setImage(`attachment://${banner}`)
    .setFooter(icon ? { text: 'Status set by the T.C.P team · updates live', iconURL: icon } : { text: 'Status set by the T.C.P team · updates live' });
  const buttons: ButtonBuilder[] = [];
  if (script.premium) buttons.push(new ButtonBuilder().setCustomId(PREMIUM_DOWNLOAD_ID).setLabel('Download Premium').setEmoji('⬇️').setStyle(ButtonStyle.Primary));
  else if (status.download) buttons.push(new ButtonBuilder().setURL(status.download).setLabel('Download').setEmoji('⬇️').setStyle(ButtonStyle.Link));
  buttons.push(
    new ButtonBuilder().setCustomId(`${PREFIX}log:${script.key}`).setLabel('Changelog').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(markerId(script)).setLabel('Setup guide').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}bug:${script.key}`).setLabel('Report a problem').setEmoji('🎫').setStyle(ButtonStyle.Danger),
  );
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
    files: [new AttachmentBuilder(resolve(STATUS_ASSET_DIR, banner), { name: banner })],
  };
}

/** Posts the script's card, or edits it in place; does nothing when nothing on it changed. Never throws. */
async function refreshCard(client: Client, script: ScriptConfig): Promise<void> {
  try {
    const channel = await fetchSendableChannel(client, script.channelId).catch(() => null);
    if (!channel) {
      logger.warn(`[TCP Status] The ${script.name} script channel (${script.channelId}) was not found`);
      return;
    }
    const all = await store.read();
    const stored = all[script.key] ?? {};
    const status = effectiveStatus(script, stored);
    const signature = cardSignature(script, status);
    let message: Message | undefined;
    if (stored.messageId && 'messages' in channel) message = await channel.messages.fetch(stored.messageId).catch(() => undefined);
    if (!message) message = await findPanel(client, channel, markerId(script));
    if (message && stored.signature === signature) return;
    const view = cardView(script, status);
    const posted = message ? await message.edit({ ...view, attachments: [] }) : await channel.send(view);
    await store.update((cards) => {
      cards[script.key] = { ...(cards[script.key] ?? {}), messageId: posted.id, signature };
    });
    logger.info(`[TCP Status] ${script.name} status card ${message ? 'updated' : 'posted'} (${STATES[status.state].label})`);
  } catch (error) {
    logger.warn({ err: error }, `[TCP Status] Could not post the ${script.name} status card`);
  }
}

let client: Client | null = null;

export async function initScriptStatus(readyClient: Client): Promise<void> {
  client = readyClient;
  for (const script of SCRIPTS) await refreshCard(readyClient, script);
}

/** A new Premium release: DayZ is Online again, with the release's date as its build and its notes as the latest changes. */
export async function onPremiumRelease(release: ReleaseInfo): Promise<void> {
  const script = SCRIPTS.find((entry) => entry.premium);
  if (!client || !script) return;
  const day = new Date(release.uploadedAt);
  const build = `${day.getUTCFullYear()}.${String(day.getUTCMonth() + 1).padStart(2, '0')}.${String(day.getUTCDate()).padStart(2, '0')}`;
  await store
    .update((cards, now) => {
      const stored = cards[script.key] ?? {};
      const current = effectiveStatus(script, stored);
      const change: StatusChange = { state: 'online', build, ...(release.notes.trim() ? { changes: release.notes.trim().slice(0, 900) } : {}) };
      const next = applyChange(stored, current, change, now);
      next.updatedAt = release.uploadedAt;
      cards[script.key] = { ...stored, ...next };
    })
    .catch((error: unknown) => logger.warn({ err: error }, '[TCP Status] Could not record the release on the status card'));
  await refreshCard(client, script);
}

// ---- /tcp script --------------------------------------------------------------------------------------------

export async function handleScriptCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member && 'permissions' in interaction.member && typeof interaction.member.permissions !== 'string' ? (interaction.member as GuildMember) : null;
  if (!isOwnerId(interaction.user.id) && !isStaffMember(member)) {
    await interaction.reply({ ...notice('Only the T.C.P team can change a script status.'), ephemeral: true });
    return;
  }
  const script = scriptOf(interaction.options.getString('script', true));
  if (!script) {
    await interaction.reply({ ...notice('Unknown script.'), ephemeral: true });
    return;
  }
  const text = (name: string) => interaction.options.getString(name) ?? undefined;
  const change: StatusChange = {
    state: (text('state') as ScriptStatus['state'] | undefined) ?? undefined,
    note: text('note'),
    build: text('build'),
    changes: text('changes'),
    features: text('features'),
    edition: text('edition'),
    platforms: text('platforms'),
    editions: text('editions'),
    download: text('download'),
  };
  const nothing = Object.values(change).every((value) => value === undefined);
  await interaction.deferReply({ ephemeral: true });
  let status: ScriptStatus;
  try {
    status = await store.update((cards, now) => {
      const stored = cards[script.key] ?? {};
      const next = nothing ? stored : { ...stored, ...applyChange(stored, effectiveStatus(script, stored), change, now) };
      cards[script.key] = next;
      return effectiveStatus(script, next);
    });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Status] Could not save a status change');
    await interaction.editReply(notice('Could not save that right now. Try again in a minute.', { tone: 'danger' }));
    return;
  }
  if (client) await refreshCard(client, script);
  await interaction.editReply({
    embeds: [
      tcpEmbed({
        title: nothing ? `${script.name} status` : `${script.name} status updated`,
        description: `${cardTitle(script, status)}\n\n${cardDescription(script, status)}\n\nCard: <#${script.channelId}>. Clear a field with \`-\`.`,
        tone: status.state === 'online' ? 'success' : status.state === 'down' ? 'danger' : 'brand',
      }),
    ],
  });
}

// ---- the card's buttons -------------------------------------------------------------------------------------

function setupGuide(script: ScriptConfig): string {
  const help = env.HELP_CHANNEL_ID ? `<#${env.HELP_CHANNEL_ID}>` : 'the help channel';
  if (script.premium) {
    return [
      `**Setting up ${script.name} · T.C.P Premium**`,
      '`1` Press **Download Premium** (Elite Supporters): your own copy arrives by DM.',
      '`2` Add it in Zen Studio and program it to a slot on your Cronus Zen.',
      `\`3\` Load that slot. On the lock screen press **X** (**A** on Xbox) and get your code with **Generate**${env.LICENSE_CHANNEL_ID ? ` in <#${env.LICENSE_CHANNEL_ID}>` : ' on the license panel'}.`,
      '`4` Open the menu with **L2** + **OPTIONS** (**LT** + **Menu** on Xbox) and tune it there.',
      '',
      `Recoil or aim not right? Press **🎯 Fix my aim** in ${help}.`,
    ].join('\n');
  }
  return [
    `**Setting up ${script.name} · T.C.P**`,
    '`1` Get the script with **Download** on this card.',
    '`2` Add it in Zen Studio and program it to a slot on your Cronus Zen.',
    '`3` Load that slot on the Zen.',
    '',
    `Questions? Ask in ${help}.`,
  ].join('\n');
}

export async function handleScriptStatusInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  const [action = '', key = ''] = interaction.customId.slice(PREFIX.length).split(':');
  const script = scriptOf(key);
  if (!script) {
    await interaction.deferUpdate();
    return true;
  }
  if (action === 'bug') {
    await startTicket(interaction as ButtonInteraction, 'bug', `[${script.name}] `);
    return true;
  }
  if (action === 'setup') {
    await interaction.reply({ ...notice(setupGuide(script)), ephemeral: true });
    return true;
  }
  if (action === 'log') {
    const all = await store.read().catch(() => ({}) as Record<string, StoredCard>);
    const status = effectiveStatus(script, all[script.key]);
    const notes = script.premium ? premiumReleaseNotes() : '';
    const body = notes || status.changes;
    await interaction.reply({
      embeds: [
        tcpEmbed({
          title: `📜 ${script.name} changelog`,
          description: [
            status.build ? `**Build ${status.build}**${status.updatedAt ? ` · <t:${Math.floor(status.updatedAt / 1000)}:D>` : ''}` : '',
            body || 'No changes noted yet.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        }),
      ],
      ephemeral: true,
    });
    return true;
  }
  await interaction.deferUpdate();
  return true;
}
