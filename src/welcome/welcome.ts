import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type Role,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel } from '../bot/panels.js';
import { GAME_SCRIPTS } from '../games/gameScripts.js';
import { notice, tcpEmbed } from '../bot/embeds.js';
import { serverGuideFieldsWithin, visibleChannels } from '../server/serverMap.js';
import { ticketsEnabled } from '../tickets/ticketSystem.js';

// The welcome channel: a "Start here" panel (with a Server guide that keeps itself up to date) and a welcome
// card for each new member that pings them. Both have a Get started button: two questions (controller, and
// whether they have the script yet) that give the member a platform role and a personal checklist.
// New members are seen through the Server Members Intent when Discord allows it (memberEventsActive);
// otherwise from Discord's own "joined the server" message. Only one of the two greets.
const PREFIX = 'tcp-welcome:';
const START_ID = `${PREFIX}start`;
const PAD_PREFIX = `${PREFIX}pad:`;
const HAS_PREFIX = `${PREFIX}has:`;
const BACK_ID = `${PREFIX}back`;
let memberEventsActive = false;

/** Whether to ask Discord for the Server Members Intent: only when greetings are wanted at all. */
export function wantsMemberEvents(): boolean {
  return Boolean(env.WELCOME_CHANNEL_ID) && env.WELCOME_GREET !== 'false' && env.WELCOME_MEMBER_INTENT !== 'false';
}

export function setMemberEventsActive(active: boolean): void {
  memberEventsActive = active;
}

export function isMemberEventsActive(): boolean {
  return memberEventsActive;
}
export const WELCOME_MARKER = `${PREFIX}help`;

export type WelcomeGuide = 'licence' | 'download' | 'settings' | 'help' | 'rules';

export interface WelcomeChannels {
  licence?: string;
  download?: string;
  /** Each game's own download channel; used instead of `download` when there are any. */
  games?: { game: string; channelId: string }[];
  settings?: string;
  bugs?: string;
  rules?: string;
  /** The channel where the assistant answers everything. */
  help?: string;
}

export function welcomeChannels(): WelcomeChannels {
  return {
    licence: env.LICENSE_CHANNEL_ID,
    download: env.DOWNLOAD_CHANNEL_ID,
    games: GAME_SCRIPTS.map((script) => ({ game: script.game, channelId: script.channelId })),
    settings: env.SETTINGS_CHANNEL_ID,
    bugs: env.BUG_REPORT_CHANNEL_ID,
    rules: env.RULES_CHANNEL_ID,
    help: env.HELP_CHANNEL_ID,
  };
}

/** The guides to offer: Help always, the rest only when their channel is set. */
export function availableGuides(channels: WelcomeChannels): WelcomeGuide[] {
  const guides: WelcomeGuide[] = [];
  if (channels.licence) guides.push('licence');
  if (channels.games?.length || channels.download) guides.push('download');
  if (channels.settings) guides.push('settings');
  guides.push('help');
  if (channels.rules) guides.push('rules');
  return guides;
}

const LABELS: Record<WelcomeGuide, string> = {
  licence: 'Get my licence',
  download: 'Download',
  settings: 'Settings',
  help: 'Get help',
  rules: 'Rules',
};

export function welcomeGuide(guide: WelcomeGuide, channels: WelcomeChannels, trialDays: number): string {
  switch (guide) {
    case 'licence':
      return [
        '**Getting your licence**',
        '`1` Load T.C.P on your Cronus Zen and press **X** (**A** on Xbox) on the lock screen to see your five-digit number.',
        `\`2\` Go to <#${channels.licence}> and press **Generate**, then type in your number.`,
        '`3` Enter the six-digit code you get back on the Zen.',
        '',
        `New members get a free **${trialDays}-day** trial automatically the first time they press Generate.`,
      ].join('\n');
    case 'download':
      return [
        '**Getting the script**',
        ...(channels.games?.length
          ? [
              'Each game has its own channel with the download link and install steps:',
              ...channels.games.map((entry) => `• **${entry.game}**: <#${entry.channelId}>`),
            ]
          : [`Download T.C.P from <#${channels.download}>, then load it onto your Cronus Zen with Zen Studio.`]),
        'Open the menu on the Zen by holding **L2** and pressing **OPTIONS** (**LT** + **Menu** on Xbox).',
      ].join('\n');
    case 'settings':
      return [
        '**Settings**',
        `See what setups other players use in <#${channels.settings}>. Every card has a **How to apply** button that shows the menu page for each value.`,
        'Found something that works for you? Press **Share my settings** there.',
      ].join('\n');
    case 'rules':
      return `Please read the server rules in <#${channels.rules}>.`;
    case 'help':
    default:
      return [
        '**Getting help**',
        channels.help
          ? `• Ask anything in <#${channels.help}>, no @mention needed. The assistant answers from the T.C.P documentation.`
          : '• Mention **@T.C.P. Assistant** with your question, for example "my gun keeps climbing" or "what does Easing do". It answers from the T.C.P documentation.',
        '• For anything it cannot solve, open a support ticket.',
        channels.bugs ? `• Found a bug? Report it in <#${channels.bugs}>.` : '',
      ]
        .filter(Boolean)
        .join('\n');
  }
}

/** A guide as an embed: its bold first line, when it has one, becomes the title. */
export function guideNotice(text: string) {
  const [first = '', ...rest] = text.split('\n');
  const heading = /^\*\*(.+)\*\*$/.exec(first);
  return heading ? notice(rest.join('\n'), { title: heading[1] }) : notice(text);
}

// ---- Get started -----------------------------------------------------------------------------------

export type Platform = 'playstation' | 'xbox';

export const PLATFORMS: Record<Platform, { name: string; confirm: string; menu: string; colour: number }> = {
  playstation: { name: 'PlayStation', confirm: 'X', menu: '**L2** + **OPTIONS**', colour: 0x0070d1 },
  xbox: { name: 'Xbox', confirm: 'A', menu: '**LT** + **Menu**', colour: 0x107c10 },
};

/** The member's personal checklist after Get started, worded for their controller. */
export function setupChecklist(input: {
  platform: Platform;
  hasScript: boolean;
  channels: WelcomeChannels;
  trialDays: number;
  tickets: boolean;
  roleGiven?: string;
}): { title: string; lines: string[] } {
  const pad = PLATFORMS[input.platform];
  const { channels } = input;
  const download = channels.games?.[0]?.channelId ?? channels.download;
  const lines: string[] = [];
  if (input.roleGiven) lines.push(`You now have the **${input.roleGiven}** role.`, '');
  if (input.hasScript) {
    lines.push('**You are ready to go**');
    if (channels.licence) lines.push(`• Need a new code? Press **Generate** in <#${channels.licence}>.`);
    lines.push(`• Open the T.C.P menu with ${pad.menu}.`);
    if (channels.settings) lines.push(`• See what setups other players use in <#${channels.settings}>.`);
  } else {
    lines.push('**Get T.C.P running**');
    lines.push(download ? `\`1\` Download it from <#${download}>.` : '`1` Download it with the button below.');
    lines.push('`2` Add it to Zen Studio and program it to a slot on your Cronus Zen.');
    lines.push(
      channels.licence
        ? `\`3\` Load the slot. On the lock screen press **${pad.confirm}** to see your number, then get your code in <#${channels.licence}>. Your first **${input.trialDays} days** are free.`
        : '`3` Load the slot on your Zen.',
    );
    lines.push(`\`4\` Open the menu with ${pad.menu} and tune it from there.`);
  }
  lines.push('', '**When you need a hand**');
  lines.push(channels.help ? `• Ask anything in <#${channels.help}>, no @mention needed.` : '• @mention **T.C.P. Assistant** with your question.');
  if (input.tickets) lines.push('• Still stuck? Open a ticket and the owner will help you privately.');
  if (channels.rules) lines.push(`• Please read the rules in <#${channels.rules}>.`);
  return { title: input.hasScript ? 'Your T.C.P checklist' : 'Your T.C.P setup', lines };
}

const drafts = new Map<string, { platform: Platform; at: number }>();
const DRAFT_LIFETIME_MS = 30 * 60 * 1000;
const rolePromises = new Map<Platform, Promise<Role | null>>();

function startButton() {
  return new ButtonBuilder().setCustomId(START_ID).setLabel('Get started').setStyle(ButtonStyle.Success);
}

function stepOne() {
  return {
    content: '',
    embeds: [tcpEmbed({ title: 'Get started · 1 of 2', description: 'Which controller do you play with?\n\nThis sets your platform role and shows you the right button names.' })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PAD_PREFIX}playstation`).setLabel('PlayStation').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PAD_PREFIX}xbox`).setLabel('Xbox').setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

function stepTwo(platform: Platform) {
  return {
    content: '',
    embeds: [tcpEmbed({ title: 'Get started · 2 of 2', description: `**${PLATFORMS[platform].name}**, got it.\n\nDo you have T.C.P on your Cronus Zen yet?` })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${HAS_PREFIX}yes`).setLabel("Yes, it's on my Zen").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${HAS_PREFIX}no`).setLabel('Not yet').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(BACK_ID).setLabel('Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Permissions a role handed out by a button must never carry. */
const UNSAFE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

/** Whether members may give themselves this role: not a bot's or integration's role, and no moderator powers. */
export function isSafeSelfRole(role: Pick<Role, 'managed' | 'permissions'>): boolean {
  return !role.managed && !role.permissions.any(UNSAFE_PERMISSIONS);
}

/**
 * The platform role: the configured one, else one with that name, else (when create is set) a new one.
 * Null if there is none, or if it is not safe to hand out.
 */
async function platformRole(guild: Guild, platform: Platform, create: boolean): Promise<Role | null> {
  const configured = platform === 'playstation' ? env.PLAYSTATION_ROLE_ID : env.XBOX_ROLE_ID;
  const name = PLATFORMS[platform].name;
  const found = configured
    ? (guild.roles.cache.get(configured) ?? (await guild.roles.fetch(configured).catch(() => null)))
    : guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase());
  if (found) {
    if (isSafeSelfRole(found)) return found;
    logger.warn(`[TCP Welcome] The ${found.name} role has moderator permissions, so Get started will not hand it out.`);
    return null;
  }
  if (configured || !create) return null;
  // One creation at a time per platform, so two members pressing at once do not make two roles.
  let pending = rolePromises.get(platform);
  if (!pending) {
    pending = guild.roles
      .create({ name, color: PLATFORMS[platform].colour, permissions: [], mentionable: false, hoist: false, reason: 'T.C.P Get started platform role' })
      .then((role) => {
        logger.info(`[TCP Welcome] Created the ${name} role`);
        return role;
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, `[TCP Welcome] Could not create the ${name} role; check the bot has Manage Roles.`);
        return null;
      })
      .finally(() => rolePromises.delete(platform));
    rolePromises.set(platform, pending);
  }
  return pending;
}

/** Gives the member their platform role and takes away the other one. Returns the role's name, or null. */
async function applyPlatform(member: GuildMember, platform: Platform): Promise<string | null> {
  try {
    const role = await platformRole(member.guild, platform, true);
    if (!role) return null;
    // Only looked up, never created: it exists only if someone already chose that platform.
    const other = await platformRole(member.guild, platform === 'playstation' ? 'xbox' : 'playstation', false);
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'T.C.P Get started');
    if (other && member.roles.cache.has(other.id)) await member.roles.remove(other, 'T.C.P Get started');
    return role.name;
  } catch (error) {
    logger.warn({ err: error }, '[TCP Welcome] Could not set a platform role; check Manage Roles and that the bot role sits above it.');
    return null;
  }
}

async function finishSetup(interaction: ButtonInteraction, platform: Platform, hasScript: boolean): Promise<void> {
  await interaction.deferUpdate();
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(env.DISCORD_GUILD_ID));
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const roleGiven = member ? await applyPlatform(member, platform) : null;
  const checklist = setupChecklist({
    platform,
    hasScript,
    channels: welcomeChannels(),
    trialDays: env.LICENSE_TRIAL_DAYS,
    tickets: ticketsEnabled(),
    roleGiven: roleGiven ?? undefined,
  });
  const links = new ActionRowBuilder<ButtonBuilder>();
  const game = GAME_SCRIPTS[0];
  if (!hasScript && game) links.addComponents(new ButtonBuilder().setLabel('Download T.C.P').setStyle(ButtonStyle.Link).setURL(game.downloadUrl));
  if (env.HELP_CHANNEL_ID) {
    links.addComponents(
      new ButtonBuilder().setLabel('Ask a question').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${env.HELP_CHANNEL_ID}`),
    );
  }
  await interaction.editReply({
    content: '',
    embeds: [tcpEmbed({ title: checklist.title, description: checklist.lines.join('\n'), tone: 'success' })],
    components: links.components.length > 0 ? [links] : [],
  });
  drafts.delete(interaction.user.id);
  logger.info(`[TCP Welcome] ${interaction.user.id} finished Get started (${platform}, ${hasScript ? 'has the script' : 'new'})`);
}

// ---- panel and greeting ---------------------------------------------------------------------------

function guideButtons(channels: WelcomeChannels) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    availableGuides(channels).map((guide) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${guide}`)
        .setLabel(LABELS[guide])
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

export function buildWelcomePanel(guild?: Guild) {
  const welcome = tcpEmbed({
    title: 'Welcome to T.C.P | Tactical Competitive Pro',
    description: [
      "The all-in-one DayZ script for Cronus Zen on PlayStation and Xbox: anti-recoil, ADS accuracy and movement tools, all tuned from the Zen's own menu.",
      '',
      'New here? Press **Get started** for a quick setup, or a button below for a guide. Only you will see them.',
    ].join('\n'),
  });
  const embeds = [welcome];
  if (guild) {
    const fields = serverGuideFieldsWithin(visibleChannels(guild));
    if (fields.length > 0) embeds.push(tcpEmbed({ title: 'Server guide', description: 'Everything in the server, at a glance.', fields }));
  }
  return {
    embeds,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(startButton()), guideButtons(welcomeChannels())],
  };
}

export async function ensureWelcomePanel(client: Client, options: { postIfMissing?: boolean } = {}): Promise<void> {
  if (!env.WELCOME_CHANNEL_ID) {
    logger.info('[TCP Welcome] WELCOME_CHANNEL_ID not set; welcome panel and greetings disabled.');
    return;
  }
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  await ensurePanel(client, env.WELCOME_CHANNEL_ID, WELCOME_MARKER, buildWelcomePanel(guild), 'welcome', options);
}

let guideTimer: NodeJS.Timeout | null = null;

/** Channels changed: refresh the Server guide once things settle. Edit only, so it never adds a second panel. */
export function scheduleServerGuideRefresh(client: Client): void {
  if (!env.WELCOME_CHANNEL_ID || guideTimer) return;
  guideTimer = setTimeout(() => {
    guideTimer = null;
    void ensureWelcomePanel(client, { postIfMissing: false });
  }, 30_000);
}

export interface Newcomer {
  id: string;
  bot: boolean;
  displayName: string;
  avatarURL: string;
  /** Members in the server, counting this one. */
  memberCount?: number;
}

export function greetingMessage(newcomer: Newcomer, guildId: string, rulesChannelId?: string) {
  const embed = tcpEmbed({
    title: `Welcome to T.C.P, ${newcomer.displayName}!`,
    thumbnail: newcomer.avatarURL,
    description: [
      newcomer.memberCount ? `You're member **#${newcomer.memberCount}**.\n` : '',
      "T.C.P is the all-in-one DayZ script for Cronus Zen: anti-recoil, ADS accuracy and movement tools, all tuned from the Zen's own menu.",
      '',
      'Press **Get started** for a quick setup that points you to everything you need.',
    ]
      .filter((line, index) => index > 0 || line)
      .join('\n'),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(startButton());
  if (rulesChannelId) {
    row.addComponents(new ButtonBuilder().setLabel('Rules').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${rulesChannelId}`));
  }
  return { content: `<@${newcomer.id}>`, embeds: [embed], components: [row], allowedMentions: { users: [newcomer.id] } };
}

/** Posts the welcome card in WELCOME_CHANNEL_ID, pinging the new member. */
export async function greetMember(client: Client, newcomer: Newcomer): Promise<void> {
  if (!env.WELCOME_CHANNEL_ID || env.WELCOME_GREET === 'false' || newcomer.bot) return;
  try {
    const channel = await fetchSendableChannel(client, env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    await channel.send(greetingMessage(newcomer, env.DISCORD_GUILD_ID, env.RULES_CHANNEL_ID));
    logger.info(`[TCP Welcome] Greeted ${newcomer.id}`);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Welcome] Could not greet a new member');
  }
}

export function newcomerFromMember(member: GuildMember): Newcomer {
  return {
    id: member.id,
    bot: member.user.bot,
    displayName: member.displayName,
    avatarURL: member.displayAvatarURL(),
    memberCount: member.guild.memberCount,
  };
}

/** Discord's own "joined the server" message: used only when the Server Members Intent is not active. */
export async function greetFromJoinMessage(message: Message): Promise<void> {
  if (memberEventsActive) return;
  const newcomer: Newcomer = message.member
    ? newcomerFromMember(message.member)
    : {
        id: message.author.id,
        bot: message.author.bot,
        displayName: message.author.displayName,
        avatarURL: message.author.displayAvatarURL(),
        memberCount: message.guild?.memberCount,
      };
  await greetMember(message.client, newcomer);
}

export async function handleWelcomeInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  const id = interaction.customId;
  const userId = interaction.user.id;

  if (id === START_ID) {
    const now = Date.now();
    for (const [member, draft] of drafts) if (now - draft.at > DRAFT_LIFETIME_MS) drafts.delete(member);
    await interaction.reply({ ...stepOne(), ephemeral: true });
    return true;
  }
  if (id === BACK_ID) {
    await interaction.update(stepOne());
    return true;
  }
  if (id.startsWith(PAD_PREFIX)) {
    const platform = id.slice(PAD_PREFIX.length) as Platform;
    if (!(platform in PLATFORMS)) return true;
    drafts.set(userId, { platform, at: Date.now() });
    await interaction.update(stepTwo(platform));
    return true;
  }
  if (id.startsWith(HAS_PREFIX)) {
    const draft = drafts.get(userId);
    if (!draft || Date.now() - draft.at > DRAFT_LIFETIME_MS) {
      await interaction.update(stepOne());
      return true;
    }
    await finishSetup(interaction, draft.platform, id.slice(HAS_PREFIX.length) === 'yes');
    return true;
  }

  const guide = id.slice(PREFIX.length) as WelcomeGuide;
  const channels = welcomeChannels();
  const text = availableGuides(channels).includes(guide) ? welcomeGuide(guide, channels, env.LICENSE_TRIAL_DAYS) : welcomeGuide('help', channels, env.LICENSE_TRIAL_DAYS);
  await interaction.reply({ ...guideNotice(text), ephemeral: true });
  return true;
}
