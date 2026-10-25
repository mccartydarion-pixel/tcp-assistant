import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { notice, tcpEmbed } from '../bot/embeds.js';
import { createAnnouncementStore, type AnnouncementStore } from './announcementStore.js';
import { describeQueue, runAnnouncementQueue, type QueueRunReport, type QueueStatus } from './announcementQueue.js';
import { ANNOUNCEMENT_QUEUE } from './queue.js';
import { eliteRole } from '../premium/premium.js';

// Posts the code-written announcements (queue.ts) on start, and the owner's /tcp announcements command.

export const ANNOUNCEMENT_ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'announcements');

let store: AnnouncementStore | null = null;
let botClient: Client | null = null;
// One run at a time (start and a retry from the command can overlap); the store's claim also guards it.
let running: Promise<unknown> = Promise.resolve();

function runQueue(client: Client): Promise<QueueRunReport> {
  const opened = store;
  if (!opened) return Promise.reject(new Error('The announcement records are not open.'));
  const next = running.then(() =>
    runAnnouncementQueue(ANNOUNCEMENT_QUEUE, {
      store: opened,
      channelId: env.ANNOUNCEMENT_CHANNEL_ID,
      getChannel: (channelId) => fetchSendableChannel(client, channelId),
      assetDir: ANNOUNCEMENT_ASSET_DIR,
      now: Date.now(),
      eliteRoleId: async () => {
        const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
        await guild.roles.fetch();
        return eliteRole(guild)?.id ?? null;
      },
      log: {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
      },
    }),
  );
  running = next.catch(() => undefined);
  return next;
}

/** Opens the records and posts whatever is due. Never throws: a problem is logged and the bot carries on. */
export async function initAnnouncements(client: Client): Promise<void> {
  botClient = client;
  try {
    const opened = createAnnouncementStore();
    await opened.init();
    store = opened;
  } catch (error) {
    logger.error({ err: error }, '[TCP Announcements ERROR] Could not open the announcement records; no queued announcement is posted.');
    return;
  }
  try {
    await runQueue(client);
  } catch (error) {
    logger.error({ err: error }, '[TCP Announcements ERROR] The announcement queue failed.');
  }
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  posted: 'POSTED',
  sending: 'UNSURE (was sending)',
  pending: 'PENDING',
  draft: 'DRAFT',
  expired: 'SKIPPED (over 14 days old)',
};

function queueLines(): Promise<string[]> {
  const opened = store;
  if (!opened) return Promise.resolve([]);
  return opened.list().then((rows) =>
    describeQueue(ANNOUNCEMENT_QUEUE, rows, Date.now()).map(({ entry, status, row }) => {
      const when = row ? ` <t:${Math.floor(row.updatedAt / 1000)}:R>` : '';
      return `**${STATUS_LABEL[status]}**${when} \`${entry.id}\` (${entry.date})\n${entry.title.slice(0, 120)}`;
    }),
  );
}

/** /tcp announcements: the queue and each entry's status, privately to the owner. retry:<id> clears an unsure entry and runs the queue. */
export async function handleAnnouncementsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (!store) {
    await interaction.editReply(notice('The announcement records are not open. Check the bot log.', { tone: 'danger' }));
    return;
  }

  const retry = interaction.options.getString('retry')?.trim();
  let outcome = '';
  if (retry) {
    try {
      outcome = await retryEntry(interaction, store, retry);
    } catch (error) {
      logger.error({ err: error }, `[TCP Announcements ERROR] Retrying "${retry}" failed.`);
      outcome = `Retrying \`${retry}\` failed; see the bot log.\n\n`;
    }
    if (!outcome) return;
  }

  const lines = await queueLines();
  const channel = env.ANNOUNCEMENT_CHANNEL_ID ? `<#${env.ANNOUNCEMENT_CHANNEL_ID}>` : 'no channel (ANNOUNCEMENT_CHANNEL_ID is not set)';
  const body = lines.length > 0 ? lines.join('\n\n') : 'The queue is empty.';
  await interaction.editReply({
    embeds: [
      tcpEmbed({
        title: 'Queued announcements',
        description: `${outcome}Posts to ${channel} when the bot starts. Oldest first.\n\n${body}`.slice(0, 4096),
      }),
    ],
  });
}

/** Clears an UNSURE entry and runs the queue. The line to show above the list, or '' after replying itself. */
async function retryEntry(interaction: ChatInputCommandInteraction, opened: AnnouncementStore, retry: string): Promise<string> {
  if (!(await opened.release(retry))) {
    await interaction.editReply(notice(`\`${retry}\` is not marked as unsure (sending), so there is nothing to retry.`, { tone: 'warning' }));
    return '';
  }
  const report = await runQueue(botClient ?? interaction.client);
  if (report.posted.includes(retry)) return `Posted \`${retry}\`.\n\n`;
  const reason = report.expired.includes(retry)
    ? 'it is more than 14 days past its date (change its date in queue.ts to post it).'
    : !ANNOUNCEMENT_QUEUE.some((entry) => entry.id === retry && entry.ready)
      ? 'it is not a ready entry in queue.ts.'
      : (report.errors[0] ?? 'see the bot log.');
  return `Cleared \`${retry}\`, but it was not posted: ${reason}\n\n`;
}
