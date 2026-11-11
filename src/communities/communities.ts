import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type CategoryChannel,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Interaction,
  type Role,
  type TextChannel,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notice, tcpEmbed } from '../bot/embeds.js';
import { ensurePanel } from '../bot/panels.js';
import { staffRoles } from '../bot/staff.js';
import { jsonStore } from '../database/jsonStore.js';
import { squadsStore } from '../lfg/lfgStore.js';

// Game communities: one server category per script, each with its own LFG, Chat, Script and Clips channels.
// A category is a community when it has a channel with "lfg" and one with "script" in its name, so a new game
// shows up by itself. Each community has a role (made by the bot, named after the game); the panel in the
// channel with "communities" in its name lets members join and leave. A community's category (and every
// channel in it, except Squad Finder's private squad channels) is visible only to its role, the team and the
// bot. Nothing is hidden until that panel exists, so nobody is ever locked out with no way to pick.

const PREFIX = 'tcp-com:';
const MINE_ID = `${PREFIX}mine`;
const toggleId = (categoryId: string) => `${PREFIX}t:${categoryId}`;
const REFRESH_DELAY_MS = 20 * 1000;

/** Category ID → the community's role ID, so a renamed role or category never gets a second role. */
const rolesStore = jsonStore<Record<string, string>>('communities.roles', () => ({}));

/** "· Battlefield™ 6" → "Battlefield™ 6": the category's name without the decoration in front. */
export function communityName(categoryName: string): string {
  return categoryName.replace(/^[^\p{L}\p{N}]+/u, '').trim() || categoryName.trim();
}

/** A category is a game community when it has an LFG channel and a Script channel. */
export function isCommunityCategory(channelNames: string[]): boolean {
  return channelNames.some((name) => /lfg/i.test(name)) && channelNames.some((name) => /script/i.test(name));
}

export const isPickerChannelName = (name: string) => /communit/i.test(name);

/** "・lfg" → "LFG"-ish display: the channel's name without its decoration. */
const channelLabel = (name: string) => communityName(name.replace(/[-_]+/g, ' '));

export interface CommunityInfo {
  category: CategoryChannel;
  name: string;
  role: Role;
  channels: GuildBasedChannel[];
  lfg: GuildBasedChannel | null;
}

const childrenOf = (guild: Guild, categoryId: string) =>
  [...guild.channels.cache.values()].filter((channel) => 'parentId' in channel && channel.parentId === categoryId).sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0));

/** The channel that carries the picker: a text channel with "communities" in its name, outside every community. */
export function pickerChannelOf(guild: Guild | null | undefined): TextChannel | null {
  if (!guild) return null;
  const channel = guild.channels.cache.find(
    (candidate) =>
      candidate.type === ChannelType.GuildText &&
      isPickerChannelName(candidate.name) &&
      !(candidate.parent && isCommunityCategory(childrenOf(guild, candidate.parent.id).map((child) => child.name))),
  );
  return (channel as TextChannel | undefined) ?? null;
}

/** The communities in the server, best first by their order in the channel list, each with its role (made when missing). */
async function discover(guild: Guild): Promise<CommunityInfo[]> {
  const categories = [...guild.channels.cache.values()]
    .filter((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);
  const stored = await rolesStore.read().catch(() => ({}) as Record<string, string>);
  const found: CommunityInfo[] = [];
  const newRoles: Record<string, string> = {};
  for (const category of categories) {
    const channels = childrenOf(guild, category.id);
    if (!isCommunityCategory(channels.map((channel) => channel.name))) continue;
    const name = communityName(category.name);
    let role = (stored[category.id] && guild.roles.cache.get(stored[category.id]!)) || guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!role) {
      role = await guild.roles.create({ name, mentionable: false, hoist: false, permissions: [], reason: 'T.C.P communities: the role for this game community' });
      logger.info(`[TCP Communities] Made the role "${name}" for the ${name} community`);
    }
    if (stored[category.id] !== role.id) newRoles[category.id] = role.id;
    found.push({ category, name, role, channels, lfg: channels.find((channel) => /lfg/i.test(channel.name)) ?? null });
  }
  if (Object.keys(newRoles).length > 0) {
    await rolesStore
      .update((roles) => {
        Object.assign(roles, newRoles);
      })
      .catch((error: unknown) => logger.warn({ err: error }, '[TCP Communities] Could not save the community roles'));
  }
  return found;
}

// ---- hiding ---------------------------------------------------------------------------------------------------

/** Sets one View Channel overwrite when it is not already so; every other permission in it is kept. */
async function setView(channel: CategoryChannel | GuildBasedChannel, targetId: string, allow: boolean): Promise<boolean> {
  if (!('permissionOverwrites' in channel)) return false;
  const current = channel.permissionOverwrites.cache.get(targetId);
  const already = allow ? current?.allow.has(PermissionFlagsBits.ViewChannel) : current?.deny.has(PermissionFlagsBits.ViewChannel);
  if (already) return false;
  await channel.permissionOverwrites.edit(targetId, { ViewChannel: allow }, { reason: 'T.C.P communities: visible to the community role only' });
  return true;
}

/** The category and its channels: the role, the team and the bot can see them; everyone else cannot. Squad channels are left alone. */
async function hideCommunity(guild: Guild, community: CommunityInfo, squadChannels: Set<string>): Promise<number> {
  const botId = guild.client.user.id;
  const allowed = [community.role.id, botId, ...staffRoles(guild).map((role) => role.id)];
  let changes = 0;
  const targets: (CategoryChannel | GuildBasedChannel)[] = [
    community.category,
    ...community.channels.filter((channel) => !squadChannels.has(channel.id) && !/squad/i.test(channel.name)),
  ];
  for (const channel of targets) {
    // Allow first, then deny everyone, so the bot never loses sight of a channel half-way.
    for (const targetId of allowed) if (await setView(channel, targetId, true)) changes += 1;
    if (await setView(channel, guild.roles.everyone.id, false)) changes += 1;
  }
  return changes;
}

// ---- the panel ------------------------------------------------------------------------------------------------

function panelView(communities: CommunityInfo[]) {
  const fields = communities.map((community) => ({
    name: `🎮 ${community.name}`,
    value:
      community.channels
        .filter((channel) => channel.type === ChannelType.GuildText && !/squad/i.test(channel.name))
        .map((channel) => channelLabel(channel.name))
        .join(' · ') || 'Its channels',
    inline: true,
  }));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < Math.min(communities.length, 20); index += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        communities.slice(index, index + 5).map((community) => new ButtonBuilder().setCustomId(toggleId(community.category.id)).setLabel(community.name.slice(0, 80)).setStyle(ButtonStyle.Primary)),
      ),
    );
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(MINE_ID).setLabel('📋 My communities').setStyle(ButtonStyle.Secondary)));
  return {
    embeds: [
      tcpEmbed({
        title: '🎮 Pick your communities',
        description: [
          'Every T.C.P script has its own community: **LFG** with Squad Finder, **Chat**, **Script** and **Clips**.',
          'Press a game to join it: its channels appear in your channel list. Press it again to leave. Change it any time.',
        ].join('\n\n'),
        fields: fields.length > 0 ? fields : [{ name: 'No communities yet', value: 'They appear here as soon as they are set up.' }],
      }),
    ],
    components: rows,
  };
}

// ---- refreshing -----------------------------------------------------------------------------------------------

let client: Client | null = null;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function refresh(): Promise<void> {
  if (!client) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
    if (!guild) return;
    const picker = pickerChannelOf(guild);
    if (!picker) {
      logger.info('[TCP Communities] No channel with "communities" in its name yet: create one for the community picker. Nothing is hidden until it exists.');
      return;
    }
    const communities = await discover(guild);
    await ensurePanel(client, picker.id, MINE_ID, panelView(communities), 'communities');
    const squads = await squadsStore.read().catch(() => ({}));
    const squadChannels = new Set(Object.values(squads).flatMap((squad) => [squad.textId, squad.voiceId]));
    for (const community of communities) {
      const changes = await hideCommunity(guild, community, squadChannels).catch((error: unknown) => {
        logger.warn({ err: error }, `[TCP Communities] Could not set who sees ${community.name} (the bot needs Manage Roles and Manage Channels there)`);
        return 0;
      });
      if (changes > 0) logger.info(`[TCP Communities] ${community.name} is now visible to its role only (${changes} permission change${changes === 1 ? '' : 's'})`);
    }
  } catch (error) {
    logger.warn({ err: error }, '[TCP Communities] Refresh failed');
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleCommunitiesRefresh();
    }
  }
}

/** Channels changed: look again once things settle (new communities, renamed channels, the picker channel made). */
export function scheduleCommunitiesRefresh(): void {
  if (!client || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void refresh();
  }, REFRESH_DELAY_MS);
  timer.unref?.();
}

export async function initCommunities(readyClient: Client): Promise<void> {
  client = readyClient;
  await refresh();
}

// ---- buttons --------------------------------------------------------------------------------------------------

async function onToggle(interaction: ButtonInteraction, categoryId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  await interaction.deferReply({ ephemeral: true });
  const communities = await discover(guild);
  const community = communities.find((entry) => entry.category.id === categoryId);
  if (!community) {
    await interaction.editReply(notice('That community is gone. The panel will catch up in a moment.'));
    scheduleCommunitiesRefresh();
    return;
  }
  const member = await guild.members.fetch(interaction.user.id);
  try {
    if (member.roles.cache.has(community.role.id)) {
      await member.roles.remove(community.role, 'T.C.P communities: left from the picker');
      await interaction.editReply(notice(`You left **${community.name}**. Its channels are gone from your list; press it again any time to come back.`));
    } else {
      await member.roles.add(community.role, 'T.C.P communities: joined from the picker');
      const start = community.lfg ? ` Find a squad in <#${community.lfg.id}>.` : '';
      await interaction.editReply(notice(`✅ You joined **${community.name}**! Its channels are now in your channel list.${start}`, { tone: 'success' }));
    }
  } catch (error) {
    logger.warn({ err: error }, `[TCP Communities] Could not change ${interaction.user.id}'s ${community.name} role`);
    await interaction.editReply(notice('I could not change your role. The team has to move my role above the community roles (Server Settings, Roles).', { tone: 'danger' }));
  }
}

async function onMine(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  await interaction.deferReply({ ephemeral: true });
  const communities = await discover(guild);
  const member = await guild.members.fetch(interaction.user.id);
  const joined = communities.filter((community) => member.roles.cache.has(community.role.id));
  const others = communities.filter((community) => !member.roles.cache.has(community.role.id));
  const lines = [
    joined.length > 0 ? `**You are in:** ${joined.map((community) => (community.lfg ? `${community.name} (<#${community.lfg.id}>)` : community.name)).join(', ')}` : 'You have not joined a community yet.',
    ...(others.length > 0 ? [`**You can join:** ${others.map((community) => community.name).join(', ')}`] : []),
  ];
  await interaction.editReply(notice(lines.join('\n\n')));
}

export async function handleCommunityInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  if (interaction.customId === MINE_ID) await onMine(interaction);
  else if (interaction.customId.startsWith(`${PREFIX}t:`)) await onToggle(interaction, interaction.customId.slice(`${PREFIX}t:`.length));
  else await interaction.deferUpdate();
  return true;
}
