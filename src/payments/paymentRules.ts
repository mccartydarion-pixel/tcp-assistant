// What a T.C.P subscription payment means for a member: how many licence days an invoice is worth, how the
// price and the subscription's state read, and what the member is told. Plain data and functions;
// stripeBilling.ts does the Stripe and Discord side.

/** Stripe subscription states in which the member is still a paying subscriber. */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

export interface SubscriptionRecord {
  discordUserId: string;
  customerId: string;
  subscriptionId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  /** Unix seconds; when the paid period ends (and the next charge is due unless cancelled). */
  currentPeriodEnd: number | null;
  updatedAt: number;
}

export function isLive(record: Pick<SubscriptionRecord, 'status'> | null | undefined): boolean {
  return Boolean(record && (LIVE_STATUSES as readonly string[]).includes(record.status));
}

/** Licence days an invoice pays for: the length of its billing period, rounded to whole days (30 if unknown). */
export function periodDays(startSeconds: number | null | undefined, endSeconds: number | null | undefined): number {
  if (!startSeconds || !endSeconds || endSeconds <= startSeconds) return 30;
  return Math.max(1, Math.round((endSeconds - startSeconds) / 86_400));
}

/** "$7.00/month" from Stripe's price, in the price's own currency. */
export function formatPrice(unitAmount: number | null | undefined, currency: string, interval?: string | null, intervalCount = 1): string {
  if (unitAmount === null || unitAmount === undefined) return '';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(unitAmount / 100);
  if (!interval) return amount;
  return intervalCount > 1 ? `${amount} every ${intervalCount} ${interval}s` : `${amount}/${interval}`;
}

/** One line on the member's licence card about their subscription. */
export function describeSubscription(record: SubscriptionRecord | null): string {
  if (!record) return 'No subscription. Press **Subscribe** to start one.';
  const when = record.currentPeriodEnd ? `<t:${record.currentPeriodEnd}:D>` : null;
  if (record.status === 'past_due') return 'Your last payment failed. Press **Manage subscription** to update your card.';
  if (isLive(record)) {
    if (record.cancelAtPeriodEnd) return when ? `Cancelled: it will not renew after ${when}.` : 'Cancelled: it will not renew.';
    return when ? `Active: renews ${when}.` : 'Active.';
  }
  return 'Ended. Press **Subscribe** to start again.';
}

/** True for an invoice line that settles a plan change (credit for unused time, or a charge for the rest of a period). */
export function isProrationLine(line: { parent?: { subscription_item_details?: { proration: boolean } | null; invoice_item_details?: { proration: boolean } | null } | null }): boolean {
  return Boolean(line.parent?.subscription_item_details?.proration || line.parent?.invoice_item_details?.proration);
}

/** The DM a member gets when they switch plan (monthly to yearly) and the new plan's period is paid. */
export function planChangeReceipt(addedDays: number, expiresAt: number, planLabel: string): { title: string; description: string } {
  const until = `<t:${Math.floor(expiresAt / 1000)}:D>`;
  return {
    title: 'Your T.C.P plan changed',
    description: [
      planLabel ? `You are now on **${planLabel}**.` : 'Your new plan is active.',
      addedDays > 0 ? `**${addedDays} days** added to your licence. It now runs until ${until}.` : `Your licence runs until ${until}.`,
    ].join('\n'),
  };
}

/** The DM a member gets when a payment goes through. */
export function paymentReceipt(days: number, expiresAt: number, firstPayment: boolean, licenceChannelId?: string): { title: string; description: string } {
  const until = `<t:${Math.floor(expiresAt / 1000)}:D>`;
  return {
    title: firstPayment ? 'Welcome to T.C.P Premium' : 'Your T.C.P subscription renewed',
    description: [
      `Payment received: **${days} days** added to your licence. It now runs until ${until}.`,
      licenceChannelId
        ? `Need a code for your Zen? Press **Generate** in <#${licenceChannelId}>.`
        : 'Need a code for your Zen? Press **Generate** on the licence panel.',
      firstPayment ? 'Each renewal adds more days automatically. Cancel any time with **Manage subscription**.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
