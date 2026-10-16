import { EmbedBuilder, type Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import { daysLeft } from './licenseCode.js';
import type { LicenseStore } from './licenseStore.js';
import { isOnTrial } from './ownerReports.js';

// Expiry reminders: once an hour, DM each member whose trial or subscription ends within three days, and
// again in its last day. Each reminder is recorded against the end date it was about, so it is sent once,
// and adding days (a new end date) starts a fresh pair.
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 60 * 1000;
const REMINDER_COLOUR = 0xf59f00;

export type ReminderKind = 'soon' | 'final';

/** Which reminder is due for a subscription ending at expiresAt, if any. */
export function reminderDue(expiresAt: number, now: number): ReminderKind | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  if (left <= DAY_MS) return 'final';
  if (left <= 3 * DAY_MS) return 'soon';
  return null;
}

export function reminderText(
  kind: ReminderKind,
  days: number,
  onTrial: boolean,
  renewLink?: string,
  canSubscribe = false,
): { title: string; description: string } {
  const what = onTrial ? 'free trial' : 'subscription';
  const title = kind === 'final' ? `Your T.C.P ${what} ends today` : `Your T.C.P ${what} ends in ${days} days`;
  const howToRenew = canSubscribe
    ? 'press **Subscribe** on the licence panel; each monthly payment adds days automatically.'
    : 'open a support ticket in the T.C.P server to renew.';
  const description = [
    kind === 'final'
      ? `Your ${what} runs out within the next day.`
      : `Your ${what} runs out in **${days} days**.`,
    'When it ends, your Zen will ask for a new code and the bot can only give you one once you have renewed.',
    '',
    `**To keep playing:** ${howToRenew}${renewLink ? ` You can check your days any time with **My licence** here: ${renewLink}` : ''}`,
  ].join('\n');
  return { title, description };
}

export function startReminderLoop(
  client: Client,
  store: LicenseStore,
  options: {
    ownerId?: string;
    trialDays: number;
    guildId: string;
    licenceChannelId?: string;
    /** Members who need no reminder: their subscription renews by itself. */
    renewsAutomatically?: (discordUserId: string) => Promise<boolean>;
    canSubscribe?: () => boolean;
  },
): void {
  const renewLink = options.licenceChannelId ? `https://discord.com/channels/${options.guildId}/${options.licenceChannelId}` : undefined;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      for (const row of await store.listSubscriptions()) {
        if (row.discordUserId === options.ownerId) continue;
        const kind = reminderDue(row.expiresAt, now);
        if (!kind || (await store.hasReminder(row.discordUserId, kind, row.expiresAt))) continue;
        if (options.renewsAutomatically && (await options.renewsAutomatically(row.discordUserId))) continue;
        const text = reminderText(kind, daysLeft(row.expiresAt, now), isOnTrial(row, options.trialDays), renewLink, options.canSubscribe?.() ?? false);
        try {
          const user = await client.users.fetch(row.discordUserId);
          await user.send({ embeds: [new EmbedBuilder().setTitle(text.title).setDescription(text.description).setColor(REMINDER_COLOUR)] });
          logger.info(`[TCP Reminders] Sent ${kind} reminder to ${row.discordUserId}`);
        } catch (error) {
          // Usually closed DMs. Recorded anyway, so the same member is not retried every hour.
          logger.info({ err: error }, `[TCP Reminders] Could not DM ${row.discordUserId}`);
        }
        await store.recordReminder(row.discordUserId, kind, row.expiresAt);
      }
    } catch (error) {
      logger.error({ err: error }, '[TCP Reminders ERROR] Reminder check failed');
    } finally {
      running = false;
    }
  };

  setTimeout(run, FIRST_CHECK_AFTER_MS);
  setInterval(run, CHECK_EVERY_MS);
  logger.info('[TCP Reminders] Expiry reminders on (checked hourly).');
}
