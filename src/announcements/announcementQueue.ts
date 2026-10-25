import { statSync } from 'node:fs';
import { join } from 'node:path';
import { AttachmentBuilder, DiscordAPIError, type EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import { tcpEmbed } from '../bot/embeds.js';
import type { AnnouncementRow, AnnouncementStore } from './announcementStore.js';

// The queue of code-written announcements (src/announcements/queue.ts) and how it is posted. Kept free of
// the bot's environment and client so the rules can be tested on their own; announcements.ts wires it up.

export interface QueuedAnnouncement {
  /** Stable and unique, e.g. '2026-10-workshop-mag'. Never change it once posted: it is how a repost is prevented. */
  id: string;
  /** The day it was written, YYYY-MM-DD. An entry never posted by 14 days after this is skipped. */
  date: string;
  /** Only ready entries are posted, so a draft can sit in the queue. */
  ready: boolean;
  title: string;
  description: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** A web address the title links to (optional). */
  url?: string;
  /** A file name in assets/announcements/ (gif, png, jpg or webp), shown as the embed's image. */
  gif?: string;
  /** '@everyone', 'elite' (the Elite Supporter role, found when posting), a role ID (digits), or 'none' / left out for no ping. */
  ping?: '@everyone' | 'elite' | 'none' | (string & {});
}

export type QueueStatus = 'posted' | 'sending' | 'pending' | 'draft' | 'expired';

export interface QueueLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** What the queue posts to: the announcement channel. */
export interface AnnouncementTarget {
  send(options: MessageCreateOptions): Promise<{ id: string; url: string }>;
}

export interface QueueDeps {
  store: AnnouncementStore;
  channelId: string | undefined;
  getChannel: (channelId: string) => Promise<AnnouncementTarget | null>;
  /** Folder holding the GIFs: assets/announcements in the repo. */
  assetDir: string;
  now: number;
  log: QueueLog;
  /** The Elite Supporter role's ID, for entries that ping 'elite'; null when the server has no such role. */
  eliteRoleId?: () => Promise<string | null>;
}

export interface QueueRunReport {
  posted: string[];
  /** Entries left for the owner: was being sent when the bot stopped, or the send failed in a way that may have posted it. */
  unsure: string[];
  expired: string[];
  /** Why nothing (more) was posted, when something went wrong. */
  errors: string[];
}

export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Discord's upload limit for a server without boosts. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ANNOUNCEMENT_FOOTER = 'T.C.P | Tactical Competitive Pro';
export const EMBED_LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, total: 6000 } as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATTERN = /^[A-Za-z0-9_.-]+\.(gif|png|jpe?g|webp)$/i;
const ROLE_PATTERN = /^\d{17,20}$/;

/** Midnight UTC of the entry's date, or NaN if it is not a real YYYY-MM-DD date. */
export function entryTime(entry: Pick<QueuedAnnouncement, 'date'>): number {
  if (!DATE_PATTERN.test(entry.date)) return Number.NaN;
  const time = Date.parse(`${entry.date}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== entry.date ? Number.NaN : time;
}

/** Oldest first; entries of the same day keep their order in the queue. */
export function postingOrder(queue: readonly QueuedAnnouncement[]): QueuedAnnouncement[] {
  return queue
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (entryTime(a.entry) || 0) - (entryTime(b.entry) || 0) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Problems with the queue as a whole: ids and dates. */
export function checkQueue(queue: readonly QueuedAnnouncement[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of queue) {
    if (!ID_PATTERN.test(entry.id)) errors.push(`"${entry.id}": the id must be 3-80 lowercase letters, digits and dashes.`);
    if (seen.has(entry.id)) errors.push(`"${entry.id}": two entries have this id.`);
    seen.add(entry.id);
    if (Number.isNaN(entryTime(entry))) errors.push(`"${entry.id}": date must be a real YYYY-MM-DD date, not "${entry.date}".`);
  }
  return errors;
}

/** Characters Discord counts toward an embed's 6000 total. */
export function embedTextLength(entry: QueuedAnnouncement): number {
  const fields = (entry.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  return entry.title.length + entry.description.length + fields + ANNOUNCEMENT_FOOTER.length;
}

/** Problems with one entry's text against Discord's embed limits; empty when it fits. Nothing is cut short. */
export function checkEmbed(entry: QueuedAnnouncement): string[] {
  const errors: string[] = [];
  const name = `"${entry.id}"`;
  if (!entry.title.trim()) errors.push(`${name}: the title is empty.`);
  if (entry.title.length > EMBED_LIMITS.title) errors.push(`${name}: the title is ${entry.title.length} characters; Discord allows ${EMBED_LIMITS.title}.`);
  if (!entry.description.trim()) errors.push(`${name}: the description is empty.`);
  if (entry.description.length > EMBED_LIMITS.description) {
    errors.push(`${name}: the description is ${entry.description.length} characters; Discord allows ${EMBED_LIMITS.description}.`);
  }
  const fields = entry.fields ?? [];
  if (fields.length > EMBED_LIMITS.fields) errors.push(`${name}: ${fields.length} fields; Discord allows ${EMBED_LIMITS.fields}.`);
  fields.forEach((field, index) => {
    if (!field.name.trim() || field.name.length > EMBED_LIMITS.fieldName) errors.push(`${name}: field ${index + 1}'s name must be 1-${EMBED_LIMITS.fieldName} characters.`);
    if (!field.value.trim() || field.value.length > EMBED_LIMITS.fieldValue) errors.push(`${name}: field ${index + 1}'s value must be 1-${EMBED_LIMITS.fieldValue} characters.`);
  });
  const total = embedTextLength(entry);
  if (total > EMBED_LIMITS.total) errors.push(`${name}: ${total} characters in all (title, description, fields, footer); Discord allows ${EMBED_LIMITS.total}.`);
  if (entry.url !== undefined && !/^https?:\/\/\S+$/i.test(entry.url)) errors.push(`${name}: url must start with https:// and contain no spaces.`);
  if (entry.ping !== undefined && entry.ping !== 'none' && entry.ping !== '@everyone' && entry.ping !== 'elite' && !ROLE_PATTERN.test(entry.ping)) {
    errors.push(`${name}: ping must be '@everyone', 'elite', a role ID (digits only) or 'none', not "${entry.ping}".`);
  }
  return errors;
}

/** Problems with the entry's GIF: name, missing file, over 8 MB. Empty when it has none or it is fine. */
export function checkGif(entry: QueuedAnnouncement, assetDir: string, fileSize: (path: string) => number | null = sizeOf): string[] {
  if (entry.gif === undefined) return [];
  const name = `"${entry.id}"`;
  if (!FILE_PATTERN.test(entry.gif)) {
    return [`${name}: gif must be a plain file name in assets/announcements (letters, digits, . _ -) ending .gif, .png, .jpg or .webp, not "${entry.gif}".`];
  }
  const size = fileSize(join(assetDir, entry.gif));
  if (size === null) return [`${name}: the GIF assets/announcements/${entry.gif} is missing. Add it to the repo and redeploy.`];
  if (size > MAX_FILE_BYTES) {
    return [`${name}: assets/announcements/${entry.gif} is ${(size / 1024 / 1024).toFixed(1)} MB; Discord takes at most 8 MB from a bot here. Make it smaller.`];
  }
  return [];
}

function sizeOf(path: string): number | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

export function buildAnnouncementEmbed(entry: QueuedAnnouncement): EmbedBuilder {
  const embed = tcpEmbed({
    title: entry.title,
    description: entry.description,
    fields: entry.fields?.map((field) => ({ name: field.name, value: field.value, inline: field.inline ?? false })),
    footer: ANNOUNCEMENT_FOOTER,
    timestamp: true,
  });
  if (entry.url) embed.setURL(entry.url);
  if (entry.gif) embed.setImage(`attachment://${entry.gif}`);
  return embed;
}

/** The whole message: ping, embed, and the GIF attached and shown inside the embed. */
export function buildAnnouncementMessage(entry: QueuedAnnouncement, assetDir: string): MessageCreateOptions {
  const ping = entry.ping === undefined || entry.ping === 'none' ? null : entry.ping;
  return {
    content: ping === null ? undefined : ping === '@everyone' ? '@everyone' : `<@&${ping}>`,
    embeds: [buildAnnouncementEmbed(entry)],
    files: entry.gif ? [new AttachmentBuilder(join(assetDir, entry.gif), { name: entry.gif })] : [],
    allowedMentions: ping === null ? { parse: [] } : ping === '@everyone' ? { parse: ['everyone'] } : { parse: [], roles: [ping] },
  };
}

export function statusOf(entry: QueuedAnnouncement, row: AnnouncementRow | undefined, now: number): QueueStatus {
  if (row) return row.status;
  if (!entry.ready) return 'draft';
  return now - entryTime(entry) > MAX_AGE_MS ? 'expired' : 'pending';
}

/** Every entry in posting order with its status, for /tcp announcements. */
export function describeQueue(
  queue: readonly QueuedAnnouncement[],
  rows: readonly AnnouncementRow[],
  now: number,
): { entry: QueuedAnnouncement; status: QueueStatus; row?: AnnouncementRow }[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return postingOrder(queue).map((entry) => ({ entry, status: statusOf(entry, byId.get(entry.id), now), row: byId.get(entry.id) }));
}

/** True only when Discord answered and refused the message, so it certainly was not posted. */
export function definitelyNotPosted(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.status >= 400 && error.status < 500;
}

/**
 * Posts every ready, unposted, recent entry, oldest first, one message each. Posts nothing at all when the
 * queue, any entry due now, its GIF or the channel has a problem; it logs what to fix. Stops at the first
 * failed send so the order is kept.
 */
export async function runAnnouncementQueue(queue: readonly QueuedAnnouncement[], deps: QueueDeps): Promise<QueueRunReport> {
  const { store, log, now } = deps;
  const report: QueueRunReport = { posted: [], unsure: [], expired: [], errors: [] };
  const fail = (message: string) => {
    report.errors.push(message);
    log.error(`[TCP Announcements ERROR] ${message}`);
  };

  const rows = await store.list();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.status !== 'sending') continue;
    report.unsure.push(row.id);
    log.warn(
      `[TCP Announcements WARNING] "${row.id}" was being sent when the bot last stopped, so it may or may not be in the announcement channel. It is not retried by itself: look in the channel, and if it is missing run /tcp announcements retry:${row.id}.`,
    );
  }

  const queueErrors = checkQueue(queue);
  if (queueErrors.length > 0) {
    for (const message of queueErrors) fail(message);
    fail('Nothing was posted. Fix src/announcements/queue.ts and redeploy.');
    return report;
  }

  const due: QueuedAnnouncement[] = [];
  for (const entry of postingOrder(queue)) {
    const status = statusOf(entry, byId.get(entry.id), now);
    if (status === 'expired') {
      report.expired.push(entry.id);
      log.info(`[TCP Announcements] Skipped "${entry.id}": never posted and more than 14 days past its date (${entry.date}).`);
    }
    if (status === 'pending') due.push(entry);
  }
  if (due.length === 0) {
    log.info('[TCP Announcements] Nothing new to post.');
    return report;
  }

  const problems = due.flatMap((entry) => [...checkEmbed(entry), ...checkGif(entry, deps.assetDir)]);
  if (problems.length > 0) {
    for (const message of problems) fail(message);
    fail(`Nothing was posted (${due.length} waiting). Fix the entries above and redeploy.`);
    return report;
  }

  if (!deps.channelId) {
    fail(`ANNOUNCEMENT_CHANNEL_ID is not set, so ${due.length} announcement(s) were not posted. Set it in Railway.`);
    return report;
  }
  let channel: AnnouncementTarget | null = null;
  try {
    channel = await deps.getChannel(deps.channelId);
  } catch {
    channel = null;
  }
  if (!channel) {
    fail(`ANNOUNCEMENT_CHANNEL_ID (${deps.channelId}) is not a text channel the bot can see, so ${due.length} announcement(s) were not posted.`);
    return report;
  }

  for (const dueEntry of due) {
    let entry = dueEntry;
    // 'elite' becomes the Elite Supporter role's ID; without the role the entry waits (and says why).
    if (entry.ping === 'elite') {
      const roleId = (await deps.eliteRoleId?.().catch(() => null)) ?? null;
      if (!roleId) {
        fail(`"${entry.id}" pings the Elite Supporter role, but the bot could not find it, so it was not posted. It is tried again on the next start.`);
        continue;
      }
      entry = { ...entry, ping: roleId };
    }
    if (!(await store.claim(entry.id, now))) {
      log.info(`[TCP Announcements] "${entry.id}" is already recorded; not posting it again.`);
      continue;
    }
    let message: { id: string; url: string };
    try {
      message = await channel.send(buildAnnouncementMessage(entry, deps.assetDir));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (definitelyNotPosted(error)) {
        await store.release(entry.id).catch(() => false);
        fail(
          `Discord refused "${entry.id}" (${detail}). It was not posted and will be tried again on the next start. Check the bot can send messages, embed links and attach files there (and mention everyone or the role, if it pings).`,
        );
      } else {
        report.unsure.push(entry.id);
        fail(
          `Sending "${entry.id}" failed (${detail}) and it may or may not have been posted. It is not retried by itself: look in the channel, and if it is missing run /tcp announcements retry:${entry.id}.`,
        );
      }
      fail('Stopped here so the announcements keep their order.');
      return report;
    }
    report.posted.push(entry.id);
    log.info(`[TCP Announcements] Posted "${entry.id}": ${message.url}`);
    try {
      await store.markPosted(entry.id, message.id, now);
    } catch (error) {
      // Still 'sending', so it is never posted again; the owner just sees it as unsure.
      log.error(`[TCP Announcements ERROR] Posted "${entry.id}" but could not record it as posted (${String(error)}). It stays marked as sending and will not be posted again.`);
    }
  }
  return report;
}
