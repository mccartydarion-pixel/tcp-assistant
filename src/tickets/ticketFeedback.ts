import type { APIEmbedField, Client } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { tcpEmbed } from '../bot/embeds.js';
import { DAY_MS, everyInterval, scheduleJob } from '../bot/jobs.js';
import type { TicketRecord } from './ticketStore.js';
import { ticketRecordsSince } from './ticketSystem.js';
import { setTypicalResponse } from './supportHours.js';
import { roughDuration } from './supportHoursRules.js';

// The weekly support summary: every 7 days the ticket log channel gets how many tickets were opened and
// closed, how fast the team first replied, the members' ratings, and who on the team answered. The same
// figures feed the owner's /tcp stats, and the usual reply time shown on the ticket panel.

export interface SupportStats {
  opened: number;
  closed: number;
  autoClosed: number;
  stillOpen: number;
  /** Median time to the team's first reply, over tickets opened in the window that got one. */
  medianFirstResponseMs: number | null;
  answeredCount: number;
  ratings: number;
  averageRating: number | null;
  /** Per member of the team: tickets they took (claimed or first wrote in) and their average rating. */
  byStaff: { id: string; tickets: number; averageRating: number | null }[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The figures for tickets opened or closed in [since, now). */
export function supportStats(records: TicketRecord[], since: number): SupportStats {
  const opened = records.filter((record) => record.createdAt >= since);
  const closed = records.filter((record) => record.status === 'closed' && (record.closedAt ?? 0) >= since && record.closedBy !== 'failed' && record.closedBy !== 'deleted');
  const responses = opened.filter((record) => record.firstResponseAt).map((record) => record.firstResponseAt! - record.createdAt);
  const rated = closed.filter((record) => record.rating);
  const staff = new Map<string, { tickets: number; ratings: number[] }>();
  for (const record of closed) {
    if (!record.claimedBy) continue;
    const entry = staff.get(record.claimedBy) ?? { tickets: 0, ratings: [] };
    entry.tickets += 1;
    if (record.rating) entry.ratings.push(record.rating);
    staff.set(record.claimedBy, entry);
  }
  return {
    opened: opened.length,
    closed: closed.length,
    autoClosed: closed.filter((record) => record.closedBy === 'auto').length,
    stillOpen: opened.filter((record) => record.status === 'open').length,
    medianFirstResponseMs: median(responses),
    answeredCount: responses.length,
    ratings: rated.length,
    averageRating: average(rated.map((record) => record.rating!)),
    byStaff: [...staff.entries()]
      .map(([id, entry]) => ({ id, tickets: entry.tickets, averageRating: average(entry.ratings) }))
      .sort((a, b) => b.tickets - a.tickets),
  };
}

const stars = (value: number | null) => (value === null ? 'no ratings yet' : `${value.toFixed(1)} / 5`);

/** The summary as embed fields, for the weekly post and /tcp stats. */
export function supportFields(stats: SupportStats): APIEmbedField[] {
  return [
    { name: 'Tickets', value: `${stats.opened} opened · ${stats.closed} closed${stats.autoClosed ? ` (${stats.autoClosed} for no reply)` : ''} · ${stats.stillOpen} still open`, inline: false },
    {
      name: 'First reply',
      value: stats.medianFirstResponseMs === null ? 'No replies yet' : `Usually ${roughDuration(stats.medianFirstResponseMs)} (median of ${stats.answeredCount})`,
      inline: true,
    },
    { name: 'Rating', value: stats.ratings ? `${stars(stats.averageRating)} from ${stats.ratings} rating${stats.ratings === 1 ? '' : 's'}` : 'No ratings yet', inline: true },
    {
      name: 'The team',
      value:
        stats.byStaff.length > 0
          ? stats.byStaff.slice(0, 10).map((entry) => `<@${entry.id}>: ${entry.tickets} ticket${entry.tickets === 1 ? '' : 's'}, ${stars(entry.averageRating)}`).join('\n')
          : 'Nobody on the team took a ticket that closed this week.',
      inline: false,
    },
  ];
}

/** The last 7 days, for /tcp stats. Null when tickets are off. */
export async function lastWeekSupport(now = Date.now()): Promise<SupportStats | null> {
  const records = await ticketRecordsSince(now - 7 * DAY_MS);
  return records ? supportStats(records, now - 7 * DAY_MS) : null;
}

async function refreshTypicalResponse(): Promise<void> {
  const since = Date.now() - 30 * DAY_MS;
  const records = await ticketRecordsSince(since);
  if (!records) return;
  const stats = supportStats(records, since);
  // Only once there are enough tickets for the figure to mean something.
  setTypicalResponse(stats.answeredCount >= 3 ? stats.medianFirstResponseMs : null);
}

export function startSupportSummary(client: Client): void {
  everyInterval('typical-response', 6 * 60 * 60 * 1000, refreshTypicalResponse, 30 * 1000);
  scheduleJob(
    'support-summary',
    7 * DAY_MS,
    async () => {
      const channelId = env.TICKET_LOG_CHANNEL_ID ?? env.LOG_CHANNEL_ID;
      const stats = await lastWeekSupport();
      if (!channelId || !stats) return;
      const channel = await fetchSendableChannel(client, channelId);
      await channel?.send({
        embeds: [tcpEmbed({ title: '📊 Weekly support summary', description: 'The last 7 days of tickets.', fields: supportFields(stats), timestamp: true })],
        allowedMentions: { parse: [] },
      });
      logger.info('[TCP Tickets] Posted the weekly support summary');
    },
    { firstCheckMs: 10 * 60 * 1000 },
  );
}
