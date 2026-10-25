import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MessageType } from 'discord.js';
import { ANNOUNCEMENT_QUEUE } from '../src/announcements/queue.js';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { BOOST_REWARD_DAYS, BOOST_REWARD_EVERY_MS, boostRewardText, isBoostMessage, startedBoosting } = await import('../src/license/boostRewards.js');
const { createLicenseStore } = await import('../src/license/licenseStore.js');

const DAY = 24 * 60 * 60 * 1000;

type MemoryDb = { exec(sql: string): unknown; prepare(sql: string): { get(...values: unknown[]): unknown } };

/** An in-memory SQLite database: better-sqlite3 where its native module is built, else Node's own (same API). */
async function memoryDb(): Promise<MemoryDb> {
  try {
    return new Database(':memory:');
  } catch {
    // Through Node's require: the test runner's bundler does not know this newer built-in module.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => MemoryDb };
    return new DatabaseSync(':memory:');
  }
}

/** The SQLite licence store on an in-memory database, with only the boost table (init would open the real file). */
async function memoryStore() {
  const store = createLicenseStore();
  const db = await memoryDb();
  db.exec('CREATE TABLE licenseBoostRewards (discordUserId TEXT PRIMARY KEY, lastRewardAt INTEGER NOT NULL, rewards INTEGER NOT NULL)');
  (store as unknown as { db: MemoryDb }).db = db;
  return { store, db };
}

describe('server boost reward', () => {
  it('is a month, once per 30 days', () => {
    expect(BOOST_REWARD_DAYS).toBe(30);
    expect(BOOST_REWARD_EVERY_MS).toBe(30 * DAY);
  });

  it('sees the start of a boost, and only the start', () => {
    const since = new Date('2026-10-25T10:00:00Z');
    expect(startedBoosting(null, since, true)).toBe(true);
    expect(startedBoosting(since, since, true)).toBe(false);
    expect(startedBoosting(since, null, true)).toBe(false);
    expect(startedBoosting(null, null, true)).toBe(false);
    // No earlier state from Discord: the store decides whether a month is due.
    expect(startedBoosting(undefined, since, false)).toBe(true);
  });

  it("knows Discord's boost messages", () => {
    expect(isBoostMessage(MessageType.GuildBoost)).toBe(true);
    expect(isBoostMessage(MessageType.GuildBoostTier1)).toBe(true);
    expect(isBoostMessage(MessageType.GuildBoostTier3)).toBe(true);
    expect(isBoostMessage(MessageType.Default)).toBe(false);
    expect(isBoostMessage(MessageType.UserJoin)).toBe(false);
  });

  it('tells the booster what they got and what to do next', () => {
    const text = boostRewardText(Date.UTC(2026, 10, 24), 'https://discord.com/channels/g/c');
    expect(text.description).toContain('30 days of T.C.P Premium');
    expect(text.description).toContain('<t:1795478400:D>');
    expect(text.description).toContain('every 30 days you stay boosted');
    expect(text.description).toContain('**Generate**');
    expect(text.description).toContain('https://discord.com/channels/g/c');
    expect(text.description).not.toMatch(/licence/i);
  });
});

describe('boost reward records', () => {
  it('gives the first one, then nothing until 30 days have passed', async () => {
    const { store, db } = await memoryStore();
    const t0 = Date.UTC(2026, 9, 25);
    expect(await store.claimBoostReward('u1', t0, BOOST_REWARD_EVERY_MS)).toBe(true);
    // A second event for the same boost, and boosting again a week later, add nothing.
    expect(await store.claimBoostReward('u1', t0, BOOST_REWARD_EVERY_MS)).toBe(false);
    expect(await store.claimBoostReward('u1', t0 + 7 * DAY, BOOST_REWARD_EVERY_MS)).toBe(false);
    expect(await store.claimBoostReward('u1', t0 + 30 * DAY - 1, BOOST_REWARD_EVERY_MS)).toBe(false);
    // 30 days on, still boosting: the next month.
    expect(await store.claimBoostReward('u1', t0 + 30 * DAY, BOOST_REWARD_EVERY_MS)).toBe(true);
    expect(await store.claimBoostReward('u1', t0 + 45 * DAY, BOOST_REWARD_EVERY_MS)).toBe(false);
    expect(await store.claimBoostReward('u1', t0 + 60 * DAY, BOOST_REWARD_EVERY_MS)).toBe(true);
    const row = db.prepare('SELECT lastRewardAt, rewards FROM licenseBoostRewards WHERE discordUserId = ?').get('u1');
    expect({ ...(row as object) }).toEqual({ lastRewardAt: t0 + 60 * DAY, rewards: 3 });
  });

  it('keeps each member separate', async () => {
    const { store } = await memoryStore();
    const t0 = Date.UTC(2026, 9, 25);
    expect(await store.claimBoostReward('u1', t0, BOOST_REWARD_EVERY_MS)).toBe(true);
    expect(await store.claimBoostReward('u2', t0 + DAY, BOOST_REWARD_EVERY_MS)).toBe(true);
    expect(await store.claimBoostReward('u2', t0 + 2 * DAY, BOOST_REWARD_EVERY_MS)).toBe(false);
  });
});

describe('boost announcement', () => {
  const entry = ANNOUNCEMENT_QUEUE.find((item) => item.id === '2026-10-boost-premium');

  it('is queued, ready, with its GIF', () => {
    expect(entry).toBeDefined();
    expect(entry!.ready).toBe(true);
    expect(entry!.gif).toBe('tcp-boost-premium.gif');
  });

  it('promises only what the bot does', () => {
    const text = [entry!.description, ...(entry!.fields ?? []).map((field) => field.value)].join('\n');
    expect(text).toContain('1 month of T.C.P Premium');
    expect(text).toContain('added to your subscription');
    expect(text).toContain('Every 30 days you stay boosted');
    expect(text).not.toMatch(/licence/i);
  });
});
