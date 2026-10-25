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

  it('refuses the readable release, which carries the real license key', () => {
    const readable = `${scrambled}\ndefine LICENSE_KEY_A1 = 12345;\n`;
    const result = checkRelease('Tactical Competitive Pro Release (readable).gpc', readable);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('license key');
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

describe('fingerprints', () => {
  const script = ['define z100 = 0;', 'define z101   = 1;', 'define z102 = 25;', 'const string z103 = "T.C.P";', 'main {', 'set_val(PS4_R2, 100);', '}', ''].join('\r\n');

  it('adds exactly one define line, keeps the line endings, and gives the same member the same copy', async () => {
    const { stampCopy, definesIn } = await import('../src/premium/fingerprint.js');
    const mark = { name: 'z5d1', value: 4821 };
    const copy = stampCopy(script, mark);
    const added = copy.split('\r\n').filter((line) => !script.split('\r\n').includes(line));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^define z5d1 +=  ?4821;$/);
    expect(copy.split('\r\n')).toHaveLength(script.split('\r\n').length + 1);
    expect(copy).not.toMatch(/[^\r]\n/);
    expect(stampCopy(script, mark)).toBe(copy);
    expect(definesIn(copy)).toContainEqual(mark);
    // It sits among the defines, never inside the code.
    expect(copy.indexOf('define z5d1')).toBeLessThan(copy.indexOf('const string'));
  });

  it("picks a name just above the script's own, and never a pair another member has", async () => {
    const { newMark, markFits } = await import('../src/premium/fingerprint.js');
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const offered: { name: string; value: number }[] = [];
    // Pretend the first pair offered already belongs to another member.
    const mark = newMark(script, (candidate) => offered.push(candidate) === 1, random);
    expect(mark).toEqual(offered[1]);
    expect(mark).not.toEqual(offered[0]);
    // The script's names end at z103, so a new one is z104 or a little above.
    expect(parseInt(mark.name.slice(1), 16)).toBeGreaterThan(0x103);
    expect(parseInt(mark.name.slice(1), 16)).toBeLessThanOrEqual(0x103 + 0x300);
    expect(markFits(script, mark)).toBe(true);
    expect(mark.value).toBeGreaterThanOrEqual(100);
    expect(mark.value).toBeLessThanOrEqual(9999);
    expect(markFits(script, { name: 'z101', value: 7 })).toBe(false);
  });

  it("traces a copy to its member, even after it was re-saved with other spacing", async () => {
    const { stampCopy } = await import('../src/premium/fingerprint.js');
    const { findOwners } = await import('../src/premium/premium.js');
    const marks = [
      { discordUserId: 'ana', fileSha: 'v1', name: 'z5d1', value: 4821, createdAt: 1 },
      { discordUserId: 'ben', fileSha: 'v1', name: 'z7a0', value: 1234, createdAt: 2 },
    ];
    const anasCopy = stampCopy(script, marks[0]!);
    expect(findOwners(anasCopy, marks).map((m) => m.discordUserId)).toEqual(['ana']);
    const resaved = anasCopy.replace(/\r\n/g, '\n').replace(/ +=/g, ' =').replace(/^define/gm, '    define');
    expect(findOwners(resaved, marks).map((m) => m.discordUserId)).toEqual(['ana']);
    expect(findOwners(script, marks)).toEqual([]);
    // Same name, different value: not Ben's.
    expect(findOwners(stampCopy(script, { name: 'z7a0', value: 1235 }), marks)).toEqual([]);
  });

  it('still passes the release check once stamped', async () => {
    const { stampCopy } = await import('../src/premium/fingerprint.js');
    expect(checkRelease('Tactical Competitive Pro Release.gpc', stampCopy(scrambled, { name: 'z5d1', value: 4821 }))).toEqual({ ok: true });
  });
});

describe('the assistant knows codes are for Elite Supporters', () => {
  it('promises no free trial anywhere in its documentation', async () => {
    const { readFileSync } = await import('node:fs');
    for (const path of ['knowledge/T.C.P_DOCUMENTATION.md', 'T.C.P_DOCUMENTATION.md']) {
      const doc = readFileSync(path, 'utf8');
      expect(doc).not.toMatch(/free 14-day|trial automatically|up to three new numbers/i);
      expect(doc).toContain('There is no free trial. Unlock codes are only for **Elite Supporters**.');
      expect(doc).toContain('**"Elite Supporters only"**');
    }
  });
});
