import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { formatPrice, isProrationLine, paymentReceipt, periodDays, planChangeReceipt, type SubscriptionRecord } from '../src/payments/paymentRules.js';
import type { PaymentStore } from '../src/payments/paymentStore.js';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_ID = 'price_test';
process.env.STRIPE_YEARLY_PRICE_ID = 'price_year';
const { handleStripeWebhook, usePaymentsForTests } = await import('../src/payments/stripeBilling.js');

const DAY = 86_400;
const start = 1_800_000_000;

describe('the yearly plan', () => {
  it('reads as a yearly price and pays for a year of days', () => {
    expect(formatPrice(7000, 'usd', 'year')).toBe('$70.00/year');
    expect(periodDays(start, start + 365 * DAY)).toBe(365);
    expect(paymentReceipt(365, 0, true).description).toContain('Each renewal adds more days automatically.');
    expect(paymentReceipt(365, 0, true).description).not.toContain('monthly');
  });

  it('tells credit and proration lines apart from the new plan', () => {
    expect(isProrationLine({ parent: { subscription_item_details: { proration: true } } })).toBe(true);
    expect(isProrationLine({ parent: { invoice_item_details: { proration: true } } })).toBe(true);
    expect(isProrationLine({ parent: { subscription_item_details: { proration: false } } })).toBe(false);
    expect(isProrationLine({})).toBe(false);
  });

  it('words the plan change receipt', () => {
    const changed = planChangeReceipt(345, Date.UTC(2027, 9, 16), 'the yearly plan ($70.00/year)');
    expect(changed.title).toBe('Your T.C.P plan changed');
    expect(changed.description).toContain('You are now on **the yearly plan ($70.00/year)**.');
    expect(changed.description).toContain('**345 days** added to your license.');
    expect(planChangeReceipt(0, Date.UTC(2027, 9, 16), '').description).not.toContain('added');
  });
});

describe('switching from monthly to yearly', () => {
  const stripe = new Stripe('sk_test_not_used');

  function memoryStore(): PaymentStore {
    const records = new Map<string, SubscriptionRecord>();
    const events = new Set<string>();
    return {
      kind: 'sqlite',
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

  type Line = { period: { start: number; end: number }; proration: boolean; price: string };
  function invoice(id: string, reason: string, amountPaid: number, lines: Line[]) {
    const payload = JSON.stringify({
      id,
      object: 'event',
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_${id}`,
          object: 'invoice',
          billing_reason: reason,
          customer: 'cus_1',
          amount_paid: amountPaid,
          currency: 'usd',
          parent: { type: 'subscription_details', subscription_details: { metadata: { discord_user_id: 'u1' }, subscription: 'sub_1' } },
          lines: {
            object: 'list',
            data: lines.map((line, index) => ({
              id: `il_${index}`,
              period: line.period,
              parent: { type: 'subscription_item_details', subscription_item_details: { proration: line.proration } },
              pricing: { type: 'price_details', price_details: { price: line.price, product: 'prod_1' } },
            })),
          },
        },
      },
    });
    return { body: Buffer.from(payload), signature: stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) };
  }

  function setUp() {
    const grantedDays: number[] = [];
    const extendedTo: number[] = [];
    usePaymentsForTests({
      stripe,
      store: memoryStore(),
      grantDays: async (_, days) => {
        grantedDays.push(days);
        return Date.UTC(2027, 0, 1);
      },
      grantUntil: async (_, until) => {
        extendedTo.push(until);
        return { expiresAt: until, addedDays: 340 };
      },
    });
    return { grantedDays, extendedTo };
  }

  it('a yearly first payment adds a year of days', async () => {
    const { grantedDays } = setUp();
    const paid = invoice('evt_y1', 'subscription_create', 7000, [{ period: { start, end: start + 365 * DAY }, proration: false, price: 'price_year' }]);
    expect(await handleStripeWebhook(paid.body, paid.signature)).toEqual({ status: 200, body: 'ok' });
    expect(grantedDays).toEqual([365]);
  });

  it('extends the license to the end of the new yearly period, once', async () => {
    const { grantedDays, extendedTo } = setUp();
    const now = start + 10 * DAY;
    const paid = invoice('evt_switch', 'subscription_update', 6533, [
      // Credit for the unused 20 days of the month, then the new yearly period.
      { period: { start: now, end: start + 30 * DAY }, proration: true, price: 'price_test' },
      { period: { start: now, end: now + 365 * DAY }, proration: false, price: 'price_year' },
    ]);
    await handleStripeWebhook(paid.body, paid.signature);
    expect(await handleStripeWebhook(paid.body, paid.signature)).toEqual({ status: 200, body: 'already handled' });
    expect(extendedTo).toEqual([(now + 365 * DAY) * 1000]);
    expect(grantedDays).toEqual([]);
  });

  it('adds nothing for a change made only of proration lines, or paid entirely by credit', async () => {
    const { grantedDays, extendedTo } = setUp();
    const prorationOnly = invoice('evt_pro', 'subscription_update', 300, [{ period: { start, end: start + 20 * DAY }, proration: true, price: 'price_test' }]);
    const byCredit = invoice('evt_credit', 'subscription_update', 0, [{ period: { start, end: start + 30 * DAY }, proration: false, price: 'price_test' }]);
    await handleStripeWebhook(prorationOnly.body, prorationOnly.signature);
    await handleStripeWebhook(byCredit.body, byCredit.signature);
    expect(extendedTo).toEqual([]);
    expect(grantedDays).toEqual([]);
  });
});

describe('license panel layout', () => {
  it('puts one purpose on each row: use, plans, account', async () => {
    const { licencePanelRows } = await import('../src/license/licensePanel.js');
    const labels = () => licencePanelRows().map((row) => row.toJSON().components.map((button) => ('label' in button ? button.label : '')));
    // Payments set up (as in the tests above): Generate, then the plan, then the account buttons.
    usePaymentsForTests({ stripe: new Stripe('sk_test_not_used'), store: {} as PaymentStore, grantDays: async () => 0 });
    const rows = labels();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['Generate']);
    expect(rows[1]![0]).toMatch(/^Subscribe/);
    expect(rows[2]).toEqual(['My license', 'Manage subscription']);
  });
});
