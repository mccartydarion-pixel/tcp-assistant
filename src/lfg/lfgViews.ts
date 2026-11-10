import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
} from 'discord.js';
import { tcpEmbed } from '../bot/embeds.js';
import {
  COMMENDS,
  EXPERIENCE,
  LANGUAGES,
  MICS,
  PLATFORMS,
  REGIONS,
  SIZES,
  badges,
  type Commend,
  type Community,
  type LfgCard,
  type Reputation,
  type Seeker,
} from './lfgRules.js';
import type { SquadRecord } from './lfgStore.js';

// What Squad Finder shows: the panel in the lfg channel, the Survivor ID card and its editor, the Deploy
// options and the searching status, the ready check, the squad's channel and the ratings.

export const LFG_PREFIX = 'tcp-lfg:';
export const id = (...parts: (string | number)[]) => `${LFG_PREFIX}${parts.join(':')}`;
/** The panel's marker: the bot finds its own panel in the lfg channel by this button. */
export const panelMarker = (community: Community) => id('deploy', community.key);

export interface View {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
  allowedMentions?: { users?: string[]; parse?: never[] };
}

const buttonRow = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(...buttons);
const selectRow = (select: StringSelectMenuBuilder) => new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(select);
const button = (customId: string, label: string, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);

function select(customId: string, placeholder: string, options: Record<string, string>, chosen: readonly string[], max = 1): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(Math.min(max, Object.keys(options).length))
    .addOptions(Object.entries(options).map(([value, label]) => ({ label: label.slice(0, 100), value, default: chosen.includes(value) })));
}

const or = (value: string | undefined, fallback = '—') => value ?? fallback;
export const playstyleText = (community: Community, keys: readonly string[]) => keys.map((key) => community.playstyles[key] ?? key).join(', ');
export const modeText = (community: Community, mode: string) => (mode === 'any' ? '🎲 Any mode' : (community.playstyles[mode] ?? mode));

// ---- the panel ----------------------------------------------------------------------------------------

export interface PanelStats {
  searching: Seeker[];
  active: number;
  formedToday: number;
  open: number;
}

export function panelView(community: Community, stats: PanelStats): View {
  const byPlatform = new Map<string, Map<string, number>>();
  for (const seeker of stats.searching) {
    const regions = byPlatform.get(seeker.card.platform) ?? new Map<string, number>();
    regions.set(seeker.card.region, (regions.get(seeker.card.region) ?? 0) + 1);
    byPlatform.set(seeker.card.platform, regions);
  }
  const searching =
    [...byPlatform.entries()]
      .map(([platform, regions]) => `**${PLATFORMS[platform as keyof typeof PLATFORMS]}** · ${[...regions.entries()].map(([region, count]) => `${REGIONS[region as keyof typeof REGIONS]} **${count}**`).join(' · ')}`)
      .join('\n') || 'Nobody yet. Be the first to deploy.';
  return {
    embeds: [
      tcpEmbed({
        title: `🎯 ${community.name} Squad Finder`,
        description: [
          'Stop spamming LFG. Make your **Survivor ID** once, press **Deploy**, and get matched with survivors who play like you.',
          'Your squad gets its own **private text and voice channel**, and every squadmate is rated afterwards, so you know who has your back.',
        ].join('\n\n'),
        fields: [
          { name: `📡 Searching now: ${stats.searching.length}`, value: searching },
          { name: '🪖 Squads', value: `**${stats.active}** active · **${stats.formedToday}** formed today`, inline: true },
          { name: '🔓 Open squads', value: stats.open > 0 ? `**${stats.open}** looking for +1` : 'None right now', inline: true },
        ],
      }),
    ],
    components: [
      buttonRow(
        button(panelMarker(community), '🎯 Deploy', ButtonStyle.Success),
        button(id('card', community.key), '🪪 My Survivor ID', ButtonStyle.Primary),
        button(id('open', community.key), '🔓 Open squads'),
        button(id('top', community.key), '🏆 Most trusted'),
      ),
    ],
  };
}

// ---- the card -----------------------------------------------------------------------------------------

export function cardEmbed(community: Community, card: LfgCard, rep: Reputation, name: string, options: { elite?: boolean; showTag?: boolean } = {}): EmbedBuilder {
  const repLine = [badges(rep), `${rep.squads} squad${rep.squads === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return tcpEmbed({
    title: `🪪 ${name}${options.elite ? ' ⭐' : ''}`,
    ...(card.bio ? { description: `*${card.bio}*` } : {}),
    fields: [
      ...(options.showTag ? [{ name: card.platform === 'ps' ? 'PSN' : 'Gamertag', value: `\`${card.gamertag}\``, inline: true }] : []),
      { name: 'Platform', value: PLATFORMS[card.platform], inline: true },
      { name: 'Region', value: `${REGIONS[card.region]} · ${LANGUAGES[card.language]}`, inline: true },
      { name: 'Plays', value: playstyleText(community, card.playstyles) },
      { name: 'Mic', value: MICS[card.mic], inline: true },
      { name: 'Experience', value: EXPERIENCE[card.experience], inline: true },
      { name: 'Server', value: community.servers[card.server] ?? card.server, inline: true },
      { name: 'Reputation', value: repLine },
    ],
  });
}

export type CardDraft = Partial<LfgCard>;

export function cardEditorView(community: Community, draft: CardDraft, step: 1 | 2, note?: string): View {
  const summary = [
    `**Platform:** ${draft.platform ? PLATFORMS[draft.platform] : '—'} · **Region:** ${draft.region ? REGIONS[draft.region] : '—'} · **Mic:** ${draft.mic ? MICS[draft.mic] : '—'}`,
    `**Plays:** ${draft.playstyles?.length ? playstyleText(community, draft.playstyles) : '—'}`,
    `**Experience:** ${draft.experience ? EXPERIENCE[draft.experience] : '—'} · **Server:** ${draft.server ? or(community.servers[draft.server]) : '—'} · **Language:** ${draft.language ? LANGUAGES[draft.language] : '—'}`,
  ];
  const embed = tcpEmbed({
    title: `🪪 Your ${community.name} Survivor ID · step ${step} of 2`,
    description: [
      step === 1 ? 'Pick your platform, region, how you like to play (up to 3) and your mic.' : 'Your experience, the servers you play and your language. Then add your gamertag and save.',
      '',
      ...summary,
      ...(note ? ['', note] : []),
    ].join('\n'),
    footer: 'Your gamertag is only shown to the squads you are matched with.',
  });
  const components =
    step === 1
      ? [
          selectRow(select(id('cf', community.key, 'platform'), 'Platform', PLATFORMS, draft.platform ? [draft.platform] : [])),
          selectRow(select(id('cf', community.key, 'region'), 'Region', REGIONS, draft.region ? [draft.region] : [])),
          selectRow(select(id('cf', community.key, 'playstyles'), 'How you play (up to 3)', community.playstyles, draft.playstyles ?? [], 3)),
          selectRow(select(id('cf', community.key, 'mic'), 'Mic', MICS, draft.mic ? [draft.mic] : [])),
          buttonRow(button(id('ce', community.key, 2), 'Next →', ButtonStyle.Primary)),
        ]
      : [
          selectRow(select(id('cf', community.key, 'experience'), 'Experience', EXPERIENCE, draft.experience ? [draft.experience] : [])),
          selectRow(select(id('cf', community.key, 'server'), 'Servers you play', community.servers, draft.server ? [draft.server] : [])),
          selectRow(select(id('cf', community.key, 'language'), 'Language', LANGUAGES, draft.language ? [draft.language] : [])),
          buttonRow(button(id('ce', community.key, 1), '← Back'), button(id('cg', community.key), '✍️ Gamertag & bio, then save', ButtonStyle.Success)),
        ];
  return { embeds: [embed], components };
}

export function gamertagModal(community: Community, draft: CardDraft): ModalBuilder {
  const gamertag = new TextInputBuilder()
    .setCustomId('gamertag')
    .setLabel(draft.platform === 'xbox' ? 'Your Xbox gamertag' : draft.platform === 'ps' ? 'Your PSN ID' : 'Your PSN ID or Xbox gamertag')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);
  if (draft.gamertag) gamertag.setValue(draft.gamertag);
  const bio = new TextInputBuilder()
    .setCustomId('bio')
    .setLabel('One line about you (optional)')
    .setPlaceholder('Chill, plays evenings, will not shoot you for your beans')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(120);
  if (draft.bio) bio.setValue(draft.bio);
  return new ModalBuilder()
    .setCustomId(id('cmod', community.key))
    .setTitle(`${community.name} Survivor ID`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(gamertag), new ActionRowBuilder<TextInputBuilder>().addComponents(bio));
}

export function myCardView(community: Community, card: LfgCard, rep: Reputation, name: string, elite: boolean): View {
  return {
    embeds: [cardEmbed(community, card, rep, name, { elite, showTag: true })],
    components: [buttonRow(button(id('deploy', community.key), '🎯 Deploy', ButtonStyle.Success), button(id('ce', community.key, 1), '✏️ Edit'))],
  };
}

// ---- deploy and searching ---------------------------------------------------------------------------------

export interface DeployDraft {
  mode: string;
  size: number;
}

export function deployView(community: Community, draft: DeployDraft): View {
  return {
    embeds: [
      tcpEmbed({
        title: '🎯 Deploy',
        description: `What do you want to play **right now**, and how big a squad?\n\n**Mode:** ${modeText(community, draft.mode)} · **Size:** ${SIZES[draft.size]}`,
      }),
    ],
    components: [
      selectRow(select(id('df', community.key, 'mode'), 'Mode for this session', { any: '🎲 Any mode', ...community.playstyles }, [draft.mode])),
      selectRow(select(id('df', community.key, 'size'), 'Squad size', Object.fromEntries(Object.entries(SIZES)), [String(draft.size)])),
      buttonRow(button(id('go', community.key), '🎯 Deploy', ButtonStyle.Success), button(id('ce', community.key, 1), '🪪 Edit my card')),
    ],
  };
}

export function searchingView(community: Community, seeker: Seeker, lfgChannelId: string | null, compatibleNow: number): View {
  return {
    embeds: [
      tcpEmbed({
        title: '📡 Searching for a squad…',
        description: [
          `Searching since <t:${Math.floor(seeker.since / 1000)}:R>${seeker.elite ? ' · ⭐ Elite priority' : ''}.`,
          `${PLATFORMS[seeker.card.platform]} · ${REGIONS[seeker.card.region]} · ${LANGUAGES[seeker.card.language]} · ${modeText(community, seeker.mode)} · ${SIZES[seeker.size]}`,
          '',
          compatibleNow > 0 ? `**${compatibleNow}** compatible survivor${compatibleNow === 1 ? '' : 's'} searching right now.` : 'Nobody compatible is searching right now; the search widens the longer you wait.',
          `You will be pinged${lfgChannelId ? ` in <#${lfgChannelId}>` : ''} for a ready check when a squad is found. The search stops after 45 minutes.`,
        ].join('\n'),
      }),
    ],
    components: [buttonRow(button(id('leave', community.key), 'Leave the queue', ButtonStyle.Danger))],
  };
}

// ---- the ready check ------------------------------------------------------------------------------------

export interface ReadyCheckState {
  id: string;
  community: Community;
  members: Seeker[];
  score: number;
  accepted: Set<string>;
  declined: Set<string>;
  expires: number;
  /** A ready check for one member joining an open squad. */
  join: SquadRecord | null;
}

export function readyCheckView(check: ReadyCheckState, outcome: 'open' | 'formed' | 'failed', note?: string): View {
  const first = check.members[0]!;
  const header = `**${check.score}% match** · ${PLATFORMS[first.card.platform]} · ${REGIONS[first.card.region]} · ${LANGUAGES[first.card.language]} · ${modeText(check.community, check.join?.mode ?? first.mode)}`;
  const status = (userId: string) => (check.accepted.has(userId) ? '✅' : check.declined.has(userId) ? '❌' : outcome === 'open' ? '⏳' : '💤');
  const lines = [
    header,
    '',
    ...check.members.map((member) => `${status(member.userId)} <@${member.userId}>${member.elite ? ' ⭐' : ''}`),
    '',
    outcome === 'open' ? `Accept <t:${Math.floor(check.expires / 1000)}:R>.` : (note ?? ''),
  ];
  return {
    embeds: [
      tcpEmbed({
        title: check.join ? `➕ Squad ${check.join.callSign} needs +1` : `🎯 Squad found! ${check.members.length} survivors`,
        description: lines.join('\n'),
        tone: outcome === 'formed' ? 'success' : outcome === 'failed' ? 'muted' : 'brand',
      }),
    ],
    components:
      outcome === 'open'
        ? [buttonRow(button(id('rc', check.id, 'yes'), '✅ Accept', ButtonStyle.Success), button(id('rc', check.id, 'no'), '❌ Decline', ButtonStyle.Danger))]
        : [],
  };
}

// ---- the squad --------------------------------------------------------------------------------------------

export function squadControls(squad: SquadRecord): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder> {
  return buttonRow(
    button(id('sq', squad.id, 'tags'), '📋 Gamertags'),
    squad.open ? button(id('sq', squad.id, 'close'), '🔒 Close the slot') : button(id('sq', squad.id, 'open'), '➕ Looking for +1', ButtonStyle.Primary, squad.members.length >= 5),
    button(id('sq', squad.id, 'leave'), '🚪 Leave'),
    button(id('sq', squad.id, 'end'), '🏁 End squad', ButtonStyle.Danger),
  );
}

export function squadIntroView(community: Community, squad: SquadRecord, cards: EmbedBuilder[], tip: string | null): View {
  const header = tcpEmbed({
    title: `🪖 Squad ${squad.callSign}`,
    description: [
      `**${squad.score}% match** · ${PLATFORMS[squad.platform as keyof typeof PLATFORMS]} · ${REGIONS[squad.region]} · ${modeText(community, squad.mode)}`,
      '',
      'This is your squad\'s private base: this channel and its voice channel. Add each other in game with **📋 Gamertags**.',
      'When you are done, press **🏁 End squad** and rate your squadmates. The channels close by themselves after an hour with nobody talking.',
      ...(tip ? ['', tip] : []),
    ].join('\n'),
    tone: 'success',
  });
  return {
    content: squad.members.map((member) => `<@${member}>`).join(' '),
    allowedMentions: { users: squad.members },
    embeds: [header, ...cards].slice(0, 10),
    components: [squadControls(squad)],
  };
}

// ---- ratings ----------------------------------------------------------------------------------------------

export const RATE_AGAIN = 'again';
export const RATE_BETRAYED = 'betrayed';

export function ratingView(squad: SquadRecord, teammates: { id: string; name: string }[]): View {
  const options: Record<string, string> = { ...COMMENDS, [RATE_AGAIN]: '🤝 Play again', [RATE_BETRAYED]: '🗡️ Betrayed us (private report)' };
  return {
    embeds: [
      tcpEmbed({
        title: `⭐ Rate Squad ${squad.callSign}`,
        description:
          'Pick what fits each squadmate (as many as you like), then **Submit**. Commendations show on their Survivor ID. **🤝 Play again** pings you when they deploy, if they picked you too.\n\n**🗡️ Betrayed us** is private: nobody sees who reported, and a member reported by several squads is only matched with each other.',
      }),
    ],
    components: [
      ...teammates.slice(0, 4).map((mate) => {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(id('rs', squad.id, mate.id))
          .setPlaceholder(`Rate ${mate.name}`.slice(0, 150))
          .setMinValues(0)
          .setMaxValues(Object.keys(options).length)
          .addOptions(Object.entries(options).map(([value, label]) => ({ label, value })));
        return selectRow(menu);
      }),
      buttonRow(button(id('rsub', squad.id), 'Submit', ButtonStyle.Success)),
    ],
  };
}

export const isCommend = (value: string): value is Commend => Object.prototype.hasOwnProperty.call(COMMENDS, value);
