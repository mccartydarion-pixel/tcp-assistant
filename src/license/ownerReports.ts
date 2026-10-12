import { TIER_USES, daysLeft, type LicenseTier } from './licenseCode.js';
import type { CodeRecord, SubscriptionRecord } from './licenseStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Discord embed descriptions hold 4096 characters; stay well inside it.
const DESCRIPTION_LIMIT = 3800;

export interface SubscriptionSummary {
  active: SubscriptionRecord[];
  expiringSoon: SubscriptionRecord[];
  expiredCount: number;
  trialCount: number;
}

/** True when the member is still on the free trial they were given, not on days the owner added since. */
export function isOnTrial(row: SubscriptionRecord, trialDays: number): boolean {
  if (row.trialGrantedAt === null) return false;
  return row.expiresAt <= row.trialGrantedAt + trialDays * DAY_MS + 60_000;
}

export function summarizeSubscriptions(rows: SubscriptionRecord[], now: number, trialDays: number, soonDays = 7): SubscriptionSummary {
  const active = rows.filter((row) => daysLeft(row.expiresAt, now) > 0).sort((a, b) => a.expiresAt - b.expiresAt);
  return {
    active,
    expiringSoon: active.filter((row) => daysLeft(row.expiresAt, now) <= soonDays),
    expiredCount: rows.length - active.length,
    trialCount: active.filter((row) => isOnTrial(row, trialDays)).length,
  };
}

export function subscriptionLine(row: SubscriptionRecord, now: number, trialDays: number): string {
  const days = daysLeft(row.expiresAt, now);
  const trial = isOnTrial(row, trialDays) ? ' · trial' : '';
  return `<@${row.discordUserId}> · ${days} day${days === 1 ? '' : 's'} left${trial}`;
}

export function codeLine(row: CodeRecord): string {
  const uses = TIER_USES[row.tier as LicenseTier] ?? '?';
  return `<@${row.discordUserId}> · \`${row.challenge}\` · ${uses} power-ups · <t:${Math.floor(row.createdAt / 1000)}:R>`;
}

/** Lines joined for an embed, cut off with a count of the rest when they would not fit. */
export function joinLines(lines: string[], empty: string): string {
  if (lines.length === 0) return empty;
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > DESCRIPTION_LIMIT) break;
    kept.push(line);
    length += line.length + 1;
  }
  const rest = lines.length - kept.length;
  return rest > 0 ? `${kept.join('\n')}\n…and ${rest} more` : kept.join('\n');
}
