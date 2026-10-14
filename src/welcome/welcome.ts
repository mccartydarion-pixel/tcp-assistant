import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Interaction, type Message, type User } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel } from '../bot/panels.js';
import { GAME_SCRIPTS } from '../games/gameScripts.js';

// A "Start here" panel in WELCOME_CHANNEL_ID, and a greeting there for each new member that pings them,
// both with buttons that each give a short private guide. New members are seen through the Server Members
// Intent when Discord allows it (memberEventsActive); otherwise from Discord's own "joined the server"
// message. Only one of the two greets, so nobody is welcomed twice.
const PREFIX = 'tcp-welcome:';
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
const WELCOME_COLOUR = 0xe8352b;

export type WelcomeGuide = 'licence' | 'download' | 'settings' | 'help' | 'rules';

export interface WelcomeChannels {
  licence?: string;
  download?: string;
  /** Each game's own download channel; used instead of `download` when there are any. */
  games?: { game: string; channelId: string }[];
  settings?: string;
  bugs?: string;
  rules?: string;
}

export function welcomeChannels(): WelcomeChannels {
  return {
    licence: env.LICENSE_CHANNEL_ID,
    download: env.DOWNLOAD_CHANNEL_ID,
    games: GAME_SCRIPTS.map((script) => ({ game: script.game, channelId: script.channelId })),
    settings: env.SETTINGS_CHANNEL_ID,
    bugs: env.BUG_REPORT_CHANNEL_ID,
    rules: env.RULES_CHANNEL_ID,
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
        '• Mention **@T.C.P. Assistant** with your question, for example "my gun keeps climbing" or "what does Easing do". It answers from the T.C.P documentation.',
        '• For anything it cannot solve, open a support ticket.',
        channels.bugs ? `• Found a bug? Report it in <#${channels.bugs}>.` : '',
      ]
        .filter(Boolean)
        .join('\n');
  }
}

function guideButtons(channels: WelcomeChannels) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    availableGuides(channels).map((guide) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${guide}`)
        .setLabel(LABELS[guide])
        .setStyle(guide === 'licence' ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );
}

export function buildWelcomePanel() {
  const embed = new EmbedBuilder()
    .setTitle('Welcome to T.C.P | Tactical Competitive Pro')
    .setColor(WELCOME_COLOUR)
    .setDescription(
      [
        'The all-in-one DayZ script for Cronus Zen on PS5: anti-recoil, ADS accuracy and movement tools, all tuned from the Zen\'s own menu.',
        '',
        'New here? Press a button below for a quick guide. Only you will see it.',
      ].join('\n'),
    );
  return { embeds: [embed], components: [guideButtons(welcomeChannels())] };
}

export async function ensureWelcomePanel(client: Client): Promise<void> {
  if (!env.WELCOME_CHANNEL_ID) {
    logger.info('[TCP Welcome] WELCOME_CHANNEL_ID not set; welcome panel and greetings disabled.');
    return;
  }
  await ensurePanel(client, env.WELCOME_CHANNEL_ID, WELCOME_MARKER, buildWelcomePanel(), 'welcome');
}

/** Posts the welcome greeting in WELCOME_CHANNEL_ID, pinging the new member. */
export async function greetMember(client: Client, user: Pick<User, 'id' | 'bot'>): Promise<void> {
  if (!env.WELCOME_CHANNEL_ID || env.WELCOME_GREET === 'false' || user.bot) return;
  try {
    const channel = await fetchSendableChannel(client, env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    await channel.send({
      content: `Welcome to **T.C.P**, <@${user.id}>! Press a button below to get started.`,
      components: [guideButtons(welcomeChannels())],
      allowedMentions: { users: [user.id] },
    });
    logger.info(`[TCP Welcome] Greeted ${user.id}`);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Welcome] Could not greet a new member');
  }
}

/** Discord's own "joined the server" message: used only when the Server Members Intent is not active. */
export async function greetFromJoinMessage(message: Message): Promise<void> {
  if (memberEventsActive) return;
  await greetMember(message.client, message.author);
}

export async function handleWelcomeInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  const guide = interaction.customId.slice(PREFIX.length) as WelcomeGuide;
  const channels = welcomeChannels();
  const text = availableGuides(channels).includes(guide) ? welcomeGuide(guide, channels, env.LICENSE_TRIAL_DAYS) : welcomeGuide('help', channels, env.LICENSE_TRIAL_DAYS);
  await interaction.reply({ content: text, ephemeral: true });
  return true;
}
