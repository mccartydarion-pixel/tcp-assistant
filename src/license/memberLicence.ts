import { TIER_USES, daysLeft, tierForDaysLeft } from './licenseCode.js';
import type { CodeRecord } from './licenseStore.js';

export interface MemberLicenceInput {
  expiresAt: number | null;
  hadTrial: boolean;
  onTrial: boolean;
  codesToday: number;
  maxPerDay: number;
  latest: CodeRecord | null;
  now: number;
  trialDays: number;
  isOwner: boolean;
  /** How to renew, for an ended subscription. Defaults to opening a ticket. */
  renewHint?: string;
}

/** What the "My licence" button tells a member about their own subscription. */
export function describeMemberLicence(input: MemberLicenceInput): { title: string; lines: string[]; active: boolean } {
  if (input.isOwner) {
    return { title: 'Owner', lines: ['You have no limits. Every code you generate lasts 400 power-ups.'], active: true };
  }
  const days = daysLeft(input.expiresAt, input.now);
  if (input.expiresAt === null && !input.hadTrial) {
    return {
      title: 'No subscription yet',
      lines: [`Press **Generate** to start your free **${input.trialDays}-day** trial and get your first code.`],
      active: false,
    };
  }
  if (days <= 0 || input.expiresAt === null) {
    const lines = input.expiresAt === null ? [] : [`Your access ended <t:${Math.floor(input.expiresAt / 1000)}:D>.`];
    if (input.hadTrial) lines.push('Your free trial has been used.');
    lines.push(input.renewHint ?? 'Open a support ticket to renew.');
    return { title: 'Subscription ended', lines, active: false };
  }
  const tier = tierForDaysLeft(days);
  const lines = [
    `**${days} day${days === 1 ? '' : 's'}** left (ends <t:${Math.floor(input.expiresAt / 1000)}:D>)`,
    tier ? `A code generated now lasts **${TIER_USES[tier]} power-ups**.` : '',
    `Codes generated in the last day: **${input.codesToday} of ${input.maxPerDay}**`,
    input.latest
      ? `Last code: number \`${input.latest.challenge}\`, <t:${Math.floor(input.latest.createdAt / 1000)}:R>`
      : 'You have not generated a code yet.',
  ].filter(Boolean);
  return { title: input.onTrial ? 'Free trial' : 'Active subscription', lines, active: true };
}
