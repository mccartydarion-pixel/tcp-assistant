import type { ChatInputCommandInteraction } from 'discord.js';
import { env } from '../config/env.js';
import { notice, tcpEmbed } from '../bot/embeds.js';
import { roleMembers } from '../bot/jobs.js';
import { formatPrice, LIVE_STATUSES } from '../payments/paymentRules.js';
import { listStripeSubscriptions, paidSince, type StripeSubscriptionInfo } from '../payments/stripeBilling.js';
import { licenceCounts } from '../license/licensePanel.js';
import { eliteRole } from '../premium/premium.js';
import { lastWeekSupport, supportFields } from '../tickets/ticketFeedback.js';

// /tcp stats: the owner's dashboard in one private reply. Subscribers by plan, monthly revenue, what came in
// over 30 days, this week's new and lost subscribers, license holders, the Elite role and the week's support.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SubscriptionStats {
  live: number;
  monthly: number;
  yearly: number;
  other: number;
  cancelling: number;
  pastDue: number;
  newThisWeek: number;
  endedThisWeek: number;
  /** Monthly recurring revenue per currency, in the currency's smallest unit (cents). */
  mrr: Map<string, number>;
}

/** The subscription figures from Stripe's list. */
export function subscriptionStats(subscriptions: StripeSubscriptionInfo[], now: number): SubscriptionStats {
  const stats: SubscriptionStats = { live: 0, monthly: 0, yearly: 0, other: 0, cancelling: 0, pastDue: 0, newThisWeek: 0, endedThisWeek: 0, mrr: new Map() };
  for (const subscription of subscriptions) {
    if (subscription.createdAt >= now - WEEK_MS) stats.newThisWeek += 1;
    if (subscription.endedAt && subscription.endedAt >= now - WEEK_MS) stats.endedThisWeek += 1;
    if (!(LIVE_STATUSES as readonly string[]).includes(subscription.status)) continue;
    stats.live += 1;
    if (subscription.cancelAtPeriodEnd) stats.cancelling += 1;
    if (subscription.status === 'past_due') stats.pastDue += 1;
    const monthly = subscription.interval === 'month' && subscription.intervalCount === 1;
    const yearly = subscription.interval === 'year' && subscription.intervalCount === 1;
    if (monthly) stats.monthly += 1;
    else if (yearly) stats.yearly += 1;
    else stats.other += 1;
    if (subscription.unitAmount !== null && subscription.interval) {
      const perMonth =
        subscription.interval === 'year'
          ? subscription.unitAmount / (12 * subscription.intervalCount)
          : subscription.interval === 'month'
            ? subscription.unitAmount / subscription.intervalCount
            : subscription.interval === 'week'
              ? (subscription.unitAmount * 52) / (12 * subscription.intervalCount)
              : (subscription.unitAmount * 365) / (12 * subscription.intervalCount);
      stats.mrr.set(subscription.currency, (stats.mrr.get(subscription.currency) ?? 0) + perMonth);
    }
  }
  return stats;
}

const money = (totals: Map<string, number> | { currency: string; amount: number }[]) => {
  const entries = totals instanceof Map ? [...totals.entries()].map(([currency, amount]) => ({ currency, amount })) : totals;
  return entries.length === 0 ? '$0.00' : entries.map((entry) => formatPrice(Math.round(entry.amount), entry.currency)).join(' + ');
};

export async function handleStatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const now = Date.now();
  const [subscriptions, paid, licences, support] = await Promise.all([
    listStripeSubscriptions().catch(() => null),
    paidSince(now - 30 * 24 * 60 * 60 * 1000).catch(() => null),
    licenceCounts(now).catch(() => null),
    lastWeekSupport(now).catch(() => null),
  ]);
  const guild = interaction.guild;
  const role = guild ? eliteRole(guild) : null;
  const elite = guild && role ? await roleMembers(guild, role).catch(() => null) : null;

  const fields = [];
  if (subscriptions) {
    const stats = subscriptionStats(subscriptions, now);
    fields.push(
      {
        name: '💎 Subscribers',
        value: [
          `**${stats.live}** paying: ${stats.monthly} monthly, ${stats.yearly} yearly${stats.other ? `, ${stats.other} other` : ''}`,
          `${stats.live - stats.cancelling} renewing · ${stats.cancelling} cancelled (running out)${stats.pastDue ? ` · ${stats.pastDue} with a failed payment` : ''}`,
        ].join('\n'),
        inline: false,
      },
      { name: '💵 Monthly revenue', value: `${money(stats.mrr)} a month`, inline: true },
      { name: '🧾 Last 30 days', value: paid ? `${money(paid)} from ${paid.reduce((sum, entry) => sum + entry.invoices, 0)} payments` : 'Unavailable', inline: true },
      { name: '📈 This week', value: `+${stats.newThisWeek} new · -${stats.endedThisWeek} ended`, inline: true },
    );
  } else {
    fields.push({ name: '💎 Subscribers', value: 'Stripe is not set up, or could not be reached.', inline: false });
  }
  fields.push(
    { name: '🔓 License holders', value: licences ? `${licences.active} with days left · ${licences.expiringSoon} run out within a week` : 'Unavailable', inline: true },
    { name: '👑 Elite role', value: elite ? `${elite.members.length} member${elite.members.length === 1 ? '' : 's'}${elite.complete ? '' : ' (partial count)'}` : 'Unavailable', inline: true },
  );
  if (support) fields.push(...supportFields(support).map((field) => ({ ...field, name: `🎫 ${field.name}` })));
  await interaction.editReply({ embeds: [tcpEmbed({ title: 'T.C.P stats', fields, timestamp: true })], allowedMentions: { parse: [] } });
}
