import { ChannelType, PermissionFlagsBits, type APIEmbedField, type Guild, type GuildMember, type Role } from 'discord.js';
import { isTicketTopic } from '../tickets/ticketRules.js';

// What the bot knows about the server's layout: its categories and channels, read from Discord's own cache
// (kept current by the Guilds intent). Only channels the person being helped can see are ever listed, so a
// staff or private channel is never named to a member or given to the AI.

export type MapChannelKind = 'text' | 'announcement' | 'forum' | 'voice' | 'stage';

export interface MapChannel {
  id: string;
  name: string;
  kind: MapChannelKind;
  topic: string | null;
  category: string | null;
  /** Category position, then position inside it; voice channels after text ones, as Discord shows them. */
  order: [number, number];
}

const KINDS: Partial<Record<ChannelType, MapChannelKind>> = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildStageVoice]: 'stage',
};

export type Viewer = GuildMember | Role;

/**
 * The channels every one of these viewers can see, in the server's order. With no viewers, the ones
 * @everyone can see.
 */
export function visibleChannels(guild: Guild, viewers: Viewer[] = []): MapChannel[] {
  const who = viewers.length > 0 ? viewers : [guild.roles.everyone];
  const channels: MapChannel[] = [];
  for (const channel of guild.channels.cache.values()) {
    const kind = KINDS[channel.type];
    if (!kind || channel.isThread()) continue;
    const topic = 'topic' in channel ? (channel.topic ?? null) : null;
    if (isTicketTopic(topic)) continue;
    if (!who.every((viewer) => channel.permissionsFor(viewer)?.has(PermissionFlagsBits.ViewChannel))) continue;
    const parent = channel.parent;
    const spoken = kind === 'voice' || kind === 'stage';
    channels.push({
      id: channel.id,
      name: channel.name,
      kind,
      topic,
      category: parent?.name ?? null,
      order: [parent ? parent.rawPosition : -1, (spoken ? 10_000 : 0) + channel.rawPosition],
    });
  }
  return sortChannels(channels);
}

export function sortChannels(channels: MapChannel[]): MapChannel[] {
  return [...channels].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.id.localeCompare(b.id));
}

/** Channels grouped under their categories, keeping the server's order; channels outside any category first. */
export function groupByCategory(channels: MapChannel[]): { category: string | null; channels: MapChannel[] }[] {
  const groups: { category: string | null; channels: MapChannel[] }[] = [];
  for (const channel of sortChannels(channels)) {
    const last = groups[groups.length - 1];
    if (last && last.category === channel.category) last.channels.push(channel);
    else groups.push({ category: channel.category, channels: [channel] });
  }
  return groups;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const KIND_NOTE: Record<MapChannelKind, string> = { text: '', announcement: ', announcements', forum: ', forum', voice: ', voice', stage: ', stage' };

/**
 * The server map for the AI's context. Each channel carries its <#id> link so the answer can point to it.
 * Topics are dropped, then channels cut, if the map would pass the limit.
 */
export function describeServerForAssistant(channels: MapChannel[], limit = 3500): string {
  const render = (withTopics: boolean) =>
    groupByCategory(channels)
      .map((group) =>
        [
          (group.category ?? 'No category').toUpperCase(),
          ...group.channels.map(
            (channel) => `- <#${channel.id}> (#${channel.name}${KIND_NOTE[channel.kind]})${withTopics && channel.topic ? `: ${oneLine(channel.topic, 120)}` : ''}`,
          ),
        ].join('\n'),
      )
      .join('\n');
  const header = 'SERVER CHANNELS (the channels this member can see; link one by writing its <#id> exactly as shown)';
  let body = render(true);
  if (body.length > limit) body = render(false);
  if (body.length > limit) body = `${body.slice(0, body.lastIndexOf('\n', limit))}\n(more channels not listed)`;
  return channels.length === 0 ? `${header}\nNone available.` : `${header}\n${body}`;
}

/** The Server guide's fields, shortened until they fit the total (Discord allows 6000 characters per message). */
export function serverGuideFieldsWithin(channels: MapChannel[], total = 4500): APIEmbedField[] {
  const size = (list: APIEmbedField[]) => list.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  let fields: APIEmbedField[] = [];
  for (const limit of [1024, 600, 400, 250, 150]) {
    fields = serverGuideFields(channels, limit);
    if (size(fields) <= total) return fields;
  }
  // Still too big at the shortest notes: leave out the last categories until it fits.
  while (fields.length > 0 && size(fields) > total) fields = fields.slice(0, -1);
  return fields;
}

/**
 * The map for the AI: only channels both the asker and everyone who will read the answer can see. The
 * audience is @everyone unless given (a ticket's audience is the member who opened it), so an answer to the
 * owner in a public channel never names a staff channel. An unknown asker counts as @everyone.
 */
export function serverMapFor(guild: Guild | null | undefined, asker?: GuildMember | null, audience?: Viewer | null): string | undefined {
  if (!guild) return undefined;
  return describeServerForAssistant(visibleChannels(guild, [asker ?? guild.roles.everyone, audience ?? guild.roles.everyone]));
}

/** The Server guide: one embed field per category, each channel as a link with a short note from its topic. */
export function serverGuideFields(channels: MapChannel[], limitPerField = 1024): APIEmbedField[] {
  return groupByCategory(channels)
    .slice(0, 25)
    .map((group) => {
      const lines = group.channels.map((channel) => {
        const note = channel.topic ? ` · ${oneLine(channel.topic, 60)}` : channel.kind === 'voice' || channel.kind === 'stage' ? ' · voice' : '';
        return `<#${channel.id}>${note}`;
      });
      const kept: string[] = [];
      let length = 0;
      for (const [index, line] of lines.entries()) {
        // Room for this line, plus a "…and N more" line if others would still follow it.
        const following = lines.length - index - 1;
        const reserve = following > 0 ? `…and ${following} more`.length + 1 : 0;
        if (length + line.length + reserve > limitPerField) {
          kept.push(`…and ${lines.length - index} more`);
          break;
        }
        kept.push(line);
        length += line.length + 1;
      }
      return { name: group.category ?? 'General', value: kept.join('\n') || '​' };
    });
}
