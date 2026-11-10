import { randomInt } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  SnowflakeUtil,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type StringSelectMenuInteraction,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notice, tcpEmbed } from '../bot/embeds.js';
import { ensurePanel, fetchSendableChannel } from '../bot/panels.js';
import { staffRoles } from '../bot/staff.js';
import { isEliteMember } from '../premium/premium.js';
import {
  COMMUNITIES,
  MAX_SQUAD,
  MATE_PING_MS,
  QUEUE_MAX_MS,
  READY_MS,
  SQUAD_CLOSE_MS,
  SQUAD_IDLE_MS,
  SQUAD_MAX_MS,
  SQUAD_MIN_AGE_MS,
  badges,
  bestJoiner,
  callSign,
  communityOf,
  compatible,
  formSquads,
  isLowTrust,
  pairScore,
  readCard,
  totalCommends,
  type Community,
  type LfgCard,
  type Seeker,
} from './lfgRules.js';
import { applyRatings, lfgPlayerOf, peekPlayer, playersStore, pruneSquads, squadsStore, type LfgPlayers, type RatingPicks, type SquadRecord } from './lfgStore.js';
import {
  LFG_PREFIX,
  RATE_AGAIN,
  RATE_BETRAYED,
  cardEditorView,
  cardEmbed,
  deployView,
  gamertagModal,
  id,
  isCommend,
  modeText,
  myCardView,
  panelMarker,
  panelView,
  ratingView,
  readyCheckView,
  searchingView,
  squadControls,
  squadIntroView,
  type CardDraft,
  type DeployDraft,
  type ReadyCheckState,
  type View,
} from './lfgViews.js';

// Squad Finder: a member makes a Survivor ID card once, presses Deploy, and waits in the queue; the matcher
// forms squads of compatible members (lfgRules), pings them in the lfg channel for a ready check, and gives
// a squad that accepts its own private text and voice channel. Afterwards squadmates rate each other:
// commendations show on the card, betrayal reports (private) keep repeat offenders matched only with each
// other. One community per server category with an "lfg" channel in it (COMMUNITIES).

const MATCH_EVERY_MS = 10 * 1000;
const SWEEP_EVERY_MS = 2 * 60 * 1000;
const PANEL_DELAY_MS = 5 * 1000;
const NOTICE_LIFETIME_MS = 60 * 1000;

const random = () => randomInt(0, 2 ** 32) / 2 ** 32;

let client: Client | null = null;
/** Members searching, by `${community}:${userId}`. */
const queue = new Map<string, Seeker>();
interface ReadyCheck extends ReadyCheckState {
  message: Message | null;
  timer: ReturnType<typeof setTimeout> | null;
  resolved: boolean;
}
const checks = new Map<string, ReadyCheck>();
const cardDrafts = new Map<string, CardDraft>();
const deployDrafts = new Map<string, DeployDraft>();
const ratingDrafts = new Map<string, Record<string, string[]>>();
/** When each squad's voice channel last had someone in it. */
const voiceSeen = new Map<string, number>();

const queueKey = (community: string, userId: string) => `${community}:${userId}`;
const draftKey = (userId: string, other: string) => `${userId}:${other}`;

function guildOf(): Guild | null {
  return client?.guilds.cache.get(env.DISCORD_GUILD_ID) ?? null;
}

function lfgChannelFor(guild: Guild | null, community: Community): TextChannel | null {
  const channel = guild?.channels.cache.find(
    (candidate) =>
      candidate.type === ChannelType.GuildText && /lfg/i.test(candidate.name) && Boolean(candidate.parent && community.categoryMatch.test(candidate.parent.name)),
  );
  return (channel as TextChannel | undefined) ?? null;
}

async function nameOf(userId: string): Promise<string> {
  const member = await guildOf()?.members.fetch(userId).catch(() => null);
  if (member) return member.displayName;
  const user = await client?.users.fetch(userId).catch(() => null);
  return user?.displayName ?? 'Unknown survivor';
}

async function stored<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    logger.warn({ err: error }, '[TCP LFG] The Squad Finder records could not be read or saved');
    return null;
  }
}

const STORE_DOWN = 'Squad Finder cannot reach its records right now. Try again in a minute.';

/** Shows a view privately: in place of the ephemeral message the button is on, or as a new private reply. */
async function show(interaction: ButtonInteraction | StringSelectMenuInteraction, view: View): Promise<void> {
  if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update(view);
  else await interaction.reply({ ...view, ephemeral: true });
}

async function say(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, text: string): Promise<void> {
  const payload = { ...notice(text), ephemeral: true };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

function deleteLater(message: Message | null): void {
  if (!message) return;
  setTimeout(() => void message.delete().catch(() => undefined), NOTICE_LIFETIME_MS).unref?.();
}

// ---- who is where ---------------------------------------------------------------------------------------

function pendingCheckOf(userId: string): ReadyCheck | undefined {
  return [...checks.values()].find((check) => !check.resolved && check.members.some((member) => member.userId === userId));
}

async function activeSquadOf(userId: string, community: string): Promise<SquadRecord | null> {
  const squads = await squadsStore.read();
  return Object.values(squads).find((squad) => squad.community === community && !squad.endedAt && squad.members.includes(userId)) ?? null;
}

/** Members never to be matched with this one: anyone they reported, and anyone who reported them. */
function avoidList(players: LfgPlayers, userId: string): string[] {
  const avoid = new Set(Object.keys(peekPlayer(players, userId).rep.betrayedBy));
  for (const otherId of Object.keys(players)) if (otherId !== userId && peekPlayer(players, otherId).rep.betrayedBy[userId]) avoid.add(otherId);
  return [...avoid];
}

function mutualMatesOf(players: LfgPlayers, userId: string): string[] {
  const rep = peekPlayer(players, userId).rep;
  return rep.playAgain.filter((otherId) => peekPlayer(players, otherId).rep.playAgain.includes(userId));
}

function seekerFrom(players: LfgPlayers, community: Community, userId: string, card: LfgCard, mode: string, size: number, since: number, elite: boolean): Seeker {
  return {
    userId,
    community: community.key,
    card,
    mode,
    size,
    since,
    lowTrust: isLowTrust(peekPlayer(players, userId).rep, Date.now()),
    elite,
    avoid: avoidList(players, userId),
    mates: mutualMatesOf(players, userId),
  };
}

/** Why a member cannot deploy right now (already searching, in a ready check or in a squad), or null. */
async function busyText(userId: string, community: Community): Promise<string | null> {
  if (queue.has(queueKey(community.key, userId))) return null;
  const check = pendingCheckOf(userId);
  if (check) return `A squad is waiting for you: answer the ready check${check.message ? ` (${check.message.url})` : ''}.`;
  const squad = await stored(activeSquadOf(userId, community.key));
  if (squad) return `You are in **Squad ${squad.callSign}**: <#${squad.textId}>. Leave it there before you deploy again.`;
  return null;
}

// ---- the panel --------------------------------------------------------------------------------------------

const panelTimers = new Map<string, ReturnType<typeof setTimeout>>();

function refreshPanel(community: Community): void {
  if (panelTimers.has(community.key)) return;
  const timer = setTimeout(() => {
    panelTimers.delete(community.key);
    void postPanel(community);
  }, PANEL_DELAY_MS);
  timer.unref?.();
  panelTimers.set(community.key, timer);
}

async function postPanel(community: Community): Promise<void> {
  const channel = lfgChannelFor(guildOf(), community);
  if (!client || !channel) return;
  const squads = (await stored(squadsStore.read())) ?? {};
  const mine = Object.values(squads).filter((squad) => squad.community === community.key);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const view = panelView(community, {
    searching: [...queue.values()].filter((seeker) => seeker.community === community.key),
    active: mine.filter((squad) => !squad.endedAt).length,
    formedToday: mine.filter((squad) => squad.createdAt >= dayStart.getTime()).length,
    open: mine.filter((squad) => !squad.endedAt && squad.open).length,
  });
  await ensurePanel(client, channel.id, panelMarker(community), view, `${community.name} Squad Finder`);
}

// ---- the card ---------------------------------------------------------------------------------------------

const STEP_ONE: (keyof LfgCard)[] = ['platform', 'region', 'playstyles', 'mic'];
const STEP_TWO: (keyof LfgCard)[] = ['experience', 'server', 'language'];
const missing = (draft: CardDraft, fields: (keyof LfgCard)[]) =>
  fields.some((field) => draft[field] === undefined || (Array.isArray(draft[field]) && (draft[field] as unknown[]).length === 0));

async function draftFor(userId: string, community: Community): Promise<CardDraft> {
  const key = draftKey(userId, community.key);
  const existing = cardDrafts.get(key);
  if (existing) return existing;
  const players = await stored(playersStore.read());
  const card = players ? peekPlayer(players, userId).cards[community.key] : undefined;
  const draft: CardDraft = card ? { ...card, playstyles: [...card.playstyles] } : {};
  cardDrafts.set(key, draft);
  return draft;
}

async function onCardButton(interaction: ButtonInteraction, community: Community): Promise<void> {
  const players = await stored(playersStore.read());
  if (!players) return say(interaction, STORE_DOWN);
  const player = peekPlayer(players, interaction.user.id);
  const card = player.cards[community.key];
  if (!card) {
    await show(interaction, cardEditorView(community, await draftFor(interaction.user.id, community), 1, 'Fill in your Survivor ID once; you can change it any time.'));
    return;
  }
  const elite = client ? await isEliteMember(client, interaction.user.id) : false;
  await show(interaction, myCardView(community, card, player.rep, await nameOf(interaction.user.id), elite));
}

async function onEditorStep(interaction: ButtonInteraction, community: Community, step: 1 | 2): Promise<void> {
  const draft = await draftFor(interaction.user.id, community);
  if (step === 2 && missing(draft, STEP_ONE)) {
    await show(interaction, cardEditorView(community, draft, 1, '⚠️ Pick your platform, region, playstyles and mic first.'));
    return;
  }
  await show(interaction, cardEditorView(community, draft, step));
}

async function onEditorPick(interaction: StringSelectMenuInteraction, community: Community, field: string): Promise<void> {
  const draft = await draftFor(interaction.user.id, community);
  const values = interaction.values;
  if (field === 'playstyles') draft.playstyles = values.filter((value) => community.playstyles[value]).slice(0, 3);
  else if (STEP_ONE.includes(field as keyof LfgCard) || STEP_TWO.includes(field as keyof LfgCard)) (draft as Record<string, unknown>)[field] = values[0];
  await interaction.update(cardEditorView(community, draft, STEP_TWO.includes(field as keyof LfgCard) ? 2 : 1));
}

async function onGamertagButton(interaction: ButtonInteraction, community: Community): Promise<void> {
  const draft = await draftFor(interaction.user.id, community);
  if (missing(draft, STEP_ONE)) return void (await show(interaction, cardEditorView(community, draft, 1, '⚠️ Pick your platform, region, playstyles and mic first.')));
  if (missing(draft, STEP_TWO)) return void (await show(interaction, cardEditorView(community, draft, 2, '⚠️ Pick your experience, servers and language first.')));
  await interaction.showModal(gamertagModal(community, draft));
}

async function onCardSaved(interaction: ModalSubmitInteraction, community: Community): Promise<void> {
  const userId = interaction.user.id;
  const draft = await draftFor(userId, community);
  draft.gamertag = interaction.fields.getTextInputValue('gamertag');
  draft.bio = interaction.fields.getTextInputValue('bio');
  const card = readCard({ ...draft, updatedAt: Date.now() }, community);
  if (!card) return say(interaction, 'Something is missing from your Survivor ID. Open **My Survivor ID** and fill in every choice.');
  const saved = await stored(
    playersStore.update((players) => {
      const player = lfgPlayerOf(players, userId);
      player.cards[community.key] = card;
      return { rep: player.rep };
    }),
  );
  if (!saved) return say(interaction, STORE_DOWN);
  cardDrafts.delete(draftKey(userId, community.key));
  const searching = queue.get(queueKey(community.key, userId));
  if (searching) searching.card = card;
  const elite = client ? await isEliteMember(client, userId) : false;
  const view = myCardView(community, card, saved.rep, await nameOf(userId), elite);
  view.embeds.unshift(tcpEmbed({ description: '✅ **Survivor ID saved.** Press **Deploy** to find a squad.', tone: 'success' }));
  if (interaction.isFromMessage()) await interaction.update(view);
  else await interaction.reply({ ...view, ephemeral: true });
}

// ---- deploying --------------------------------------------------------------------------------------------

async function onDeploy(interaction: ButtonInteraction, community: Community): Promise<void> {
  const userId = interaction.user.id;
  const players = await stored(playersStore.read());
  if (!players) return say(interaction, STORE_DOWN);
  const card = peekPlayer(players, userId).cards[community.key];
  if (!card) {
    await show(interaction, cardEditorView(community, await draftFor(userId, community), 1, 'Make your Survivor ID first, then Deploy. It takes a minute and you only do it once.'));
    return;
  }
  const searching = queue.get(queueKey(community.key, userId));
  if (searching) {
    await show(interaction, searchingView(community, searching, lfgChannelFor(guildOf(), community)?.id ?? null, compatibleCount(searching)));
    return;
  }
  const busy = await busyText(userId, community);
  if (busy) return say(interaction, busy);
  const key = draftKey(userId, community.key);
  const draft = deployDrafts.get(key) ?? { mode: 'any', size: 0 };
  deployDrafts.set(key, draft);
  await show(interaction, deployView(community, draft));
}

async function onDeployPick(interaction: StringSelectMenuInteraction, community: Community, field: string): Promise<void> {
  const key = draftKey(interaction.user.id, community.key);
  const draft = deployDrafts.get(key) ?? { mode: 'any', size: 0 };
  const value = interaction.values[0] ?? '';
  if (field === 'mode') draft.mode = value === 'any' || community.playstyles[value] ? value : 'any';
  else if (field === 'size') draft.size = [0, 2, 3, 4, 5].includes(Number(value)) ? Number(value) : 0;
  deployDrafts.set(key, draft);
  await interaction.update(deployView(community, draft));
}

function compatibleCount(seeker: Seeker): number {
  const now = Date.now();
  return [...queue.values()].filter((other) => compatible(seeker, other, now)).length;
}

async function onGo(interaction: ButtonInteraction, community: Community): Promise<void> {
  const userId = interaction.user.id;
  await interaction.deferUpdate();
  const busy = await busyText(userId, community);
  if (busy) return say(interaction, busy);
  const existing = queue.get(queueKey(community.key, userId));
  const players = await stored(playersStore.read());
  if (!players) return say(interaction, STORE_DOWN);
  const card = peekPlayer(players, userId).cards[community.key];
  if (!card) return say(interaction, 'Make your Survivor ID first: **🪪 My Survivor ID**.');
  const draft = deployDrafts.get(draftKey(userId, community.key)) ?? { mode: 'any', size: 0 };
  const elite = client ? await isEliteMember(client, userId) : false;
  const seeker = seekerFrom(players, community, userId, card, draft.mode, draft.size, existing?.since ?? Date.now(), elite);
  queue.set(queueKey(community.key, userId), seeker);
  logger.info(`[TCP LFG] ${userId} deployed in ${community.name} (${seeker.mode}, size ${seeker.size || 'any'})`);
  await interaction.editReply(searchingView(community, seeker, lfgChannelFor(guildOf(), community)?.id ?? null, compatibleCount(seeker)));
  refreshPanel(community);
  void pingMates(community, seeker, players);
  scheduleMatching();
}

async function onLeaveQueue(interaction: ButtonInteraction, community: Community): Promise<void> {
  const left = queue.delete(queueKey(community.key, interaction.user.id));
  await show(interaction, { ...notice(left ? 'You left the queue. Deploy again any time.' : 'You were not in the queue.'), components: [] });
  refreshPanel(community);
}

/** Tells a member's mutual squadmates (by DM, at most once in 6 hours each) that they just deployed. */
async function pingMates(community: Community, seeker: Seeker, players: LfgPlayers): Promise<void> {
  const channel = lfgChannelFor(guildOf(), community);
  const now = Date.now();
  const name = await nameOf(seeker.userId);
  for (const mateId of seeker.mates) {
    if (queue.has(queueKey(community.key, mateId))) continue;
    if (now - (peekPlayer(players, mateId).matePings[seeker.userId] ?? 0) < MATE_PING_MS) continue;
    const user = await client?.users.fetch(mateId).catch(() => null);
    const sent = await user
      ?.send({
        embeds: [
          tcpEmbed({
            title: '🤝 Your squadmate is deploying',
            description: `**${name}** just deployed in the ${community.name} Squad Finder. You both said you would play again: deploy now and you will be matched first${channel ? ` → <#${channel.id}>` : ''}.`,
          }),
        ],
      })
      .then(() => true)
      .catch(() => false);
    if (sent)
      await stored(
        playersStore.update((all) => {
          lfgPlayerOf(all, mateId).matePings[seeker.userId] = now;
        }),
      );
  }
}

// ---- matching and ready checks ----------------------------------------------------------------------------

let matching = false;
let matchSoon: ReturnType<typeof setTimeout> | null = null;

function scheduleMatching(): void {
  if (matchSoon) return;
  matchSoon = setTimeout(() => {
    matchSoon = null;
    void runMatching();
  }, 500);
  matchSoon.unref?.();
}

async function runMatching(): Promise<void> {
  if (matching || !client) return;
  matching = true;
  try {
    const now = Date.now();
    for (const [key, seeker] of queue) {
      if (now - seeker.since > QUEUE_MAX_MS) {
        queue.delete(key);
        refreshPanel(communityOf(seeker.community)!);
      }
    }
    const guild = guildOf();
    for (const community of COMMUNITIES) {
      if (!lfgChannelFor(guild, community)) continue;
      let seekers = [...queue.values()].filter((seeker) => seeker.community === community.key);
      if (seekers.length === 0) continue;

      // Open squads first: their missing member is the longest wait of all.
      const squads = (await stored(squadsStore.read())) ?? {};
      const players = (await stored(playersStore.read())) ?? {};
      const offered = new Set([...checks.values()].filter((check) => check.join && !check.resolved).map((check) => check.join!.id));
      for (const squad of Object.values(squads)) {
        if (squad.community !== community.key || squad.endedAt || !squad.open || offered.has(squad.id) || squad.members.length >= MAX_SQUAD) continue;
        const members: Seeker[] = [];
        for (const memberId of squad.members) {
          const card = peekPlayer(players, memberId).cards[community.key];
          if (card) members.push(seekerFrom(players, community, memberId, card, squad.mode, 0, squad.openedAt, false));
        }
        if (members.length === 0) continue;
        const joiner = bestJoiner(members, seekers, now);
        if (!joiner) continue;
        seekers = seekers.filter((seeker) => seeker.userId !== joiner.members[0]!.userId);
        await startCheck(community, joiner.members, joiner.score, squad);
      }

      for (const match of formSquads(seekers, now)) await startCheck(community, match.members, match.score, null);
    }
  } catch (error) {
    logger.warn({ err: error }, '[TCP LFG] Matching failed');
  } finally {
    matching = false;
  }
}

async function startCheck(community: Community, members: Seeker[], score: number, join: SquadRecord | null): Promise<void> {
  const channel = lfgChannelFor(guildOf(), community);
  if (!channel) return;
  for (const member of members) queue.delete(queueKey(community.key, member.userId));
  const check: ReadyCheck = {
    id: randomInt(0, 2 ** 40).toString(36),
    community,
    members,
    score,
    accepted: new Set(),
    declined: new Set(),
    expires: Date.now() + READY_MS,
    join,
    message: null,
    timer: null,
    resolved: false,
  };
  checks.set(check.id, check);
  const userIds = members.map((member) => member.userId);
  try {
    check.message = await channel.send({ ...readyCheckView(check, 'open'), content: `${userIds.map((userId) => `<@${userId}>`).join(' ')} your squad is ready!`, allowedMentions: { users: userIds } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP LFG] Could not post a ready check');
  }
  check.timer = setTimeout(() => void resolveCheck(check), READY_MS);
  check.timer.unref?.();
  refreshPanel(community);
}

async function onReadyAnswer(interaction: ButtonInteraction, checkId: string, answer: string): Promise<void> {
  const check = checks.get(checkId);
  if (!check || check.resolved) return say(interaction, 'This ready check is over.');
  const userId = interaction.user.id;
  if (!check.members.some((member) => member.userId === userId)) return say(interaction, 'This ready check is for the survivors it names. Press **Deploy** on the panel to find your own squad.');
  if (answer === 'yes') check.accepted.add(userId);
  else {
    check.accepted.delete(userId);
    check.declined.add(userId);
  }
  const done = check.declined.size > 0 || check.accepted.size === check.members.length;
  await interaction.update({ ...readyCheckView(check, 'open'), ...(done ? { components: [] } : {}) });
  if (done) await resolveCheck(check);
}

async function resolveCheck(check: ReadyCheck): Promise<void> {
  if (check.resolved) return;
  check.resolved = true;
  if (check.timer) clearTimeout(check.timer);
  checks.delete(check.id);
  const { community } = check;
  const everyone = check.accepted.size === check.members.length;

  if (everyone) {
    try {
      const squad = check.join ? await addToSquad(check.join.id, check.members[0]!) : await createSquad(community, check.members, check.score);
      await check.message?.edit({ ...readyCheckView(check, 'formed', `✅ **Squad ${squad.callSign}** is deployed: <#${squad.textId}>`), content: '' }).catch(() => undefined);
    } catch (error) {
      logger.warn({ err: error }, '[TCP LFG] Could not create or join the squad');
      const now = Date.now();
      for (const member of check.members) queue.set(queueKey(community.key, member.userId), { ...member, since: Math.min(member.since, now) });
      const why = check.join
        ? `⚠️ Squad ${check.join.callSign} closed before you could join. You are back in the queue, at the front.`
        : '⚠️ The squad channels could not be made (the bot needs **Manage Channels** and **Manage Roles** in this category). Everyone is back in the queue.';
      await check.message?.edit({ ...readyCheckView(check, 'failed', why), content: '' }).catch(() => undefined);
    }
  } else {
    // Whoever accepted goes back to the queue with the time they first deployed: the front of the line.
    for (const member of check.members) if (check.accepted.has(member.userId)) queue.set(queueKey(community.key, member.userId), member);
    const declined = check.declined.size > 0;
    await check.message
      ?.edit({
        ...readyCheckView(
          check,
          'failed',
          `${declined ? '❌ Someone declined.' : '💤 Not everyone answered in time.'} Survivors who accepted are back in the queue, at the front. The others left it.`,
        ),
        content: '',
      })
      .catch(() => undefined);
  }
  deleteLater(check.message);
  refreshPanel(community);
  scheduleMatching();
}

// ---- squads -----------------------------------------------------------------------------------------------

const TEXT_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
];
const VOICE_ALLOW = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD];

function squadOverwrites(guild: Guild, memberIds: string[], botId: string, kind: 'text' | 'voice'): OverwriteResolvable[] {
  const allow = kind === 'text' ? TEXT_ALLOW : VOICE_ALLOW;
  return [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...memberIds.map((memberId) => ({ id: memberId, type: OverwriteType.Member, allow })),
    { id: botId, type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels] },
    // The team can look in on a squad (reports), but is not pinged or listed.
    ...staffRoles(guild).map((role) => ({ id: role.id, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
  ];
}

const memberAllow = (kind: 'text' | 'voice') =>
  Object.fromEntries(
    (kind === 'text'
      ? ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'AddReactions']
      : ['ViewChannel', 'Connect', 'Speak', 'Stream', 'UseVAD']
    ).map((flag) => [flag, true]),
  );

async function memberCards(community: Community, memberIds: string[]): Promise<ReturnType<typeof cardEmbed>[]> {
  const players = (await stored(playersStore.read())) ?? {};
  const cards: ReturnType<typeof cardEmbed>[] = [];
  for (const memberId of memberIds) {
    const player = peekPlayer(players, memberId);
    const card = player.cards[community.key];
    if (!card) continue;
    const elite = client ? await isEliteMember(client, memberId) : false;
    cards.push(cardEmbed(community, card, player.rep, await nameOf(memberId), { elite, showTag: true }));
  }
  return cards;
}

async function createSquad(community: Community, members: Seeker[], score: number): Promise<SquadRecord> {
  const guild = guildOf();
  const lfg = lfgChannelFor(guild, community);
  if (!guild || !client?.user) throw new Error('No guild');
  const sign = callSign(random);
  const slug = sign.toLowerCase().replace(/\s+/g, '-');
  const memberIds = members.map((member) => member.userId);
  const parent = lfg?.parentId ?? undefined;
  const text = await guild.channels.create({
    name: `🪖・squad-${slug}`,
    type: ChannelType.GuildText,
    parent,
    topic: `T.C.P Squad Finder · Squad ${sign} · private to its members`,
    permissionOverwrites: squadOverwrites(guild, memberIds, client.user.id, 'text'),
  });
  let voice: VoiceChannel;
  try {
    voice = await guild.channels.create({
      name: `🔊 Squad ${sign}`,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: Math.min(MAX_SQUAD, Math.max(members.length, 2)),
      permissionOverwrites: squadOverwrites(guild, memberIds, client.user.id, 'voice'),
    });
  } catch (error) {
    await text.delete().catch(() => undefined);
    throw error;
  }
  const first = members[0]!;
  const now = Date.now();
  const squad: SquadRecord = {
    id: randomInt(0, 2 ** 40).toString(36),
    community: community.key,
    guildId: guild.id,
    callSign: sign,
    platform: first.card.platform,
    region: first.card.region,
    language: first.card.language,
    mode: majorityMode(members),
    score,
    members: memberIds,
    former: [],
    textId: text.id,
    voiceId: voice.id,
    createdAt: now,
    open: false,
    openedAt: 0,
    endedAt: null,
    endReason: null,
    channelsDeleted: false,
    rated: [],
  };
  try {
    await squadsStore.update((squads) => {
      squads[squad.id] = squad;
    });
  } catch (error) {
    // Without its record nothing would ever close these channels: remove them and let the caller requeue.
    await text.delete().catch(() => undefined);
    await voice.delete().catch(() => undefined);
    throw error;
  }
  await stored(
    playersStore.update((players) => {
      for (const memberId of memberIds) lfgPlayerOf(players, memberId).rep.squads += 1;
    }),
  );
  const tip = community.serverTip && members.some((member) => community.serverTip!.servers.includes(member.card.server)) ? community.serverTip.text : null;
  await text.send(squadIntroView(community, squad, await memberCards(community, memberIds), tip));
  logger.info(`[TCP LFG] Squad ${sign} formed in ${community.name}: ${memberIds.join(', ')} (${score}%)`);
  return squad;
}

function majorityMode(members: Seeker[]): string {
  const counts = new Map<string, number>();
  for (const member of members) if (member.mode !== 'any') counts.set(member.mode, (counts.get(member.mode) ?? 0) + 1);
  let best = 'any';
  let bestCount = 0;
  for (const [mode, count] of counts) if (count > bestCount) [best, bestCount] = [mode, count];
  return best;
}

async function channelsOf(squad: SquadRecord): Promise<{ text: TextChannel | null; voice: VoiceChannel | null }> {
  const guild = guildOf();
  const fetch = async (channelId: string) => (guild ? ((await guild.channels.fetch(channelId).catch(() => null)) as GuildBasedChannel | null) : null);
  const text = await fetch(squad.textId);
  const voice = await fetch(squad.voiceId);
  return { text: text?.type === ChannelType.GuildText ? (text as TextChannel) : null, voice: voice?.type === ChannelType.GuildVoice ? (voice as VoiceChannel) : null };
}

async function addToSquad(squadId: string, seeker: Seeker): Promise<SquadRecord> {
  const squads = await squadsStore.read();
  const squad = squads[squadId];
  if (!squad || squad.endedAt) throw new Error('The squad is gone');
  const { text, voice } = await channelsOf(squad);
  if (!text || !voice) throw new Error('The squad channels are gone');
  await text.permissionOverwrites.edit(seeker.userId, memberAllow('text'));
  await voice.permissionOverwrites.edit(seeker.userId, memberAllow('voice'));
  const size = squad.members.length + 1;
  if ((voice.userLimit || 0) < size) await voice.setUserLimit(Math.min(MAX_SQUAD, size)).catch(() => undefined);
  const updated = await squadsStore.update((all) => {
    const record = all[squadId]!;
    if (!record.members.includes(seeker.userId)) record.members.push(seeker.userId);
    record.former = record.former.filter((formerId) => formerId !== seeker.userId);
    record.open = false;
    return { ...record };
  });
  await stored(
    playersStore.update((players) => {
      lfgPlayerOf(players, seeker.userId).rep.squads += 1;
    }),
  );
  const community = communityOf(squad.community)!;
  await text.send({
    content: `<@${seeker.userId}>`,
    allowedMentions: { users: [seeker.userId] },
    embeds: [tcpEmbed({ description: `➕ <@${seeker.userId}> joined **Squad ${squad.callSign}**. The slot is closed again.`, tone: 'success' }), ...(await memberCards(community, [seeker.userId]))],
    components: [squadControls(updated)],
  });
  refreshPanel(community);
  return updated;
}

async function endSquad(squadId: string, reason: string, endedBy: string | null): Promise<void> {
  const squad = await stored(
    squadsStore.update((squads) => {
      const record = squads[squadId];
      if (!record || record.endedAt) return null;
      record.endedAt = Date.now();
      record.endReason = reason;
      record.open = false;
      return { ...record };
    }),
  );
  if (!squad) return;
  const { text } = await channelsOf(squad);
  const rateRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id('rate', squad.id)).setLabel('⭐ Rate your squadmates').setStyle(ButtonStyle.Success),
  );
  await text
    ?.send({
      embeds: [
        tcpEmbed({
          title: `🏁 Squad ${squad.callSign} has ended`,
          description: `${reason}\n\nRate your squadmates: it builds everyone's reputation, and **🤝 Play again** lets you find each other next time. This channel closes <t:${Math.floor((squad.endedAt! + SQUAD_CLOSE_MS) / 1000)}:R>.`,
        }),
      ],
      components: [rateRow],
    })
    .catch(() => undefined);
  // Everyone else gets the rating button by DM too, in case they already left the channel.
  for (const memberId of [...squad.members, ...squad.former]) {
    if (memberId === endedBy || squad.rated.includes(memberId)) continue;
    const user = await client?.users.fetch(memberId).catch(() => null);
    await user
      ?.send({ embeds: [tcpEmbed({ title: `🏁 Squad ${squad.callSign} has ended`, description: 'How was it? Rate your squadmates (you have 24 hours).' })], components: [rateRow] })
      .catch(() => undefined);
  }
  logger.info(`[TCP LFG] Squad ${squad.callSign} ended: ${reason}`);
  refreshPanel(communityOf(squad.community)!);
}

async function onSquadButton(interaction: ButtonInteraction, squadId: string, op: string): Promise<void> {
  const squads = await stored(squadsStore.read());
  if (!squads) return say(interaction, STORE_DOWN);
  const squad = squads[squadId];
  const userId = interaction.user.id;
  if (!squad || squad.endedAt) return say(interaction, 'This squad has ended.');
  if (!squad.members.includes(userId)) return say(interaction, 'Only the squad\'s members can use these buttons.');
  const community = communityOf(squad.community)!;

  if (op === 'tags') {
    const players = (await stored(playersStore.read())) ?? {};
    const lines = await Promise.all(
      squad.members.map(async (memberId) => {
        const card = peekPlayer(players, memberId).cards[community.key];
        return `**${await nameOf(memberId)}** · ${card ? `\`${card.gamertag}\`` : 'no Survivor ID'}`;
      }),
    );
    await interaction.reply({ ...notice(`📋 **Squad ${squad.callSign}: add each other in game**\n\n${lines.join('\n')}`), ephemeral: true });
    return;
  }

  if (op === 'open' || op === 'close') {
    if (op === 'open' && squad.members.length >= MAX_SQUAD) return say(interaction, `A squad holds at most ${MAX_SQUAD}.`);
    const updated = await stored(
      squadsStore.update((all) => {
        const record = all[squadId]!;
        record.open = op === 'open';
        record.openedAt = op === 'open' ? Date.now() : record.openedAt;
        return { ...record };
      }),
    );
    if (!updated) return say(interaction, STORE_DOWN);
    await interaction.update({ components: [squadControls(updated)] });
    await interaction.followUp({
      embeds: [
        tcpEmbed({
          description:
            op === 'open'
              ? `➕ <@${userId}> opened a slot: **Squad ${squad.callSign}** is looking for +1. The queue will fill it with the best fit, and it shows under **Open squads**.`
              : `🔒 <@${userId}> closed the slot.`,
        }),
      ],
      allowedMentions: { parse: [] },
    });
    refreshPanel(community);
    if (op === 'open') scheduleMatching();
    return;
  }

  if (op === 'leave') {
    const updated = await stored(
      squadsStore.update((all) => {
        const record = all[squadId]!;
        record.members = record.members.filter((memberId) => memberId !== userId);
        if (!record.former.includes(userId)) record.former.push(userId);
        return { ...record };
      }),
    );
    if (!updated) return say(interaction, STORE_DOWN);
    await interaction.reply({ ...(await ratingFor(updated, userId)), ephemeral: true });
    const { text, voice } = await channelsOf(updated);
    await text?.send({ embeds: [tcpEmbed({ description: `🚪 <@${userId}> left the squad.` })], allowedMentions: { parse: [] } }).catch(() => undefined);
    await text?.permissionOverwrites.delete(userId).catch(() => undefined);
    await voice?.permissionOverwrites.delete(userId).catch(() => undefined);
    if (updated.members.length < 2) await endSquad(squadId, 'Everyone else left the squad.', userId);
    return;
  }

  if (op === 'end') {
    await interaction.reply({ ...(await ratingFor(squad, userId)), ephemeral: true });
    await endSquad(squadId, `<@${userId}> ended the squad.`, userId);
  }
}

// ---- open squads and the trust board ----------------------------------------------------------------------

async function onOpenSquads(interaction: ButtonInteraction, community: Community): Promise<void> {
  const userId = interaction.user.id;
  const [squads, players] = await Promise.all([stored(squadsStore.read()), stored(playersStore.read())]);
  if (!squads || !players) return say(interaction, STORE_DOWN);
  const card = peekPlayer(players, userId).cards[community.key];
  if (!card) return void (await show(interaction, cardEditorView(community, await draftFor(userId, community), 1, 'Make your Survivor ID first, then you can join open squads.')));
  const me = seekerFrom(players, community, userId, card, 'any', 0, Date.now(), false);
  const now = Date.now();
  const fits = Object.values(squads)
    .filter((squad) => squad.community === community.key && !squad.endedAt && squad.open && !squad.members.includes(userId) && squad.members.length < MAX_SQUAD)
    .map((squad) => {
      const members = squad.members
        .map((memberId) => {
          const memberCard = peekPlayer(players, memberId).cards[community.key];
          return memberCard ? seekerFrom(players, community, memberId, memberCard, squad.mode, 0, squad.openedAt, false) : null;
        })
        .filter((member): member is Seeker => member !== null);
      const ok = members.length > 0 && members.every((member) => compatible(member, { ...me, since: now - 10 * 60 * 1000 }, now));
      const fit = ok ? Math.round(members.reduce((sum, member) => sum + pairScore(member, me), 0) / members.length) : 0;
      return { squad, ok, fit };
    })
    .filter((entry) => entry.ok)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 5);
  if (fits.length === 0) return say(interaction, 'No open squad fits you right now. Press **Deploy** and the queue will find you one.');
  await interaction.reply({
    embeds: [
      tcpEmbed({
        title: `🔓 Open ${community.name} squads`,
        description: fits.map(({ squad, fit }) => `**Squad ${squad.callSign}** · ${modeText(community, squad.mode)} · ${squad.members.length}/${squad.members.length + 1} · **${fit}%** fit`).join('\n'),
      }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        fits.map(({ squad }) => new ButtonBuilder().setCustomId(id('join', squad.id)).setLabel(`Join ${squad.callSign}`).setStyle(ButtonStyle.Success)),
      ),
    ],
    ephemeral: true,
  });
}

async function onJoin(interaction: ButtonInteraction, squadId: string): Promise<void> {
  const userId = interaction.user.id;
  await interaction.deferUpdate();
  const [squads, players] = await Promise.all([stored(squadsStore.read()), stored(playersStore.read())]);
  if (!squads || !players) return say(interaction, STORE_DOWN);
  const squad = squads[squadId];
  if (!squad || squad.endedAt || !squad.open) return say(interaction, 'That slot has been filled or closed. Press **Deploy** to find another squad.');
  const community = communityOf(squad.community)!;
  const busy = await busyText(userId, community);
  if (busy) return say(interaction, busy);
  const card = peekPlayer(players, userId).cards[community.key];
  if (!card) return say(interaction, 'Make your Survivor ID first.');
  const seeker = seekerFrom(players, community, userId, card, squad.mode, 0, Date.now(), false);
  const now = Date.now();
  const fits = squad.members.every((memberId) => {
    const memberCard = peekPlayer(players, memberId).cards[community.key];
    return memberCard ? compatible(seekerFrom(players, community, memberId, memberCard, squad.mode, 0, now - 10 * 60 * 1000, false), seeker, now) : true;
  });
  if (!fits) return say(interaction, 'That squad is not a fit for you (platform, language or region). Press **Deploy** to find another.');
  queue.delete(queueKey(community.key, userId));
  try {
    const joined = await addToSquad(squadId, seeker);
    await interaction.editReply({ ...notice(`✅ You joined **Squad ${joined.callSign}**: <#${joined.textId}>`, { tone: 'success' }), components: [] });
  } catch (error) {
    logger.warn({ err: error }, '[TCP LFG] Could not join a squad');
    await say(interaction, 'Could not add you to that squad. Try **Deploy** instead.');
  }
}

async function onTrustBoard(interaction: ButtonInteraction, community: Community): Promise<void> {
  const players = await stored(playersStore.read());
  if (!players) return say(interaction, STORE_DOWN);
  const now = Date.now();
  const ranked = Object.keys(players)
    .map((userId) => ({ userId, player: peekPlayer(players, userId) }))
    .filter(({ player }) => player.cards[community.key] && !isLowTrust(player.rep, now) && totalCommends(player.rep) > 0)
    .sort((a, b) => totalCommends(b.player.rep) - totalCommends(a.player.rep) || b.player.rep.squads - a.player.rep.squads)
    .slice(0, 10);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranked.map(({ userId, player }, index) => `${medals[index] ?? `**${index + 1}.**`} <@${userId}> · ${badges(player.rep, 3)} · ${player.rep.squads} squads`);
  await interaction.reply({
    embeds: [
      tcpEmbed({
        title: `🏆 Most trusted ${community.name} survivors`,
        description: lines.join('\n') || 'No commendations yet. Squad up, then rate your squadmates.',
        footer: 'Commendations come from squadmates after every squad.',
      }),
    ],
    ephemeral: true,
  });
}

// ---- ratings ------------------------------------------------------------------------------------------------

async function ratingFor(squad: SquadRecord, raterId: string): Promise<View> {
  const teammates = await Promise.all(
    [...squad.members, ...squad.former].filter((memberId, index, all) => memberId !== raterId && all.indexOf(memberId) === index).map(async (memberId) => ({ id: memberId, name: await nameOf(memberId) })),
  );
  if (teammates.length === 0) return { ...notice('Nobody else was in the squad, so there is nobody to rate.'), components: [] };
  return ratingView(squad, teammates);
}

async function onRateButton(interaction: ButtonInteraction, squadId: string): Promise<void> {
  const squads = await stored(squadsStore.read());
  if (!squads) return say(interaction, STORE_DOWN);
  const squad = squads[squadId];
  const userId = interaction.user.id;
  if (!squad) return say(interaction, 'Ratings for this squad have closed.');
  if (![...squad.members, ...squad.former].includes(userId)) return say(interaction, 'Only the squad\'s members can rate it.');
  if (squad.rated.includes(userId)) return say(interaction, 'You already rated this squad. Thanks!');
  await interaction.reply({ ...(await ratingFor(squad, userId)), ephemeral: true });
}

async function onRatePick(interaction: StringSelectMenuInteraction, squadId: string, targetId: string): Promise<void> {
  const key = draftKey(interaction.user.id, squadId);
  const picks = ratingDrafts.get(key) ?? {};
  picks[targetId] = interaction.values;
  ratingDrafts.set(key, picks);
  await interaction.deferUpdate();
}

async function onRateSubmit(interaction: ButtonInteraction, squadId: string): Promise<void> {
  const raterId = interaction.user.id;
  const draft = ratingDrafts.get(draftKey(raterId, squadId)) ?? {};
  const marked = await stored(
    squadsStore.update((squads) => {
      const squad = squads[squadId];
      if (!squad || squad.rated.includes(raterId) || ![...squad.members, ...squad.former].includes(raterId)) return null;
      squad.rated.push(raterId);
      return [...squad.members, ...squad.former];
    }),
  );
  if (!marked) {
    await interaction.update({ ...notice('Ratings for this squad are closed, or you already rated it.'), components: [] });
    return;
  }
  const picks: Record<string, RatingPicks> = {};
  for (const [targetId, values] of Object.entries(draft)) {
    if (!marked.includes(targetId) || targetId === raterId) continue;
    picks[targetId] = { commends: values.filter(isCommend), again: values.includes(RATE_AGAIN), betrayed: values.includes(RATE_BETRAYED) };
  }
  const now = Date.now();
  const flagged = await stored(playersStore.update((players) => applyRatings(players, raterId, picks, now, (rep) => isLowTrust(rep, now))));
  ratingDrafts.delete(draftKey(raterId, squadId));
  await interaction.update({ ...notice('✅ **Thanks!** Your ratings are in.', { tone: 'success' }), components: [] });
  for (const userId of flagged ?? []) await flagLowTrust(userId);
}

async function flagLowTrust(userId: string): Promise<void> {
  logger.warn(`[TCP LFG] ${userId} is now low-trust (betrayal reports)`);
  if (!client || !env.LOG_CHANNEL_ID) return;
  const log = await fetchSendableChannel(client, env.LOG_CHANNEL_ID).catch(() => null);
  await log
    ?.send({
      embeds: [
        tcpEmbed({
          title: '🗡️ Squad Finder: low trust',
          description: `<@${userId}> (\`${userId}\`) was reported for betraying their squad by 3 or more different members in 60 days. From now on Squad Finder only matches them with other low-trust members. The reports are private; their squads' channels were open to the team while they lasted.`,
          tone: 'danger',
        }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}

// ---- the sweep: idle squads end, ended squads close ------------------------------------------------------------

let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping || !client) return;
  sweeping = true;
  try {
    const squads = await squadsStore.read();
    const now = Date.now();
    for (const squad of Object.values(squads)) {
      if (!squad.endedAt) {
        const { text, voice } = await channelsOf(squad);
        if (!text) {
          await endSquad(squad.id, 'The squad channel was deleted.', null);
          continue;
        }
        if (voice && voice.members.size > 0) voiceSeen.set(squad.id, now);
        const lastMessageAt = text.lastMessageId ? SnowflakeUtil.timestampFrom(text.lastMessageId) : 0;
        const lastActive = Math.max(squad.createdAt, squad.openedAt, lastMessageAt, voiceSeen.get(squad.id) ?? 0);
        if (now - squad.createdAt > SQUAD_MAX_MS) await endSquad(squad.id, 'Squads close after 12 hours.', null);
        else if (now - squad.createdAt > SQUAD_MIN_AGE_MS && now - lastActive > SQUAD_IDLE_MS) await endSquad(squad.id, 'Nobody talked or was in voice for an hour.', null);
        continue;
      }
      if (!squad.channelsDeleted && now - squad.endedAt > SQUAD_CLOSE_MS) {
        const { text, voice } = await channelsOf(squad);
        await text?.delete('Squad Finder: the squad ended').catch(() => undefined);
        await voice?.delete('Squad Finder: the squad ended').catch(() => undefined);
        voiceSeen.delete(squad.id);
        await squadsStore.update((all) => {
          if (all[squad.id]) all[squad.id]!.channelsDeleted = true;
        });
      }
    }
    await squadsStore.update((all) => pruneSquads(all, now));
  } catch (error) {
    logger.warn({ err: error }, '[TCP LFG] The squad sweep failed');
  } finally {
    sweeping = false;
  }
}

// ---- routing and startup ------------------------------------------------------------------------------------

export async function handleLfgInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
  if (!interaction.customId.startsWith(LFG_PREFIX)) return false;
  const [action = '', first = '', second = ''] = interaction.customId.slice(LFG_PREFIX.length).split(':');
  const community = communityOf(first);

  if (interaction.isModalSubmit()) {
    if (action === 'cmod' && community) await onCardSaved(interaction, community);
    else await interaction.deferUpdate().catch(() => undefined);
    return true;
  }
  if (interaction.isStringSelectMenu()) {
    if (action === 'cf' && community) await onEditorPick(interaction, community, second);
    else if (action === 'df' && community) await onDeployPick(interaction, community, second);
    else if (action === 'rs') await onRatePick(interaction, first, second);
    else await interaction.deferUpdate();
    return true;
  }

  if (action === 'deploy' && community) await onDeploy(interaction, community);
  else if (action === 'card' && community) await onCardButton(interaction, community);
  else if (action === 'ce' && community) await onEditorStep(interaction, community, second === '2' ? 2 : 1);
  else if (action === 'cg' && community) await onGamertagButton(interaction, community);
  else if (action === 'go' && community) await onGo(interaction, community);
  else if (action === 'leave' && community) await onLeaveQueue(interaction, community);
  else if (action === 'open' && community) await onOpenSquads(interaction, community);
  else if (action === 'top' && community) await onTrustBoard(interaction, community);
  else if (action === 'join') await onJoin(interaction, first);
  else if (action === 'rc') await onReadyAnswer(interaction, first, second);
  else if (action === 'sq') await onSquadButton(interaction, first, second);
  else if (action === 'rate') await onRateButton(interaction, first);
  else if (action === 'rsub') await onRateSubmit(interaction, first);
  else await interaction.deferUpdate();
  return true;
}

let started = false;

/** Posts (or refreshes) each community's panel in its lfg channel and starts the matcher and the sweep. */
export async function initLfg(readyClient: Client): Promise<void> {
  client = readyClient;
  const guild = guildOf();
  for (const community of COMMUNITIES) {
    const channel = lfgChannelFor(guild, community);
    if (!channel) {
      logger.info(`[TCP LFG] No lfg channel in a "${community.name}" category; ${community.name} Squad Finder is off.`);
      continue;
    }
    await postPanel(community).catch((error: unknown) => logger.warn({ err: error }, `[TCP LFG] Could not post the ${community.name} panel`));
    logger.info(`[TCP LFG] ${community.name} Squad Finder ready in #${channel.name}`);
  }
  if (started) return;
  started = true;
  setInterval(() => void runMatching(), MATCH_EVERY_MS).unref?.();
  setInterval(() => void sweep(), SWEEP_EVERY_MS).unref?.();
  void sweep();
}
