import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import type { PaymentStore } from '../src/payments/paymentStore.js';
import type { SubscriptionRecord } from '../src/payments/paymentRules.js';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_ID = 'price_test';
const { checkRelease, isEliteRoleName, isEliteWelcomeName, eliteWelcomeMessage, premiumFileMessage } = await import('../src/premium/premium.js');
const { handleStripeWebhook, usePaymentsForTests } = await import('../src/payments/stripeBilling.js');

const scrambled = Array.from({ length: 80 }, (_, index) => `define z${index.toString(16)} = ${index};`).join('\n') + '\nmain {\nset_val(PS4_R2, 100);\n}\n';

describe('premium release upload', () => {
  it('accepts the scrambled release', () => {
    expect(checkRelease('Tactical Competitive Pro Release.gpc', scrambled)).toEqual({ ok: true });
  });

  it('refuses the readable release, which carries the real licence key', () => {
    const readable = `${scrambled}\ndefine LICENSE_KEY_A1 = 12345;\n`;
    const result = checkRelease('Tactical Competitive Pro Release (readable).gpc', readable);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('licence key');
    expect(checkRelease('x.gpc', 'function license_guard() {}\n' + scrambled).ok).toBe(false);
  });

  it('refuses readable builds and anything that is not a script', () => {
    expect(checkRelease('Tactical Competitive Pro Free.gpc', 'define PAGE_MASTER = 0;\nfunction tcp_frame() {}\n').ok).toBe(false);
    expect(checkRelease('release_symbol_map.txt', scrambled).ok).toBe(false);
    expect(checkRelease('short.gpc', 'define z1 = 1;\n').ok).toBe(false);
  });
});

describe('elite role and welcome', () => {
  it('finds the Elite role and welcome channel by name, whatever the decoration', () => {
    expect(isEliteRoleName('💎 Elite Supporter')).toBe(true);
    expect(isEliteRoleName('elite-supporter')).toBe(true);
    expect(isEliteRoleName('Elite')).toBe(false);
    expect(isEliteRoleName('Supporter')).toBe(false);
    expect(isEliteWelcomeName('🌟・elite-welcome')).toBe(true);
    expect(isEliteWelcomeName('welcome-elite')).toBe(true);
    expect(isEliteWelcomeName('welcome')).toBe(false);
    expect(isEliteWelcomeName('elite-chat')).toBe(false);
  });

  it('pings the new member outside the card and points them at their DMs', () => {
    const message = eliteWelcomeMessage({ id: '7', displayName: 'Ana', avatarURL: 'https://cdn.example/a.png' }, 'Elite Supporter', '20');
    expect(message.content).toBe('<@7>');
    expect(message.allowedMentions).toEqual({ users: ['7'] });
    const card = message.embeds[0]!.toJSON();
    expect(card.title).toBe('Welcome to the Elite, Ana!');
    expect(card.description).toContain("You're now an **Elite Supporter**.");
    expect(card.description).toContain('Download Premium');
    expect(card.description).toContain('<#20>');
  });

  it('attaches the script under its own name with install steps', () => {
    const message = premiumFileMessage({ fileName: 'Tactical Competitive Pro Release.gpc', content: Buffer.from(scrambled) }, '20');
    expect(message.files[0]!.name).toBe('Tactical Competitive Pro Release.gpc');
    expect(message.embeds[0]!.toJSON().description).toContain('Zen Studio');
  });
});

describe('payment hooks', () => {
  const stripe = new Stripe('sk_test_not_used');
  const start = 1_800_000_000;

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

  function paid(id: string, reason: string) {
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
          amount_paid: 700,
          currency: 'usd',
          parent: { type: 'subscription_details', subscription_details: { metadata: { discord_user_id: 'u1' }, subscription: 'sub_1' } },
          lines: { object: 'list', data: [{ id: 'il_1', period: { start, end: start + 30 * 86_400 } }] },
        },
      },
    });
    return { body: Buffer.from(payload), signature: stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) };
  }

  it('welcomes on the first payment only, and keeps the role on renewals', async () => {
    const calls: [string, boolean][] = [];
    usePaymentsForTests({ stripe, store: memoryStore(), grantDays: async () => Date.UTC(2026, 11, 1), onPaid: async (user, first) => void calls.push([user, first]) });
    const first = paid('evt_a', 'subscription_create');
    const renewal = paid('evt_b', 'subscription_cycle');
    await handleStripeWebhook(first.body, first.signature);
    await handleStripeWebhook(renewal.body, renewal.signature);
    expect(calls).toEqual([
      ['u1', true],
      ['u1', false],
    ]);
  });

  it('never adds days twice when the welcome fails', async () => {
    const grants: number[] = [];
    usePaymentsForTests({
      stripe,
      store: memoryStore(),
      grantDays: async (_, days) => {
        grants.push(days);
        return Date.UTC(2026, 11, 1);
      },
      onPaid: async () => {
        throw new Error('Discord is down');
      },
    });
    const { body, signature } = paid('evt_c', 'subscription_create');
    expect(await handleStripeWebhook(body, signature)).toEqual({ status: 200, body: 'ok' });
    expect(await handleStripeWebhook(body, signature)).toEqual({ status: 200, body: 'already handled' });
    expect(grants).toEqual([30]);
  });
});
