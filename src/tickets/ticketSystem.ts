import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type TextChannel,
  type User,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel } from '../bot/panels.js';
import { answerMessages, finalNotice, notice, tcpEmbed } from '../bot/embeds.js';
import type { AssistantService } from '../ai/assistantService.js';
import type { ConversationMemory } from '../ai/conversationMemory.js';
import { extractQuestionDetails } from '../ai/question.js';
import { reportUnanswered } from '../ai/unanswered.js';
import { memberLicenceEmbed } from '../license/licensePanel.js';
import { serverMapFor } from '../server/serverMap.js';
import { paymentButtons } from '../payments/stripeBilling.js';
import { createTicketStore, type TicketRecord, type TicketStore } from './ticketStore.js';
import {
  TICKET_TYPES,
  answersToFields,
  assistantQuestion,
  buildTranscript,
  formatTicketNumber,
  ticketChannelName,
  ticketTopic,
  ticketType,
  type TicketType,
  type TranscriptMessage,
} from './ticketRules.js';

// T.C.P's own support tickets. A member picks a type on the ticket panel (or presses Still stuck on a help
// answer), fills in a short form, and gets a private channel in SUPPORT_CATEGORY_ID that only they, the
// owner and the bot can see. For setup and bug tickets the assistant takes a first look, and goes quiet
// once the owner claims the ticket or writes in it. Closing posts a transcript to the ticket log channel,
// DMs it to the member, and deletes the channel.
const PREFIX = 'tcp-ticket:';
const OPEN_PREFIX = `${PREFIX}open:`;
const FORM_PREFIX = `${PREFIX}form:`;
const CLOSE_ID = `${PREFIX}close`;
const CLOSE_CONFIRM_ID = `${PREFIX}close-confirm`;
const CLOSE_CANCEL_ID = `${PREFIX}close-cancel`;
const CLAIM_ID = `${PREFIX}claim`;
const CALL_OWNER_ID = `${PREFIX}call-owner`;
/** The ticket panel is found again by this ID prefix on its buttons. */
export const TICKET_PANEL_MARKER = OPEN_PREFIX;

const DELETE_DELAY_MS = 10_000;
const TRANSCRIPT_MESSAGE_LIMIT = 1000;
/** A ticket record with no channel this old was left by a failed creation, and is closed. */
const STALE_CREATION_MS = 60_000;

let store: TicketStore | null = null;
let helpers: { assistant: AssistantService; memory: ConversationMemory } | null = null;
/** Ticket records by channel, so messages in tickets do not each need a database lookup. */
const byChannelCache = new Map<string, TicketRecord>();
/** Channels known not to be open T.C.P tickets (another bot's tickets, closed ones). */
const notOurs = new Set<string>();
/** Open tickets by member, as far as this run of the bot has seen them. */
const openByMember = new Map<string, TicketRecord>();
const creating = new Set<string>();
const closing = new Set<string>();
const ownerCalled = new Set<string>();

export function ticketsEnabled(): boolean {
  return Boolean(env.SUPPORT_CATEGORY_ID) && store !== null;
}

function isOwner(userId: string): boolean {
  return Boolean(env.OWNER_USER_ID) && userId === env.OWNER_USER_ID;
}

// ---- panel ---------------------------------------------------------------------------------------

/** One button per ticket type; also used on the help channel's panel. */
export function ticketButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    TICKET_TYPES.map((type) =>
      new ButtonBuilder()
        .setCustomId(`${OPEN_PREFIX}${type.kind}`)
        .setLabel(type.label)
        .setStyle(type.kind === 'licence' ? ButtonStyle.Success : type.kind === 'payment' ? ButtonStyle.Secondary : ButtonStyle.Primary),
    ),
  );
}

export function ticketPanelLines(): string[] {
  return TICKET_TYPES.map((type) => `**${type.label}:** ${type.blurb}`);
}

export function buildTicketPanel() {
  const embed = tcpEmbed({
    title: 'Need a hand? Open a ticket',
    description: [
      'Pick what it is about below. You get a private channel that only you and the owner can see.',
      '',
      ...ticketPanelLines(),
      '',
      'One open ticket per member. Close it any time with the **Close ticket** button inside.',
    ].join('\n'),
  });
  return { embeds: [embed], components: [ticketButtons()] };
}

/** Opens the ticket records and, when TICKET_PANEL_CHANNEL_ID is set, posts the ticket panel there. */
export async function initTickets(client: Client, deps: { assistant: AssistantService; memory: ConversationMemory }): Promise<void> {
  helpers = deps;
  if (!env.SUPPORT_CATEGORY_ID) {
    logger.info('[TCP Tickets] SUPPORT_CATEGORY_ID not set; tickets disabled.');
    return;
  }
  try {
    const opened = createTicketStore();
    await opened.init();
    store = opened;
    logger.info(`[TCP Tickets] Records ready (${opened.kind}).`);
    if (opened.kind === 'sqlite' && env.NODE_ENV === 'production') {
      logger.warn('[TCP Tickets] Using the local SQLite file in production; ticket numbers restart on redeploy. Point DATABASE_URL at Postgres.');
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP Tickets ERROR] Could not open the ticket records; tickets disabled.');
    return;
  }
  if (env.TICKET_PANEL_CHANNEL_ID) await ensurePanel(client, env.TICKET_PANEL_CHANNEL_ID, TICKET_PANEL_MARKER, buildTicketPanel(), 'ticket');
  else logger.info('[TCP Tickets] TICKET_PANEL_CHANNEL_ID not set; the ticket buttons are on the help channel panel.');
}

// ---- records -------------------------------------------------------------------------------------

/** The open T.C.P ticket in this channel, or null. Results are cached, so most messages need no database. */
async function recordForChannel(channelId: string): Promise<TicketRecord | null> {
  const cached = byChannelCache.get(channelId);
  if (cached) return cached;
  if (!store || notOurs.has(channelId)) return null;
  const record = await store.byChannel(channelId);
  if (record && record.status === 'open') {
    byChannelCache.set(channelId, record);
    return record;
  }
  notOurs.add(channelId);
  return null;
}

function forget(record: TicketRecord): void {
  if (record.channelId) {
    byChannelCache.delete(record.channelId);
    notOurs.add(record.channelId);
    ownerCalled.delete(record.channelId);
  }
  if (openByMember.get(record.discordUserId)?.number === record.number) openByMember.delete(record.discordUserId);
}

/** Resolves to the value, or to the fallback if it takes longer than the wait. */
function within<T>(promise: Promise<T>, waitMs: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), waitMs))]);
}

/**
 * The member's open ticket, if its channel still exists. Uses only the bot's cache for the channel, so it
 * is quick enough to run before showing a form. Leftovers from deleted channels or failed creations are closed.
 */
async function openTicketFor(client: Client, userId: string): Promise<TicketRecord | null> {
  if (!store) return null;
  const record = openByMember.get(userId) ?? (await store.openFor(userId));
  if (!record) return null;
  const now = Date.now();
  if (!record.channelId) {
    if (now - record.createdAt < STALE_CREATION_MS) return record;
    await store.close(record.number, 'failed', now);
    forget(record);
    return null;
  }
  // Every channel in the server is in the cache (Guilds intent), so a missing one was deleted.
  if (client.channels.cache.has(record.channelId)) {
    openByMember.set(userId, record);
    return record;
  }
  await store.close(record.number, 'deleted', now);
  forget(record);
  return null;
}

/** For the message handler: whether the assistant should stay quiet in this channel's T.C.P ticket. */
export async function isAssistantQuietInTicket(channelId: string): Promise<boolean> {
  try {
    const record = await recordForChannel(channelId);
    if (!record) return false;
    // Claimed by the owner, or a type that goes straight to the owner (licence, payment).
    return Boolean(record.claimedBy) || !ticketType(record.kind)?.assistantFirst;
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tickets] Could not look up a ticket');
    return false;
  }
}

/** The member who opened this channel's T.C.P ticket: the audience for answers posted in it. */
export async function ticketAudience(guild: Guild, channelId: string): Promise<GuildMember | null> {
  try {
    const record = await recordForChannel(channelId);
    if (!record) return null;
    return guild.members.cache.get(record.discordUserId) ?? (await guild.members.fetch(record.discordUserId));
  } catch {
    return null;
  }
}

/** The owner wrote in a ticket: from now on it is theirs, and the assistant steps back. */
export async function noteOwnerInTicket(channelId: string): Promise<void> {
  try {
    const record = await recordForChannel(channelId);
    if (!record || record.claimedBy || !store || !env.OWNER_USER_ID) return;
    record.claimedBy = env.OWNER_USER_ID;
    await store.claim(record.number, env.OWNER_USER_ID);
    logger.info(`[TCP Tickets] Owner joined ${formatTicketNumber(record.number)}; the assistant steps back.`);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tickets] Could not mark a ticket as taken by the owner');
  }
}

/** A ticket channel was deleted by hand: close its record without a transcript. */
export async function handleTicketChannelDeleted(channelId: string): Promise<void> {
  if (!store || closing.has(channelId)) return;
  try {
    const record = await recordForChannel(channelId);
    if (!record || record.status === 'closed') return;
    await store.close(record.number, 'deleted', Date.now());
    record.status = 'closed';
    forget(record);
    logger.info(`[TCP Tickets] ${formatTicketNumber(record.number)} channel was deleted; ticket closed.`);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tickets] Could not close the record of a deleted ticket channel');
  }
}

// ---- opening -------------------------------------------------------------------------------------

function ticketModal(type: TicketType, prefill: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${FORM_PREFIX}${type.kind}`)
    .setTitle(`Open a ticket · ${type.label}`)
    .addComponents(
      type.fields.map((field) => {
        const input = new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label)
          .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
          .setRequired(field.required)
          .setMaxLength(field.max)
          .setPlaceholder(field.placeholder);
        if (field.id === 'issue' && prefill) input.setValue(prefill.slice(0, field.max));
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      }),
    );
}

/** Shows the ticket form, unless the member already has a ticket open. Prefill fills in the problem box. */
export async function startTicket(interaction: ButtonInteraction, kind: string, prefill = ''): Promise<void> {
  const type = ticketType(kind);
  if (!type || !ticketsEnabled()) {
    await interaction.reply({ ...notice('Tickets are not set up yet. Please let the owner know.', { tone: 'muted' }), ephemeral: true });
    return;
  }
  // Discord allows 3 seconds to show the form. If the check is slow, show it anyway: the form's submit checks again.
  const existing = await within(
    openTicketFor(interaction.client, interaction.user.id).catch(() => null),
    1500,
    null,
  );
  if (existing) {
    const where = existing.channelId ? `<#${existing.channelId}>` : 'being created right now';
    await interaction.reply({ ...notice(`You already have an open ticket: ${where}. Close it before opening another.`, { tone: 'warning' }), ephemeral: true });
    return;
  }
  await interaction.showModal(ticketModal(type, prefill));
}

function ticketPermissions(guild: Guild, memberId: string, botId: string): OverwriteResolvable[] {
  const talk = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: memberId, type: OverwriteType.Member, allow: talk },
    { id: botId, type: OverwriteType.Member, allow: [...talk, PermissionFlagsBits.ManageChannels] },
  ];
  if (env.OWNER_USER_ID && env.OWNER_USER_ID !== memberId) overwrites.push({ id: env.OWNER_USER_ID, type: OverwriteType.Member, allow: talk });
  return overwrites;
}

function ticketControls(type: TicketType, claimedBy: string | null) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CLOSE_ID).setLabel('Close ticket').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CLAIM_ID)
      .setLabel(claimedBy ? 'Claimed' : 'Claim (owner)')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(claimedBy)),
  );
  if (type.assistantFirst) row.addComponents(new ButtonBuilder().setCustomId(CALL_OWNER_ID).setLabel('Call the owner').setStyle(ButtonStyle.Primary));
  return row;
}

function introMessage(number: number, type: TicketType, user: User, answers: Record<string, string>, now: number) {
  // No second ping when the owner opens a ticket themselves.
  const ownerId = type.callOwner && env.OWNER_USER_ID !== user.id ? env.OWNER_USER_ID : undefined;
  const description = type.assistantFirst
    ? `Thanks <@${user.id}>! I'll take a first look below. If that doesn't sort it, press **Call the owner** and they'll jump in.`
    : `Thanks <@${user.id}>! The owner has been notified and will be with you soon. Add anything that helps, like screenshots.`;
  const embed = tcpEmbed({
    title: `Ticket ${formatTicketNumber(number)} · ${type.label}`,
    description,
    thumbnail: user.displayAvatarURL(),
    fields: [
      ...answersToFields(type, answers),
      { name: 'Opened by', value: `<@${user.id}>`, inline: true },
      { name: 'Opened', value: `<t:${Math.floor(now / 1000)}:R>`, inline: true },
    ],
  });
  return {
    content: ownerId ? `<@${user.id}> <@${ownerId}>` : `<@${user.id}>`,
    embeds: [embed],
    components: [ticketControls(type, null)],
    allowedMentions: { users: ownerId ? [user.id, ownerId] : [user.id] },
  };
}

async function ticketLog(client: Client, payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }): Promise<void> {
  const channelId = env.TICKET_LOG_CHANNEL_ID ?? env.LOG_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel = await fetchSendableChannel(client, channelId);
    if (channel) await channel.send({ ...payload, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tickets] Could not write to the ticket log channel');
  }
}

/** The assistant's first look in a new setup or bug ticket; it becomes the start of the ticket's conversation. */
async function firstLook(channel: TextChannel, user: User, question: string): Promise<void> {
  if (!helpers || !question.trim()) return;
  const { assistant, memory } = helpers;
  try {
    await channel.sendTyping();
    const session = memory.getOrCreate(channel.guild.id, channel.id, user.id, true);
    const followUp = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    // The member is both asker and audience: only channels they can see.
    const member = await channel.guild.members.fetch(user.id).catch(() => null);
    const serverMap = member ? serverMapFor(channel.guild, member, member) : serverMapFor(channel.guild);
    const result = await assistant.answerDetailed(question, session.turns, channel.client.user?.id, session.tuning, followUp, serverMap);
    memory.record(session, question, result.text);
    for (const part of answerMessages(result.text, { title: 'First look' })) await channel.send(part);
    if (result.unanswered) {
      await reportUnanswered(channel.client, { question, userId: user.id, where: `<#${channel.id}> (ticket)`, sources: result.sources });
    }
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tickets] The first look failed');
  }
}

async function createTicket(interaction: ModalSubmitInteraction, type: TicketType): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.user;
  if (!store || !env.SUPPORT_CATEGORY_ID) {
    await interaction.editReply(notice('Tickets are not set up yet. Please let the owner know.', { tone: 'muted' }));
    return;
  }
  if (creating.has(user.id)) {
    await interaction.editReply(notice('Your ticket is already being created.', { tone: 'muted' }));
    return;
  }
  creating.add(user.id);
  try {
    const existing = await openTicketFor(interaction.client, user.id);
    if (existing) {
      const where = existing.channelId ? `<#${existing.channelId}>` : 'being created right now';
      await interaction.editReply(notice(`You already have an open ticket: ${where}.`, { tone: 'warning' }));
      return;
    }
    const answers = Object.fromEntries(type.fields.map((field) => [field.id, interaction.fields.getTextInputValue(field.id).trim()]));
    const guild = interaction.guild ?? (await interaction.client.guilds.fetch(env.DISCORD_GUILD_ID));
    const now = Date.now();
    const number = await store.create(user.id, type.kind, now);

    let channel: TextChannel;
    try {
      channel = await guild.channels.create({
        name: ticketChannelName(number, user.username),
        type: ChannelType.GuildText,
        parent: env.SUPPORT_CATEGORY_ID,
        topic: ticketTopic(number, type, user.id),
        permissionOverwrites: ticketPermissions(guild, user.id, interaction.client.user.id),
        reason: `T.C.P ticket ${formatTicketNumber(number)} for ${user.tag}`,
      });
    } catch (error) {
      await store.close(number, 'failed', Date.now());
      logger.error(
        { err: error },
        '[TCP Tickets ERROR] Could not create a ticket channel; check the bot has Manage Channels in the support category.',
      );
      await interaction.editReply(notice('Sorry, I could not open your ticket. Please let the owner know.', { tone: 'danger' }));
      return;
    }

    const record: TicketRecord = {
      number,
      discordUserId: user.id,
      channelId: channel.id,
      kind: type.kind,
      status: 'open',
      claimedBy: null,
      createdAt: now,
      closedAt: null,
      closedBy: null,
    };
    try {
      await store.setChannel(number, channel.id);
      // Without its opening message the ticket would have no Close button, so a failure here undoes it.
      await channel.send(introMessage(number, type, user, answers, now));
    } catch (error) {
      logger.error({ err: error }, '[TCP Tickets ERROR] Could not set up a new ticket channel; removing it.');
      await store.close(number, 'failed', Date.now()).catch(() => undefined);
      await channel.delete('T.C.P ticket could not be set up').catch(() => undefined);
      await interaction.editReply(notice('Sorry, I could not open your ticket. Please let the owner know.', { tone: 'danger' }));
      return;
    }
    notOurs.delete(channel.id);
    byChannelCache.set(channel.id, record);
    openByMember.set(user.id, record);
    await interaction.editReply(notice(`Your ticket is open: <#${channel.id}>`, { title: `Ticket ${formatTicketNumber(number)}`, tone: 'success' }));
    logger.info(`[TCP Tickets] ${user.id} opened ${formatTicketNumber(number)} (${type.kind})`);
    await ticketLog(interaction.client, {
      embeds: [
        tcpEmbed({
          title: `Ticket ${formatTicketNumber(number)} opened`,
          tone: 'brand',
          fields: [
            { name: 'Type', value: type.label, inline: true },
            { name: 'Member', value: `<@${user.id}>`, inline: true },
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          ],
          timestamp: true,
        }),
      ],
    });

    if (type.kind === 'licence') {
      const licence = await memberLicenceEmbed(user.id, 'Licence');
      const payments = paymentButtons();
      if (licence) await channel.send({ embeds: [licence], components: payments ? [payments] : [] });
    }
    if (type.assistantFirst) await firstLook(channel, user, assistantQuestion(type, answers));
  } finally {
    creating.delete(user.id);
  }
}

// ---- in-ticket buttons ---------------------------------------------------------------------------

async function claimTicket(interaction: ButtonInteraction, record: TicketRecord): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ ...notice('Only the owner can claim a ticket.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  record.claimedBy = interaction.user.id;
  const type = ticketType(record.kind) ?? TICKET_TYPES[0]!;
  const intro = interaction.message.embeds[0];
  const embeds = intro
    ? [EmbedBuilder.from(intro).spliceFields(25, 0, { name: 'Claimed by', value: `<@${interaction.user.id}>`, inline: true })]
    : [];
  // Answer the button first (Discord allows 3 seconds), then record it.
  await interaction.update({ embeds, components: [ticketControls(type, interaction.user.id)] });
  await store?.claim(record.number, interaction.user.id).catch((error: unknown) => logger.warn({ err: error }, '[TCP Tickets] Could not record a claim'));
  if (interaction.channel && 'send' in interaction.channel) {
    await interaction.channel.send(notice(`<@${interaction.user.id}> has this ticket now. The assistant will stay quiet unless you @mention it.`, { tone: 'success' }));
  }
}

async function callOwner(interaction: ButtonInteraction): Promise<void> {
  if (!env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('The owner account is not set up yet. Leave your details here for now.', { tone: 'muted' }), ephemeral: true });
    return;
  }
  if (ownerCalled.has(interaction.channelId)) {
    await interaction.reply({ ...notice('The owner has already been called for this ticket.', { tone: 'muted' }), ephemeral: true });
    return;
  }
  ownerCalled.add(interaction.channelId);
  await interaction.reply({
    content: `<@${env.OWNER_USER_ID}>`,
    embeds: [tcpEmbed({ title: 'Owner called', description: `<@${interaction.user.id}> asked for the owner. They'll be with you soon.`, tone: 'warning' })],
    allowedMentions: { users: [env.OWNER_USER_ID] },
  });
}

async function fetchTranscriptMessages(channel: GuildTextBasedChannel): Promise<{ messages: TranscriptMessage[]; names: Map<string, string> }> {
  const fetched: Message[] = [];
  let before: string | undefined;
  while (fetched.length < TRANSCRIPT_MESSAGE_LIMIT) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    fetched.push(...batch.values());
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  fetched.reverse();
  const names = new Map<string, string>();
  for (const message of fetched) {
    names.set(message.author.id, message.member?.displayName ?? message.author.username);
    for (const user of message.mentions.users.values()) if (!names.has(user.id)) names.set(user.id, user.username);
  }
  const messages = fetched.map((message) => ({
    at: message.createdTimestamp,
    author: names.get(message.author.id) ?? message.author.username,
    bot: message.author.bot,
    content: message.content,
    embeds: message.embeds.map((embed) => ({ title: embed.title, description: embed.description, fields: embed.fields.map((f) => ({ name: f.name, value: f.value })) })),
    attachments: message.attachments.map((attachment) => attachment.url),
  }));
  return { messages, names };
}

async function closeTicket(interaction: ButtonInteraction, record: TicketRecord): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.isDMBased() || !channel.isTextBased() || closing.has(channel.id)) return;
  closing.add(channel.id);
  const client = interaction.client;
  const now = Date.now();
  const type = ticketType(record.kind);
  try {
    await channel.send({
      embeds: [
        tcpEmbed({
          title: 'Ticket closed',
          description: `Closed by <@${interaction.user.id}>. A transcript has been saved, and this channel will be deleted in ${DELETE_DELAY_MS / 1000} seconds.`,
          tone: 'muted',
        }),
      ],
    });
    const { messages, names } = await fetchTranscriptMessages(channel);
    const opener = names.get(record.discordUserId) ?? (await client.users.fetch(record.discordUserId).then((u) => u.username).catch(() => record.discordUserId));
    const closer = interaction.member && 'displayName' in interaction.member ? interaction.member.displayName : interaction.user.username;
    const transcript = buildTranscript(
      { number: record.number, type: type?.label ?? record.kind, openedBy: opener, openedAt: record.createdAt, closedBy: closer, closedAt: now },
      messages,
      names,
    );
    const fileName = `ticket-${String(record.number).padStart(4, '0')}.txt`;
    const file = () => new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: fileName });

    await store?.close(record.number, interaction.user.id, now);
    record.status = 'closed';
    forget(record);
    logger.info(`[TCP Tickets] ${formatTicketNumber(record.number)} closed by ${interaction.user.id}`);

    const summary = [
      { name: 'Type', value: type?.label ?? record.kind, inline: true },
      { name: 'Member', value: `<@${record.discordUserId}>`, inline: true },
      { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Opened', value: `<t:${Math.floor(record.createdAt / 1000)}:f>`, inline: true },
      { name: 'Messages', value: String(messages.length), inline: true },
    ];
    await ticketLog(client, {
      embeds: [tcpEmbed({ title: `Ticket ${formatTicketNumber(record.number)} closed`, fields: summary, tone: 'muted', timestamp: true })],
      files: [file()],
    });
    try {
      const member = await client.users.fetch(record.discordUserId);
      await member.send({
        embeds: [
          tcpEmbed({
            title: `Your T.C.P ticket ${formatTicketNumber(record.number)} is closed`,
            description: 'Thanks for reaching out. A copy of the conversation is attached. Need anything else? Open a new ticket any time.',
          }),
        ],
        files: [file()],
      });
    } catch (error) {
      logger.info({ err: error }, `[TCP Tickets] Could not DM the transcript to ${record.discordUserId}`);
    }
  } catch (error) {
    logger.error({ err: error }, '[TCP Tickets ERROR] Closing a ticket failed part way');
  }
  setTimeout(() => {
    channel
      .delete(`T.C.P ticket ${formatTicketNumber(record.number)} closed`)
      .catch((error: unknown) => logger.error({ err: error }, '[TCP Tickets ERROR] Could not delete a closed ticket channel'))
      .finally(() => closing.delete(channel.id));
  }, DELETE_DELAY_MS);
}

export async function handleTicketInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId;
  if (!id.startsWith(PREFIX)) return false;

  if (interaction.isButton() && id.startsWith(OPEN_PREFIX)) {
    await startTicket(interaction, id.slice(OPEN_PREFIX.length));
    return true;
  }
  if (interaction.isModalSubmit() && id.startsWith(FORM_PREFIX)) {
    const type = ticketType(id.slice(FORM_PREFIX.length));
    if (!type) return true;
    await createTicket(interaction, type);
    return true;
  }
  if (!interaction.isButton()) return false;

  const record = await recordForChannel(interaction.channelId);
  if (!record || record.status === 'closed') {
    await interaction.reply({ ...notice('This ticket is already closed.', { tone: 'muted' }), ephemeral: true });
    return true;
  }
  const allowed = interaction.user.id === record.discordUserId || isOwner(interaction.user.id);

  if (id === CLAIM_ID) {
    await claimTicket(interaction, record);
    return true;
  }
  if (id === CALL_OWNER_ID) {
    await callOwner(interaction);
    return true;
  }
  if (id === CLOSE_ID) {
    if (!allowed) {
      await interaction.reply({ ...notice('Only the member who opened this ticket, or the owner, can close it.', { tone: 'danger' }), ephemeral: true });
      return true;
    }
    await interaction.reply({
      embeds: [tcpEmbed({ title: 'Close this ticket?', description: 'A transcript is saved and sent to the member, then this channel is deleted.', tone: 'warning' })],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(CLOSE_CONFIRM_ID).setLabel('Close ticket').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(CLOSE_CANCEL_ID).setLabel('Keep it open').setStyle(ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
    return true;
  }
  if (id === CLOSE_CANCEL_ID) {
    await interaction.update(finalNotice('The ticket stays open.', { tone: 'muted' }));
    return true;
  }
  if (id === CLOSE_CONFIRM_ID) {
    if (!allowed) return true;
    await interaction.update(finalNotice('Closing the ticket...', { tone: 'muted' }));
    await closeTicket(interaction, record);
    return true;
  }
  return false;
}
