import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { describeSubscription, formatPrice, isLive, paymentReceipt, periodDays, type SubscriptionRecord } from '../src/payments/paymentRules.js';
import type { PaymentStore } from '../src/payments/paymentStore.js';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_ID = 'price_test';
const { handleStripeWebhook, usePaymentsForTests, renewsAutomatically } = await import('../src/payments/stripeBilling.js');

const DAY = 86_400;
const record = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  discordUserId: 'u1',
  customerId: 'cus_1',
  subscriptionId: 'sub_1',
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: 1_800_000_000,
  updatedAt: 0,
  ...overrides,
});

describe('payment rules', () => {
  it('pays for as many days as the billing period, 30 when unknown', () => {
    expect(periodDays(1_700_000_000, 1_700_000_000 + 30 * DAY)).toBe(30);
    expect(periodDays(1_700_000_000, 1_700_000_000 + 31 * DAY)).toBe(31);
    expect(periodDays(1_700_000_000, 1_700_000_000 + 365 * DAY)).toBe(365);
    expect(periodDays(null, 1)).toBe(30);
    expect(periodDays(10, 5)).toBe(30);
  });

  it('shows the price the way Stripe charges it', () => {
    expect(formatPrice(700, 'usd', 'month')).toBe('$7.00/month');
    expect(formatPrice(700, 'eur', 'month')).toBe('€7.00/month');
    expect(formatPrice(1800, 'usd', 'month', 3)).toBe('$18.00 every 3 months');
    expect(formatPrice(700, 'usd')).toBe('$7.00');
    expect(formatPrice(null, 'usd', 'month')).toBe('');
  });

  it('describes each subscription state for the licence card', () => {
    expect(describeSubscription(null)).toContain('Press **Subscribe**');
    expect(describeSubscription(record())).toBe('Active: renews <t:1800000000:D>.');
    expect(describeSubscription(record({ cancelAtPeriodEnd: true }))).toBe('Cancelled: it will not renew after <t:1800000000:D>.');
    expect(describeSubscription(record({ status: 'past_due' }))).toContain('update your card');
    expect(describeSubscription(record({ status: 'canceled' }))).toContain('Ended');
    expect(isLive(record({ status: 'trialing' }))).toBe(true);
    expect(isLive(record({ status: 'incomplete' }))).toBe(false);
  });

  it('tells the member what a payment added and where to get a code', () => {
    const first = paymentReceipt(30, Date.UTC(2026, 10, 15), true, '20');
    expect(first.title).toBe('Welcome to T.C.P Premium');
    expect(first.description).toContain('**30 days** added');
    expect(first.description).toContain('<#20>');
    expect(first.description).toContain('Cancel any time');
    expect(paymentReceipt(31, Date.UTC(2026, 10, 15), false).title).toBe('Your T.C.P subscription renewed');
  });
});

/** In-memory payment records, standing in for Postgres. */
function memoryStore(): PaymentStore & { records: Map<string, SubscriptionRecord>; events: Set<string> } {
  const records = new Map<string, SubscriptionRecord>();
  const events = new Set<string>();
  return {
    kind: 'sqlite',
    records,
    events,
    async init() {},
    async getByUser(id) {
      return records.get(id) ?? null;
    },
    async getByCustomer(customerId) {
      return [...records.values()].find((r) => r.customerId === customerId) ?? null;
    },
    async save(r) {
      records.set(r.discordUserId, r);
    },
    async claimEvent(id) {
      if (events.has(id)) return false;
      events.add(id);
      return true;
    },
    async releaseEvent(id) {
      events.delete(id);
    },
  };
}

describe('stripe webhook', () => {
  const stripe = new Stripe('sk_test_not_used');

  function signed(event: object) {
    const payload = JSON.stringify(event);
    return { body: Buffer.from(payload), signature: stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) };
  }

  function setUp(grant: (user: string, days: number) => Promise<number | null> = async () => Date.UTC(2026, 11, 1)) {
    const store = memoryStore();
    const grants: [string, number][] = [];
    usePaymentsForTests({
      stripe,
      store,
      grantDays: async (user, days) => {
        grants.push([user, days]);
        return grant(user, days);
      },
    });
    return { store, grants };
  }

  const start = 1_800_000_000;
  const invoicePaid = (id: string, reason: string, metadata: Record<string, string> | null = { discord_user_id: 'u1' }) => ({
    id,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_${id}`,
        object: 'invoice',
        billing_reason: reason,
        customer: 'cus_1',
        amount_paid: 700,
        amount_due: 700,
        currency: 'usd',
        parent: { type: 'subscription_details', subscription_details: { metadata, subscription: 'sub_1' } },
        lines: { object: 'list', data: [{ id: 'il_1', period: { start, end: start + 30 * DAY } }] },
      },
    },
  });

  it('refuses anything Stripe did not sign', async () => {
    setUp();
    const { body } = signed(invoicePaid('evt_forged', 'subscription_create'));
    expect(await handleStripeWebhook(body, 't=1,v1=forged')).toEqual({ status: 400, body: 'invalid signature' });
    expect(await handleStripeWebhook(body, undefined)).toEqual({ status: 400, body: 'invalid signature' });
  });

  it('adds the paid days once, however often Stripe sends the payment', async () => {
    const { store, grants } = setUp();
    const { body, signature } = signed(invoicePaid('evt_1', 'subscription_create'));
    expect(await handleStripeWebhook(body, signature)).toEqual({ status: 200, body: 'ok' });
    expect(await handleStripeWebhook(body, signature)).toEqual({ status: 200, body: 'already handled' });
    expect(grants).toEqual([['u1', 30]]);
    expect(store.records.get('u1')).toMatchObject({ customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active', currentPeriodEnd: start + 30 * DAY });
  });

  it('adds days for renewals but not for mid-period changes', async () => {
    const { grants } = setUp();
    const renewal = signed(invoicePaid('evt_2', 'subscription_cycle'));
    const change = signed(invoicePaid('evt_3', 'subscription_update'));
    await handleStripeWebhook(renewal.body, renewal.signature);
    await handleStripeWebhook(change.body, change.signature);
    expect(grants).toEqual([['u1', 30]]);
  });

  it('finds the member from the customer when the invoice has no Discord account on it', async () => {
    const { store, grants } = setUp();
    await store.save(record({ discordUserId: 'u9', customerId: 'cus_1' }));
    const { body, signature } = signed(invoicePaid('evt_4', 'subscription_cycle', null));
    expect((await handleStripeWebhook(body, signature)).status).toBe(200);
    expect(grants).toEqual([['u9', 30]]);
  });

  it('lets Stripe retry when the licence records are not ready, then adds the days', async () => {
    let ready = false;
    const { grants } = setUp(async () => (ready ? Date.UTC(2026, 11, 1) : null));
    const { body, signature } = signed(invoicePaid('evt_5', 'subscription_create'));
    expect((await handleStripeWebhook(body, signature)).status).toBe(500);
    ready = true;
    expect(await handleStripeWebhook(body, signature)).toEqual({ status: 200, body: 'ok' });
    expect(grants).toEqual([
      ['u1', 30],
      ['u1', 30],
    ]);
  });

  it('records a cancellation, after which the member gets expiry reminders again', async () => {
    const { store } = setUp();
    await store.save(record());
    expect(await renewsAutomatically('u1')).toBe(true);
    const { body, signature } = signed({
      id: 'evt_6',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          object: 'subscription',
          customer: 'cus_1',
          status: 'active',
          cancel_at_period_end: true,
          cancel_at: null,
          metadata: { discord_user_id: 'u1' },
          items: { object: 'list', data: [{ id: 'si_1', current_period_end: start + 30 * DAY }] },
        },
      },
    });
    expect((await handleStripeWebhook(body, signature)).status).toBe(200);
    expect(store.records.get('u1')).toMatchObject({ cancelAtPeriodEnd: true, currentPeriodEnd: start + 30 * DAY });
    expect(await renewsAutomatically('u1')).toBe(false);
  });

  it('links the Discord account to the Stripe customer when checkout completes', async () => {
    const { store } = setUp();
    const { body, signature } = signed({
      id: 'evt_7',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', object: 'checkout.session', mode: 'subscription', client_reference_id: 'u2', customer: 'cus_2', subscription: 'sub_2', metadata: {} } },
    });
    expect((await handleStripeWebhook(body, signature)).status).toBe(200);
    expect(store.records.get('u2')).toMatchObject({ customerId: 'cus_2', subscriptionId: 'sub_2', status: 'active' });
  });
});
