import type { APIEmbedField, ChatInputCommandInteraction } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notice } from '../bot/embeds.js';
import { getState, setState } from '../database/stateStore.js';
import { everyInterval } from '../bot/jobs.js';
import { describeHours, isOpenAt, nextChange, parseClock, parseDays, roughDuration, validTimeZone, type SupportHours } from './supportHoursRules.js';

// Support hours: the owner sets them with /tcp hours. The ticket panel (and the help channel panel, which
// carries the ticket buttons) shows whether support is online, and when it is back; a ticket opened while
// offline says when the team will answer. Times are shown with Discord timestamps, so every member sees them
// in their own time zone. With no hours set nothing is shown.

const KEY = 'support.hours';
let hours: SupportHours | null = null;
let typicalResponseMs: number | null = null;
let lastOpen: boolean | null = null;
const listeners: (() => Promise<unknown>)[] = [];

export async function loadSupportHours(): Promise<void> {
  hours = await getState<SupportHours | null>(KEY, null);
  if (hours && !validTimeZone(hours.timeZone)) hours = null;
  lastOpen = hours ? isOpenAt(hours, Date.now()) : null;
  logger.info(hours ? `[TCP Support hours] ${describeHours(hours)}` : '[TCP Support hours] Not set; no status shown.');
}

export function supportHours(): SupportHours | null {
  return hours;
}

/** The team's usual time to a first reply, from the last 30 days of tickets (ticketFeedback.ts). */
export function setTypicalResponse(ms: number | null): void {
  typicalResponseMs = ms;
}

/** Called when support opens or closes, or the hours change: the panels redraw. */
export function onSupportStatusChange(listener: () => Promise<unknown>): void {
  listeners.push(listener);
}

async function notifyListeners(): Promise<void> {
  for (const listener of listeners) await listener().catch((error: unknown) => logger.warn({ err: error }, '[TCP Support hours] A panel could not redraw'));
}

export function startSupportHoursWatch(): void {
  everyInterval('support-hours', 5 * 60 * 1000, async () => {
    if (!hours) return;
    const open = isOpenAt(hours, Date.now());
    if (open === lastOpen) return;
    lastOpen = open;
    logger.info(`[TCP Support hours] Support is now ${open ? 'online' : 'offline'}`);
    await notifyListeners();
  });
}

const stamp = (ms: number, style: 'R' | 't' | 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** The panel's status line, or null with no hours set. */
export function supportStatusLine(now = Date.now()): string | null {
  if (!hours) return null;
  const change = nextChange(hours, now);
  if (isOpenAt(hours, now)) {
    const usual = typicalResponseMs ? ` Usually answered within ${roughDuration(typicalResponseMs)}.` : '';
    return `🟢 **Support is online now.**${usual}`;
  }
  return change
    ? `🔴 **Support is offline.** Back ${stamp(change, 'R')} (${stamp(change, 't')} your time). Open a ticket anyway and we'll answer when we're back.`
    : '🔴 **Support is offline.** Open a ticket anyway and we will answer when we are back.';
}

/** A field for a ticket opened while support is offline, or null while it is online (or no hours are set). */
export function supportOfflineField(now = Date.now()): APIEmbedField | null {
  if (!hours || isOpenAt(hours, now)) return null;
  const change = nextChange(hours, now);
  return {
    name: '⏰ Support is offline right now',
    value: change ? `The team is back ${stamp(change, 'R')} (${stamp(change, 'f')}) and will answer then.` : 'The team will answer as soon as they are back.',
  };
}

/** /tcp hours: the owner sets, shows or turns off the support hours. */
export async function handleHoursCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  const off = interaction.options.getBoolean('off') ?? false;
  const fromText = interaction.options.getString('from');
  const toText = interaction.options.getString('to');
  const zone = interaction.options.getString('timezone');
  const daysText = interaction.options.getString('days');

  if (off) {
    hours = null;
    lastOpen = null;
    await setState(KEY, null);
    await interaction.reply({ ...notice('Support hours are off. The panels no longer show online or offline.', { title: 'Support hours', tone: 'muted' }), ephemeral: true });
    await notifyListeners();
    return;
  }
  if (!fromText && !toText && !zone && !daysText) {
    await interaction.reply({
      ...notice(
        hours
          ? `${describeHours(hours)}\n${supportStatusLine() ?? ''}\n\nChange them with \`/tcp hours from:10:00 to:22:00 timezone:America/New_York days:mon-fri\`, or \`/tcp hours off:True\`.`
          : 'No support hours set. Example: `/tcp hours from:10:00 to:22:00 timezone:America/New_York days:every day`.',
        { title: 'Support hours' },
      ),
      ephemeral: true,
    });
    return;
  }

  const from = parseClock(fromText ?? '') ?? hours?.from ?? null;
  const to = parseClock(toText ?? '') ?? hours?.to ?? null;
  const timeZone = zone?.trim() || hours?.timeZone || null;
  const days = daysText ? parseDays(daysText) : (hours?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const problems = [
    fromText && parseClock(fromText) === null ? `"${fromText}" is not a time (use 10:00 or 10am).` : '',
    toText && parseClock(toText) === null ? `"${toText}" is not a time (use 22:00 or 10pm).` : '',
    from === null || to === null ? 'Give both **from** and **to**.' : '',
    !timeZone ? 'Give a **timezone**, for example America/New_York, Europe/London or America/Chicago.' : !validTimeZone(timeZone) ? `"${timeZone}" is not a time zone. Use one like America/New_York or Europe/London.` : '',
    days === null ? `"${daysText}" is not a set of days. Use every day, weekdays, weekends, mon-fri or mon,wed,fri.` : '',
  ].filter(Boolean);
  if (problems.length > 0) {
    await interaction.reply({ ...notice(problems.join('\n'), { title: 'Support hours not changed', tone: 'warning' }), ephemeral: true });
    return;
  }
  hours = { from: from!, to: to!, timeZone: timeZone!, days: days! };
  lastOpen = isOpenAt(hours, Date.now());
  await setState(KEY, hours);
  logger.info(`[TCP Support hours] Set to ${describeHours(hours)}`);
  await interaction.reply({ ...notice(`${describeHours(hours)}\n${supportStatusLine()}`, { title: 'Support hours saved', tone: 'success' }), ephemeral: true });
  await notifyListeners();
}
