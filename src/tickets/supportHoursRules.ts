// When support is open: a set of weekdays and a daily window in one time zone. Plain data and functions;
// supportHours.ts does the Discord side.

export interface SupportHours {
  /** Weekdays the window opens on, 0 Sunday to 6 Saturday. */
  days: number[];
  /** Minutes after midnight, local time. from > to is a window past midnight; from == to is all day. */
  from: number;
  to: number;
  /** An IANA time zone, for example America/New_York. */
  timeZone: string;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LONG_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "10:00", "9:30", "22", "10am", "9:30 pm", "12am" to minutes after midnight; null if it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const half = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (half === 'pm' ? 12 : 0);
  } else if (hours > 24 || (hours === 24 && minutes > 0)) {
    return null;
  }
  return (hours * 60 + minutes) % (24 * 60);
}

function dayIndex(word: string): number {
  return DAY_NAMES.indexOf(word.trim().toLowerCase().slice(0, 3));
}

/** "every day", "daily", "weekdays", "weekends", "mon-fri", "fri-mon", "mon,wed,fri" to weekdays; null if unreadable. */
export function parseDays(text: string): number[] | null {
  const value = text.trim().toLowerCase();
  if (!value || ['every day', 'everyday', 'daily', 'all', 'all week'].includes(value)) return [0, 1, 2, 3, 4, 5, 6];
  if (value === 'weekdays') return [1, 2, 3, 4, 5];
  if (value === 'weekends' || value === 'weekend') return [0, 6];
  const days = new Set<number>();
  for (const part of value.split(/[,\s]+/).filter(Boolean)) {
    const range = part.split('-');
    if (range.length === 2) {
      const start = dayIndex(range[0]!);
      const end = dayIndex(range[1]!);
      if (start < 0 || end < 0) return null;
      for (let day = start; ; day = (day + 1) % 7) {
        days.add(day);
        if (day === end) break;
      }
    } else {
      const day = dayIndex(part);
      if (day < 0) return null;
      days.add(day);
    }
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The weekday (0 Sunday) and minutes after midnight at that moment in that time zone. */
export function localParts(ms: number, timeZone: string): { day: number; minutes: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return { day: dayIndex(get('weekday')), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

export function isOpenAt(hours: SupportHours, ms: number): boolean {
  const { day, minutes } = localParts(ms, hours.timeZone);
  if (hours.from === hours.to) return hours.days.includes(day);
  if (hours.from < hours.to) return hours.days.includes(day) && minutes >= hours.from && minutes < hours.to;
  // Past midnight: the late part belongs to the day it started, the early part to the day before.
  return (hours.days.includes(day) && minutes >= hours.from) || (hours.days.includes((day + 6) % 7) && minutes < hours.to);
}

const STEP_MS = 5 * 60 * 1000;

/** The next moment (to five minutes) support opens or closes; null if it never changes within 8 days. */
export function nextChange(hours: SupportHours, ms: number): number | null {
  const open = isOpenAt(hours, ms);
  const start = Math.ceil(ms / STEP_MS) * STEP_MS;
  for (let at = start; at <= ms + 8 * 24 * 60 * 60 * 1000; at += STEP_MS) {
    if (isOpenAt(hours, at) !== open) return at;
  }
  return null;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "Mon-Fri, 10:00-22:00 (America/New_York)" */
export function describeHours(hours: SupportHours): string {
  const days = hours.days;
  let dayText: string;
  if (days.length === 7) dayText = 'Every day';
  else if (days.length > 1 && days.every((day, i) => i === 0 || day === days[i - 1]! + 1)) dayText = `${LONG_DAY_NAMES[days[0]!]}-${LONG_DAY_NAMES[days[days.length - 1]!]}`;
  else dayText = days.map((day) => LONG_DAY_NAMES[day]).join(', ');
  const window = hours.from === hours.to ? 'all day' : `${clock(hours.from)}-${clock(hours.to)}`;
  return `${dayText}, ${window} (${hours.timeZone})`;
}

/** "about 3 hours", "about 40 minutes", "about 2 days" */
export function roughDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `about ${days} days`;
}
