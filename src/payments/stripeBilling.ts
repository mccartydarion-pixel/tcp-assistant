import Stripe from 'stripe';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, type Interaction } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { createPaymentStore, type PaymentStore } from './paymentStore.js';
import { describeSubscription, formatPrice, isLive, isProrationLine, paymentReceipt, periodDays, planChangeReceipt, type SubscriptionRecord } from './paymentRules.js';
import { premiumAvailable, premiumDownloadButton } from '../premium/premium.js';

// T.C.P Premium through Stripe: a monthly subscription, and optionally a yearly one (STRIPE_YEARLY_PRICE_ID).
// Members press Subscribe (or Yearly) and pay on a Stripe Checkout page made for their Discord account; every
// paid invoice adds its period's days to their licence, and a switch from monthly to yearly in the portal
// extends the licence to the end of the new yearly period.
// Manage subscription opens Stripe's own portal (cancel, change card). The bot never sees card details: it
// only reacts to the signed events Stripe sends to /stripe/webhook. Refunds and disputes are flagged to the
// owner, who decides whether to end access.
const PREFIX = 'tcp-pay:';
const SUBSCRIBE_ID = `${PREFIX}subscribe`;
const SUBSCRIBE_YEARLY_ID = `${PREFIX}subscribe-yearly`;
const MANAGE_ID = `${PREFIX}manage`;

export type GrantDays = (discordUserId: string, days: number) => Promise<number | null>;
/** Extends a licence to at least the given time; the new end and the whole days added, or null when the records are closed. */
export type GrantUntil = (discordUserId: string, until: number) => Promise<{ expiresAt: number; addedDays: number } | null>;

/** What else happens around a payment: the premium script, the Elite role and welcome (premium.ts). */
export interface PaymentHooks {
  onPaid?: (discordUserId: string, first: boolean) => Promise<void>;
  onEnded?: (discordUserId: string) => Promise<void>;
}

let stripe: Stripe | null = null;
let store: PaymentStore | null = null;
let grantDays: GrantDays | null = null;
let grantUntil: GrantUntil | null = null;
let hooks: PaymentHooks = {};
let client: Client | null = null;
let priceLabel = '';
let yearlyLabel = '';
/** "save $14.00" when a year costs less than twelve months, else empty. */
let yearlySaving = '';

/** Whether members can subscribe: Stripe keys and the price are set, and the records are open. */
export function paymentsEnabled(): boolean {
  return Boolean(stripe && store && env.STRIPE_PRICE_ID);
}

/** Whether the bot should listen for Stripe's events at all. */
export function paymentsConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

export function subscribeLabel(): string {
  return priceLabel ? `Subscribe · ${priceLabel}` : 'Subscribe';
}

export function priceText(): string {
  return priceLabel;
}

/** "$70.00/year" when the yearly plan is on, else empty. */
export function yearlyPriceText(): string {
  return yearlyLabel;
}

/** For tests: a Stripe client and records without reaching Stripe or a database. */
export function usePaymentsForTests(deps: { stripe: Stripe; store: PaymentStore; grantDays: GrantDays; grantUntil?: GrantUntil } & PaymentHooks): void {
  stripe = deps.stripe;
  store = deps.store;
  grantDays = deps.grantDays;
  grantUntil = deps.grantUntil ?? null;
  hooks = { onPaid: deps.onPaid, onEnded: deps.onEnded };
  client = null;
}

export async function initPayments(discord: Client, deps: { grantDays: GrantDays; grantUntil?: GrantUntil } & PaymentHooks): Promise<void> {
  client = discord;
  grantDays = deps.grantDays;
  grantUntil = deps.grantUntil ?? null;
  hooks = { onPaid: deps.onPaid, onEnded: deps.onEnded };
  if (!paymentsConfigured()) {
    logger.info('[TCP Payments] STRIPE_SECRET_KEY or STRIPE_PRICE_ID not set; payments are off.');
    return;
  }
  if (!env.STRIPE_WEBHOOK_SECRET) logger.warn('[TCP Payments] STRIPE_WEBHOOK_SECRET not set; payments will not add days until it is.');
  try {
    const opened = createPaymentStore();
    await opened.init();
    store = opened;
    stripe = new Stripe(env.STRIPE_SECRET_KEY!);
    const price = await stripe.prices.retrieve(env.STRIPE_PRICE_ID!);
    priceLabel = formatPrice(price.unit_amount, price.currency, price.recurring?.interval, price.recurring?.interval_count ?? 1);
    if (!price.recurring) logger.warn('[TCP Payments] STRIPE_PRICE_ID is a one-off price; Subscribe expects a monthly (recurring) price.');
    if (env.STRIPE_YEARLY_PRICE_ID) {
      try {
        const yearly = await stripe.prices.retrieve(env.STRIPE_YEARLY_PRICE_ID);
        if (yearly.recurring) {
          yearlyLabel = formatPrice(yearly.unit_amount, yearly.currency, yearly.recurring.interval, yearly.recurring.interval_count);
          yearlySaving = savingText(price, yearly);
        } else logger.warn('[TCP Payments] STRIPE_YEARLY_PRICE_ID is a one-off price, so the Yearly button is off.');
      } catch (error) {
        logger.warn({ err: error }, '[TCP Payments] Could not load STRIPE_YEARLY_PRICE_ID, so the Yearly button is off.');
      }
    }
    // Secret keys are sk_live_/sk_test_, restricted keys rk_live_/rk_test_.
    const mode = /^[sr]k_live_/.test(env.STRIPE_SECRET_KEY!) ? 'live' : 'test';
    logger.info(`[TCP Payments] Stripe ready (${mode} mode, ${[priceLabel || 'price', yearlyLabel].filter(Boolean).join(' or ')}); records (${opened.kind}).`);
  } catch (error) {
    stripe = null;
    logger.error({ err: error }, '[TCP Payments ERROR] Could not reach Stripe or open the payment records; payments are off. Check STRIPE_SECRET_KEY and STRIPE_PRICE_ID.');
  }
}

/** How much a year saves against twelve monthly payments, as "save $14.00", or empty. */
function savingText(monthly: Stripe.Price, yearly: Stripe.Price): string {
  if (monthly.recurring?.interval !== 'month' || monthly.recurring.interval_count !== 1 || yearly.recurring?.interval !== 'year') return '';
  if (monthly.currency !== yearly.currency || monthly.unit_amount === null || yearly.unit_amount === null) return '';
  const saving = monthly.unit_amount * 12 - yearly.unit_amount;
  return saving > 0 ? `save ${formatPrice(saving, yearly.currency)}` : '';
}

/** Subscribe, and Yearly when that plan is on; empty when payments are off. */
export function planButtons(): ButtonBuilder[] {
  if (!paymentsEnabled()) return [];
  return [
    new ButtonBuilder().setCustomId(SUBSCRIBE_ID).setLabel(subscribeLabel()).setStyle(ButtonStyle.Primary),
    ...(yearlyLabel
      ? [new ButtonBuilder().setCustomId(SUBSCRIBE_YEARLY_ID).setLabel(`Yearly · ${yearlyLabel}${yearlySaving ? ` · ${yearlySaving}` : ''}`).setStyle(ButtonStyle.Primary)]
      : []),
  ];
}

/** Manage subscription, or null when payments are off. */
export function manageButton(): ButtonBuilder | null {
  return paymentsEnabled() ? new ButtonBuilder().setCustomId(MANAGE_ID).setLabel('Manage subscription').setStyle(ButtonStyle.Secondary) : null;
}

/** The plan, Manage subscription and Download Premium buttons in one row, for replies; null when payments are off. */
export function paymentButtons(): ActionRowBuilder<ButtonBuilder> | null {
  if (!paymentsEnabled()) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...planButtons(),
    manageButton()!,
    ...(premiumAvailable() ? [premiumDownloadButton()] : []),
  );
}

/** Whether this member pays for T.C.P Premium right now (active, or a payment being retried). */
export async function hasLiveSubscription(discordUserId: string): Promise<boolean> {
  if (!store) return false;
  try {
    return isLive(await store.getByUser(discordUserId));
  } catch {
    return false;
  }
}

/** Whether this member's subscription will renew by itself: no expiry reminder needed. */
export async function renewsAutomatically(discordUserId: string): Promise<boolean> {
  if (!paymentsEnabled() || !store) return false;
  try {
    const record = await store.getByUser(discordUserId);
    return isLive(record) && !record!.cancelAtPeriodEnd && record!.status !== 'past_due';
  } catch {
    return false;
  }
}

/** The subscription line for a member's licence card, or null when payments are off. */
export async function subscriptionSummary(discordUserId: string): Promise<string | null> {
  if (!paymentsEnabled() || !store) return null;
  try {
    return describeSubscription(await store.getByUser(discordUserId));
  } catch (error) {
    logger.warn({ err: error }, '[TCP Payments] Could not read a subscription');
    return null;
  }
}

function returnUrl(): string {
  return `https://discord.com/channels/${env.DISCORD_GUILD_ID}${env.LICENSE_CHANNEL_ID ? `/${env.LICENSE_CHANNEL_ID}` : ''}`;
}

function linkRow(label: string, url: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url));
}

export async function handlePaymentInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  if (!paymentsEnabled() || !stripe || !store) {
    await interaction.reply({ ...notice('Payments are not set up yet. Please open a ticket and the owner will help.', { tone: 'muted' }), ephemeral: true });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;
  const record = await store.getByUser(userId);

  const subscribing = interaction.customId === SUBSCRIBE_ID || interaction.customId === SUBSCRIBE_YEARLY_ID;
  // Someone already subscribed gets the portal, never a second subscription; they switch plan there.
  if (interaction.customId === MANAGE_ID || (subscribing && isLive(record))) {
    if (!record) {
      await interaction.editReply({
        ...notice("You don't have a subscription yet. Press **Subscribe** to start one.", { tone: 'muted' }),
        components: [paymentButtons()!],
      });
      return true;
    }
    const portal = await stripe.billingPortal.sessions.create({ customer: record.customerId, return_url: returnUrl() });
    await interaction.editReply({
      embeds: [
        tcpEmbed({
          title: 'Your T.C.P subscription',
          description: [
            describeSubscription(record),
            '',
            yearlyLabel
              ? 'Switch between monthly and yearly, cancel, change your card or see your invoices on Stripe. This link is just for you and works for a short time.'
              : 'Cancel, change your card or see your invoices on Stripe. This link is just for you and works for a short time.',
          ].join('\n'),
        }),
      ],
      components: [linkRow('Manage on Stripe', portal.url)],
    });
    return true;
  }

  // Subscribe: a Checkout page made for this member, so the payment finds its way back to their licence.
  const yearly = interaction.customId === SUBSCRIBE_YEARLY_ID && Boolean(yearlyLabel);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: yearly ? env.STRIPE_YEARLY_PRICE_ID! : env.STRIPE_PRICE_ID!, quantity: 1 }],
    client_reference_id: userId,
    metadata: { discord_user_id: userId },
    subscription_data: { metadata: { discord_user_id: userId, discord_username: interaction.user.username } },
    allow_promotion_codes: true,
    success_url: returnUrl(),
    cancel_url: returnUrl(),
    ...(record?.customerId ? { customer: record.customerId } : {}),
  });
  if (!session.url) throw new Error('Stripe returned a checkout session without a URL');
  logger.info(`[TCP Payments] Checkout started for ${userId} (${yearly ? 'yearly' : 'monthly'})`);
  await interaction.editReply({
    embeds: [
      tcpEmbed({
        title: 'T.C.P Premium',
        description: [
          yearly
            ? `**${yearlyLabel}**, renews automatically each year. Cancel any time.`
            : priceLabel
              ? `**${priceLabel}**, renews automatically. Cancel any time.`
              : 'A monthly subscription that renews automatically. Cancel any time.',
          '',
          'Every payment adds days to your license straight away; you will get a DM when it does.',
          'Then press **Generate** on the license panel for your code.',
          '',
          'This payment link is made for your Discord account, so do not share it. It expires in 24 hours.',
        ].join('\n'),
      }),
    ],
    components: [linkRow('Pay with Stripe', session.url)],
  });
  return true;
}

// ---- webhook --------------------------------------------------------------------------------------

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function ownerLog(title: string, description: string, tone: Tone): Promise<void> {
  if (!client || !env.LOG_CHANNEL_ID) return;
  try {
    const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [tcpEmbed({ title, description, tone, timestamp: true })], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Payments] Could not write to the log channel');
  }
}

async function dm(discordUserId: string, title: string, description: string, tone: Tone = 'brand'): Promise<void> {
  if (!client) return;
  try {
    const user = await client.users.fetch(discordUserId);
    await user.send({ embeds: [tcpEmbed({ title, description, tone })] });
  } catch (error) {
    logger.info({ err: error }, `[TCP Payments] Could not DM ${discordUserId}`);
  }
}

/** The member a Stripe object belongs to: from the metadata the bot set at checkout, else from the customer. */
async function memberFor(metadata: Stripe.Metadata | null | undefined, customerId: string | null): Promise<string | null> {
  const fromMetadata = metadata?.discord_user_id;
  if (fromMetadata) return fromMetadata;
  if (!customerId || !store) return null;
  return (await store.getByCustomer(customerId))?.discordUserId ?? null;
}

async function saveSubscription(subscription: Stripe.Subscription, discordUserId: string): Promise<{ before: SubscriptionRecord | null; after: SubscriptionRecord }> {
  const before = await store!.getByUser(discordUserId);
  const after: SubscriptionRecord = {
    discordUserId,
    customerId: idOf(subscription.customer) ?? before?.customerId ?? '',
    subscriptionId: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || Boolean(subscription.cancel_at),
    currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? before?.currentPeriodEnd ?? null,
    updatedAt: Date.now(),
  };
  await store!.save(after);
  return { before, after };
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription') return;
  const discordUserId = session.client_reference_id ?? session.metadata?.discord_user_id ?? null;
  const customerId = idOf(session.customer);
  if (!discordUserId || !customerId) {
    await ownerLog('Payment from an unknown member', `Checkout ${session.id} has no Discord account attached. Find them in Stripe and add days by hand.`, 'danger');
    return;
  }
  const existing = await store!.getByUser(discordUserId);
  await store!.save({
    discordUserId,
    customerId,
    subscriptionId: idOf(session.subscription),
    status: existing && existing.subscriptionId === idOf(session.subscription) ? existing.status : 'active',
    cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: existing?.currentPeriodEnd ?? null,
    updatedAt: Date.now(),
  });
  await ownerLog('New subscriber', `<@${discordUserId}> subscribed${priceLabel ? ` (${priceLabel})` : ''}.`, 'success');
}

async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (invoice.billing_reason === 'subscription_update') {
    await onPlanChangePaid(invoice);
    return;
  }
  if (invoice.billing_reason !== 'subscription_create' && invoice.billing_reason !== 'subscription_cycle') return;
  const details = invoice.parent?.subscription_details ?? null;
  const customerId = idOf(invoice.customer);
  const discordUserId = await memberFor(details?.metadata, customerId);
  const amount = formatPrice(invoice.amount_paid, invoice.currency);
  if (!discordUserId) {
    await ownerLog('Payment from an unknown member', `Invoice ${invoice.id} (${amount}) has no Discord account attached. Add their days by hand.`, 'danger');
    return;
  }
  const line = invoice.lines.data.find((item) => item.period) ?? invoice.lines.data[0];
  const days = periodDays(line?.period.start, line?.period.end);
  const expiresAt = grantDays ? await grantDays(discordUserId, days) : null;
  if (expiresAt === null) throw new Error('The license records are not open, so the paid days could not be added');
  logger.info(`[TCP Payments] ${discordUserId} paid ${amount}; ${days} days added`);

  // The days are added: nothing below may fail the event, or Stripe's retry would add them a second time.
  const first = invoice.billing_reason === 'subscription_create';
  try {
    const subscriptionId = idOf(details?.subscription);
    const existing = await store!.getByUser(discordUserId);
    await store!.save({
      discordUserId,
      customerId: customerId ?? existing?.customerId ?? '',
      subscriptionId: subscriptionId ?? existing?.subscriptionId ?? null,
      status: 'active',
      cancelAtPeriodEnd: existing?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: line?.period.end ?? existing?.currentPeriodEnd ?? null,
      updatedAt: Date.now(),
    });
  } catch (error) {
    logger.error({ err: error }, `[TCP Payments ERROR] Days were added for ${discordUserId}, but the subscription record could not be saved`);
  }
  const receipt = paymentReceipt(days, expiresAt, first, env.LICENSE_CHANNEL_ID);
  await dm(discordUserId, receipt.title, receipt.description, 'success');
  await ownerLog(
    first ? 'First payment' : 'Renewal paid',
    `<@${discordUserId}> paid ${amount}: ${days} days added, license runs until <t:${Math.floor(expiresAt / 1000)}:D>.`,
    'success',
  );
  await hooks.onPaid?.(discordUserId, first).catch((error: unknown) => logger.error({ err: error }, '[TCP Payments ERROR] After-payment step failed'));
}

/**
 * A plan change paid at once: switching from monthly to yearly bills the new yearly period straight away (less
 * a credit for the unused month). The licence is extended to the end of that period, so the member is not
 * paid twice for the days the credit covered. A change made of credits and proration lines only (or paid
 * for entirely by credit) adds nothing; a switch back to monthly is set to happen at the end of the year.
 */
async function onPlanChangePaid(invoice: Stripe.Invoice): Promise<void> {
  const plan = invoice.lines.data.find((line) => line.period && !isProrationLine(line));
  if (!plan || invoice.amount_paid <= 0) return;
  const details = invoice.parent?.subscription_details ?? null;
  const customerId = idOf(invoice.customer);
  const discordUserId = await memberFor(details?.metadata, customerId);
  const amount = formatPrice(invoice.amount_paid, invoice.currency);
  if (!discordUserId) {
    await ownerLog('Plan change from an unknown member', `Invoice ${invoice.id} (${amount}) has no Discord account attached. Add their days by hand.`, 'danger');
    return;
  }
  const granted = grantUntil ? await grantUntil(discordUserId, plan.period.end * 1000) : null;
  if (!granted) throw new Error('The license records are not open, so the plan change could not extend the license');
  logger.info(`[TCP Payments] ${discordUserId} changed plan and paid ${amount}; ${granted.addedDays} days added`);

  // The licence is extended: nothing below may fail the event, or Stripe's retry would run it again.
  try {
    const existing = await store!.getByUser(discordUserId);
    if (existing) await store!.save({ ...existing, status: 'active', currentPeriodEnd: plan.period.end, updatedAt: Date.now() });
  } catch (error) {
    logger.error({ err: error }, `[TCP Payments ERROR] The license was extended for ${discordUserId}, but the subscription record could not be saved`);
  }
  const yearlyPlan = plan.pricing?.price_details?.price === env.STRIPE_YEARLY_PRICE_ID;
  const receipt = planChangeReceipt(granted.addedDays, granted.expiresAt, yearlyPlan ? `the yearly plan (${yearlyLabel})` : '');
  await dm(discordUserId, receipt.title, receipt.description, 'success');
  await ownerLog(
    'Plan changed',
    `<@${discordUserId}> paid ${amount} to change plan${yearlyPlan ? ' to yearly' : ''}: ${granted.addedDays} days added, license runs until <t:${Math.floor(granted.expiresAt / 1000)}:D>.`,
    'success',
  );
  await hooks.onPaid?.(discordUserId, false).catch((error: unknown) => logger.error({ err: error }, '[TCP Payments ERROR] After-payment step failed'));
}

async function onInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const discordUserId = await memberFor(invoice.parent?.subscription_details?.metadata, idOf(invoice.customer));
  const amount = formatPrice(invoice.amount_due, invoice.currency);
  if (discordUserId) {
    await dm(
      discordUserId,
      'Your T.C.P payment failed',
      `Stripe could not take your ${amount} payment. Press **Manage subscription** on the license panel to update your card; Stripe will try again. Your license keeps its current days.`,
      'warning',
    );
  }
  await ownerLog('Payment failed', `${discordUserId ? `<@${discordUserId}>` : `Customer ${idOf(invoice.customer)}`}: ${amount} could not be charged.`, 'warning');
}

async function onSubscriptionChanged(subscription: Stripe.Subscription, deleted: boolean): Promise<void> {
  const discordUserId = await memberFor(subscription.metadata, idOf(subscription.customer));
  if (!discordUserId) return;
  const { before, after } = await saveSubscription(subscription, discordUserId);
  const until = after.currentPeriodEnd ? `<t:${after.currentPeriodEnd}:D>` : 'the end of the paid period';
  if (deleted || after.status === 'canceled') {
    if (before?.status === 'canceled') return;
    await dm(discordUserId, 'Your T.C.P subscription has ended', 'It will not renew. Your license keeps any days it already has. Press **Subscribe** on the license panel any time to come back.', 'muted');
    await ownerLog('Subscription ended', `<@${discordUserId}>'s subscription has ended.`, 'muted');
    await hooks.onEnded?.(discordUserId).catch((error: unknown) => logger.error({ err: error }, '[TCP Payments ERROR] Subscription-ended step failed'));
    return;
  }
  if (after.cancelAtPeriodEnd && !before?.cancelAtPeriodEnd) {
    await dm(discordUserId, 'Your T.C.P subscription is cancelled', `It will not renew after ${until}. Changed your mind? Press **Manage subscription** to keep it.`, 'muted');
    await ownerLog('Subscription cancelled', `<@${discordUserId}> cancelled; it stops renewing after ${until}.`, 'muted');
  } else if (!after.cancelAtPeriodEnd && before?.cancelAtPeriodEnd && isLive(after)) {
    await ownerLog('Subscription resumed', `<@${discordUserId}> turned renewal back on.`, 'success');
  }
}

async function onChargeProblem(charge: Stripe.Charge | Stripe.Dispute, kind: 'refund' | 'dispute'): Promise<void> {
  // A dispute does not name the customer; its charge does.
  let customerId = 'customer' in charge ? idOf(charge.customer) : null;
  if (!customerId && 'charge' in charge && stripe) {
    const disputed = await stripe.charges.retrieve(idOf(charge.charge)!).catch(() => null);
    customerId = idOf(disputed?.customer);
  }
  const discordUserId = customerId ? await memberFor(null, customerId) : null;
  const amount = formatPrice(kind === 'refund' ? (charge as Stripe.Charge).amount_refunded : charge.amount, charge.currency);
  const who = discordUserId ? `<@${discordUserId}>` : 'A customer the bot does not know';
  await ownerLog(
    kind === 'refund' ? 'Payment refunded' : 'Payment disputed (chargeback)',
    `${who}: ${amount}. Their license days were not changed; use **End access** on the owner panel if they should lose them.`,
    'danger',
  );
}

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(event.data.object);
    case 'invoice.paid':
      return onInvoicePaid(event.data.object);
    case 'invoice.payment_failed':
      return onInvoiceFailed(event.data.object);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return onSubscriptionChanged(event.data.object, false);
    case 'customer.subscription.deleted':
      return onSubscriptionChanged(event.data.object, true);
    case 'charge.refunded':
      return onChargeProblem(event.data.object, 'refund');
    case 'charge.dispute.created':
      return onChargeProblem(event.data.object, 'dispute');
    default:
      return;
  }
}

/** Handles one delivery to /stripe/webhook. Only events Stripe signed are acted on, and each only once. */
export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ status: number; body: string }> {
  if (!stripe || !store || !env.STRIPE_WEBHOOK_SECRET) return { status: 503, body: 'payments not configured' };
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? '', env.STRIPE_WEBHOOK_SECRET);
  } catch {
    logger.warn('[TCP Payments] Rejected a webhook call with a missing or wrong signature');
    return { status: 400, body: 'invalid signature' };
  }
  if (!(await store.claimEvent(event.id, Date.now()))) return { status: 200, body: 'already handled' };
  try {
    await processEvent(event);
    return { status: 200, body: 'ok' };
  } catch (error) {
    // Let Stripe retry: forget that this event was seen.
    await store.releaseEvent(event.id).catch(() => undefined);
    logger.error({ err: error }, `[TCP Payments ERROR] Could not handle ${event.type} (${event.id}); Stripe will retry`);
    return { status: 500, body: 'error' };
  }
}
