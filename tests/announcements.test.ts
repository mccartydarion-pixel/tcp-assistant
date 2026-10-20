import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DiscordAPIError, type MessageCreateOptions } from 'discord.js';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const {
  runAnnouncementQueue,
  checkEmbed,
  checkGif,
  checkQueue,
  embedTextLength,
  buildAnnouncementEmbed,
  buildAnnouncementMessage,
  describeQueue,
  postingOrder,
  MAX_FILE_BYTES,
  EMBED_LIMITS,
} = await import('../src/announcements/announcementQueue.js');
const { MemoryAnnouncementStore, SqliteAnnouncementStore } = await import('../src/announcements/announcementStore.js');
const { ANNOUNCEMENT_QUEUE } = await import('../src/announcements/queue.js');
const { ANNOUNCEMENT_ASSET_DIR } = await import('../src/announcements/announcements.js');
type QueuedAnnouncement = import('../src/announcements/announcementQueue.js').QueuedAnnouncement;
type AnnouncementStore = import('../src/announcements/announcementStore.js').AnnouncementStore;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const assetDir = mkdtempSync(join(tmpdir(), 'tcp-announce-'));
writeFileSync(join(assetDir, 'hype.gif'), 'GIF89a');
writeFileSync(join(assetDir, 'big.gif'), '');
truncateSync(join(assetDir, 'big.gif'), MAX_FILE_BYTES + 1);
writeFileSync(join(assetDir, 'limit.gif'), '');
truncateSync(join(assetDir, 'limit.gif'), MAX_FILE_BYTES);
afterAll(() => rmSync(assetDir, { recursive: true, force: true }));

let sqlite: import('better-sqlite3').Database | null = null;
try {
  const Database = (await import('better-sqlite3')).default;
  sqlite = new Database(':memory:');
} catch {
  sqlite = null; // the native module is not built (npm ci --ignore-scripts); the SQLite test is skipped
}

function entry(id: string, date: string, extra: Partial<QueuedAnnouncement> = {}): QueuedAnnouncement {
  return { id, date, ready: true, title: `Title ${id}`, description: `News about ${id}`, ...extra };
}

function harness(options: { store?: AnnouncementStore; channelId?: string | undefined; channel?: 'none'; failWith?: unknown; now?: number } = {}) {
  const sent: MessageCreateOptions[] = [];
  const logs: { level: string; message: string }[] = [];
  let failWith = options.failWith;
  const store = options.store ?? new MemoryAnnouncementStore();
  const deps = {
    store,
    channelId: 'channelId' in options ? options.channelId : '123456789012345678',
    getChannel: async () =>
      options.channel === 'none'
        ? null
        : {
            async send(message: MessageCreateOptions) {
              if (failWith) {
                const error = failWith;
                failWith = undefined;
                throw error;
              }
              sent.push(message);
              return { id: `m${sent.length}`, url: `https://discord.com/channels/1/2/m${sent.length}` };
            },
          },
    assetDir,
    now: options.now ?? NOW,
    log: {
      info: (message: string) => logs.push({ level: 'info', message }),
      warn: (message: string) => logs.push({ level: 'warn', message }),
      error: (message: string) => logs.push({ level: 'error', message }),
    },
  };
  return { sent, logs, store, deps, titles: () => sent.map((message) => (message.embeds?.[0] as { data: { title?: string } }).data.title) };
}

function apiError(status: number) {
  return new DiscordAPIError({ code: 50013, message: 'Missing Permissions' }, 50013, status, 'POST', 'https://discord.com/api/v10/channels/1/messages', {});
}

describe('posting order', () => {
  it('posts oldest first, one message each, and same-day entries in queue order', async () => {
    const h = harness();
    const queue = [entry('c-third', '2026-10-19'), entry('a-first', '2026-10-10'), entry('b-second', '2026-10-15'), entry('d-fourth', '2026-10-19')];
    const report = await runAnnouncementQueue(queue, h.deps);
    expect(report.posted).toEqual(['a-first', 'b-second', 'c-third', 'd-fourth']);
    expect(h.titles()).toEqual(['Title a-first', 'Title b-second', 'Title c-third', 'Title d-fourth']);
    expect(postingOrder(queue).map((e) => e.id)).toEqual(report.posted);
  });
});

describe('idempotence across restarts', () => {
  it('never posts an entry twice, and posts only the new one after a restart', async () => {
    const store = new MemoryAnnouncementStore();
    const first = harness({ store });
    await runAnnouncementQueue([entry('one', '2026-10-18')], first.deps);
    const second = harness({ store });
    const report = await runAnnouncementQueue([entry('one', '2026-10-18'), entry('two', '2026-10-19')], second.deps);
    expect(first.sent).toHaveLength(1);
    expect(report.posted).toEqual(['two']);
    expect(second.titles()).toEqual(['Title two']);
    const third = harness({ store });
    expect((await runAnnouncementQueue([entry('one', '2026-10-18'), entry('two', '2026-10-19')], third.deps)).posted).toEqual([]);
    expect(third.sent).toHaveLength(0);
    expect((await store.list()).every((row) => row.status === 'posted')).toBe(true);
  });

  it('does not post when another run already claimed the entry', async () => {
    const store = new MemoryAnnouncementStore();
    const a = harness({ store });
    const b = harness({ store });
    const queue = [entry('race', '2026-10-19')];
    await Promise.all([runAnnouncementQueue(queue, a.deps), runAnnouncementQueue(queue, b.deps)]);
    expect(a.sent.length + b.sent.length).toBe(1);
  });

  it.skipIf(!sqlite)('keeps the record in SQLite across store instances', async () => {
    const queue = [entry('sql', '2026-10-19')];
    const before = new SqliteAnnouncementStore(sqlite!);
    await before.init();
    const first = harness({ store: before });
    await runAnnouncementQueue(queue, first.deps);
    const after = new SqliteAnnouncementStore(sqlite!);
    await after.init();
    const second = harness({ store: after });
    await runAnnouncementQueue(queue, second.deps);
    expect(first.sent.length + second.sent.length).toBe(1);
    expect((await after.list())[0]).toMatchObject({ id: 'sql', status: 'posted', messageId: 'm1' });
  });
});

describe('ready flag', () => {
  it('never posts a draft and shows it as a draft', async () => {
    const h = harness();
    const queue = [entry('draft-one', '2026-10-19', { ready: false }), entry('live-one', '2026-10-19')];
    const report = await runAnnouncementQueue(queue, h.deps);
    expect(report.posted).toEqual(['live-one']);
    expect(describeQueue(queue, await h.store.list(), NOW).map((item) => item.status)).toEqual(['draft', 'posted']);
  });

  it('does not check a draft (a draft may still lack its GIF)', async () => {
    const h = harness();
    const report = await runAnnouncementQueue([entry('draft-two', '2026-10-19', { ready: false, gif: 'not-made-yet.gif' })], h.deps);
    expect(report.errors).toEqual([]);
  });
});

describe('14-day skip', () => {
  it('skips an unposted entry more than 14 days old with a log line, and posts one inside 14 days', async () => {
    const h = harness();
    const queue = [entry('old-news', '2026-10-05'), entry('fresh-news', '2026-10-07')];
    const report = await runAnnouncementQueue(queue, h.deps);
    expect(report.expired).toEqual(['old-news']);
    expect(report.posted).toEqual(['fresh-news']);
    expect(h.logs.some((log) => log.level === 'info' && log.message.includes('old-news') && log.message.includes('14 days'))).toBe(true);
    expect(describeQueue(queue, await h.store.list(), NOW).map((item) => item.status)).toEqual(['expired', 'posted']);
  });

  it('still shows an old entry as posted once it was posted', async () => {
    const store = new MemoryAnnouncementStore();
    await runAnnouncementQueue([entry('was-posted', '2026-10-19')], harness({ store }).deps);
    const later = NOW + 30 * DAY;
    expect(describeQueue([entry('was-posted', '2026-10-19')], await store.list(), later)[0]!.status).toBe('posted');
  });
});

describe('GIF', () => {
  it('attaches the GIF and shows it inside the embed', () => {
    const message = buildAnnouncementMessage(entry('with-gif', '2026-10-19', { gif: 'hype.gif' }), assetDir);
    const embed = (message.embeds![0] as ReturnType<typeof buildAnnouncementEmbed>).toJSON();
    expect(embed.image?.url).toBe('attachment://hype.gif');
    expect((message.files as { name: string }[]).map((file) => file.name)).toEqual(['hype.gif']);
  });

  it('posts nothing at all when a due entry\'s GIF is missing', async () => {
    const h = harness();
    const report = await runAnnouncementQueue([entry('fine', '2026-10-18'), entry('no-gif', '2026-10-19', { gif: 'missing.gif' })], h.deps);
    expect(h.sent).toHaveLength(0);
    expect(report.posted).toEqual([]);
    expect(report.errors.some((message) => message.includes('assets/announcements/missing.gif is missing'))).toBe(true);
    expect(await h.store.list()).toEqual([]);
  });

  it('refuses a file over 8 MB and accepts one of exactly 8 MB', async () => {
    expect(checkGif(entry('big', '2026-10-19', { gif: 'big.gif' }), assetDir)[0]).toMatch(/8 MB/);
    expect(checkGif(entry('limit', '2026-10-19', { gif: 'limit.gif' }), assetDir)).toEqual([]);
    const h = harness();
    const report = await runAnnouncementQueue([entry('big', '2026-10-19', { gif: 'big.gif' })], h.deps);
    expect(h.sent).toHaveLength(0);
    expect(h.logs.some((log) => log.level === 'error' && log.message.includes('big.gif'))).toBe(true);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('refuses a path instead of a file name', () => {
    expect(checkGif(entry('sneaky', '2026-10-19', { gif: '../../.env' }), assetDir)).toHaveLength(1);
    expect(checkGif(entry('sneaky', '2026-10-19', { gif: 'sub/hype.gif' }), assetDir)).toHaveLength(1);
  });
});

describe('channel', () => {
  it('posts nothing and logs when ANNOUNCEMENT_CHANNEL_ID is not set', async () => {
    const h = harness({ channelId: undefined });
    const report = await runAnnouncementQueue([entry('needs-channel', '2026-10-19')], h.deps);
    expect(h.sent).toHaveLength(0);
    expect(report.errors[0]).toMatch(/ANNOUNCEMENT_CHANNEL_ID is not set/);
    expect(await h.store.list()).toEqual([]);
  });

  it('posts nothing and logs when the channel cannot be found', async () => {
    const h = harness({ channel: 'none' });
    const report = await runAnnouncementQueue([entry('needs-channel', '2026-10-19')], h.deps);
    expect(report.errors[0]).toMatch(/not a text channel/);
    expect(await h.store.list()).toEqual([]);
  });
});

describe("'sending' recovery", () => {
  it('reports a row left as sending and never retries it by itself', async () => {
    const store = new MemoryAnnouncementStore();
    await store.claim('crashed', NOW - DAY);
    const h = harness({ store });
    const report = await runAnnouncementQueue([entry('crashed', '2026-10-18'), entry('next', '2026-10-19')], h.deps);
    expect(report.unsure).toEqual(['crashed']);
    expect(report.posted).toEqual(['next']);
    expect(h.logs.some((log) => log.level === 'warn' && log.message.includes('/tcp announcements retry:crashed'))).toBe(true);
    expect(describeQueue([entry('crashed', '2026-10-18')], await store.list(), NOW)[0]!.status).toBe('sending');
  });

  it('keeps a send that may have gone through as sending, and stops so the order is kept', async () => {
    const h = harness({ failWith: new Error('socket hang up') });
    const report = await runAnnouncementQueue([entry('first', '2026-10-18'), entry('second', '2026-10-19')], h.deps);
    expect(report.posted).toEqual([]);
    expect(report.unsure).toEqual(['first']);
    expect((await h.store.list()).map((row) => [row.id, row.status])).toEqual([['first', 'sending']]);
    const again = harness({ store: h.store });
    const next = await runAnnouncementQueue([entry('first', '2026-10-18'), entry('second', '2026-10-19')], again.deps);
    expect(next.posted).toEqual(['second']);
  });

  it('releases an entry Discord refused, so the next start posts it', async () => {
    const h = harness({ failWith: apiError(403) });
    const report = await runAnnouncementQueue([entry('refused', '2026-10-19')], h.deps);
    expect(report.posted).toEqual([]);
    expect(report.unsure).toEqual([]);
    expect(await h.store.list()).toEqual([]);
    const again = harness({ store: h.store });
    expect((await runAnnouncementQueue([entry('refused', '2026-10-19')], again.deps)).posted).toEqual(['refused']);
  });

  it('lets the owner release an unsure row so it posts', async () => {
    const store = new MemoryAnnouncementStore();
    await store.claim('stuck', NOW);
    expect(await store.release('stuck')).toBe(true);
    expect(await store.release('stuck')).toBe(false);
    await store.claim('done', NOW);
    await store.markPosted('done', 'm1', NOW);
    expect(await store.release('done')).toBe(false);
    const h = harness({ store });
    expect((await runAnnouncementQueue([entry('stuck', '2026-10-19')], h.deps)).posted).toEqual(['stuck']);
  });
});

describe('embed limits', () => {
  it('accepts an entry at every limit and builds an embed within them', () => {
    const fields = Array.from({ length: 3 }, (_, index) => ({ name: 'n'.repeat(256), value: `${index}`.repeat(1024) }));
    // 256 + 1872 + 3 x 1280 + the 32-character footer = exactly 6000
    const big = entry('at-limit', '2026-10-19', { title: 't'.repeat(256), description: 'd'.repeat(1872), fields });
    expect(embedTextLength(big)).toBe(EMBED_LIMITS.total);
    expect(checkEmbed(big)).toEqual([]);
    expect(checkEmbed({ ...big, description: 'd'.repeat(1873) }).join(' ')).toMatch(/6001 characters/);
    const json = buildAnnouncementEmbed(big).toJSON();
    expect(json.title).toHaveLength(256);
    expect(json.fields).toHaveLength(3);
    expect(json.footer?.text).toBe('T.C.P | Tactical Competitive Pro');
  });

  it('refuses text over Discord\'s limits instead of cutting it', () => {
    expect(checkEmbed(entry('t', '2026-10-19', { title: 'x'.repeat(EMBED_LIMITS.title + 1) }))[0]).toMatch(/title/);
    expect(checkEmbed(entry('d', '2026-10-19', { description: 'x'.repeat(EMBED_LIMITS.description + 1) }))[0]).toMatch(/description/);
    expect(checkEmbed(entry('f', '2026-10-19', { fields: Array.from({ length: 26 }, () => ({ name: 'a', value: 'b' })) }))[0]).toMatch(/26 fields/);
    expect(checkEmbed(entry('v', '2026-10-19', { fields: [{ name: 'a', value: 'x'.repeat(1025) }] }))[0]).toMatch(/value/);
    const total = entry('total', '2026-10-19', { description: 'x'.repeat(4000), fields: [{ name: 'a', value: 'x'.repeat(1024) }, { name: 'b', value: 'x'.repeat(1024) }] });
    expect(checkEmbed(total).join(' ')).toMatch(/6000/);
    expect(checkEmbed(entry('e', '2026-10-19', { title: ' ' }))[0]).toMatch(/title is empty/);
  });

  it('posts nothing when a due entry is over a limit', async () => {
    const h = harness();
    const report = await runAnnouncementQueue([entry('long', '2026-10-19', { description: 'x'.repeat(5000) })], h.deps);
    expect(h.sent).toHaveLength(0);
    expect(report.errors[0]).toMatch(/description/);
  });

  it('pings @everyone, a role or nobody, and allows only that mention', () => {
    const everyone = buildAnnouncementMessage(entry('e', '2026-10-19', { ping: '@everyone' }), assetDir);
    expect(everyone.content).toBe('@everyone');
    expect(everyone.allowedMentions).toEqual({ parse: ['everyone'] });
    const role = buildAnnouncementMessage(entry('r', '2026-10-19', { ping: '123456789012345678' }), assetDir);
    expect(role.content).toBe('<@&123456789012345678>');
    expect(role.allowedMentions).toEqual({ parse: [], roles: ['123456789012345678'] });
    const none = buildAnnouncementMessage(entry('n', '2026-10-19', { ping: 'none' }), assetDir);
    expect(none.content).toBeUndefined();
    expect(none.allowedMentions).toEqual({ parse: [] });
    expect(checkEmbed(entry('bad-ping', '2026-10-19', { ping: 'everyone' }))[0]).toMatch(/ping/);
  });
});

describe('queue checks', () => {
  it('refuses duplicate ids, bad ids and bad dates, and then posts nothing', async () => {
    expect(checkQueue([entry('same', '2026-10-19'), entry('same', '2026-10-19')])).toHaveLength(1);
    expect(checkQueue([entry('Bad Id', '2026-10-19')])).toHaveLength(1);
    expect(checkQueue([entry('bad-date', '2026-02-30')])).toHaveLength(1);
    expect(checkQueue([entry('bad-date', '19/10/2026')])).toHaveLength(1);
    const h = harness();
    await runAnnouncementQueue([entry('same', '2026-10-19'), entry('same', '2026-10-19')], h.deps);
    expect(h.sent).toHaveLength(0);
  });

  it('the real queue is valid, and every ready entry fits and has its GIF in assets/announcements', () => {
    expect(checkQueue(ANNOUNCEMENT_QUEUE)).toEqual([]);
    for (const queued of ANNOUNCEMENT_QUEUE) expect(checkEmbed(queued)).toEqual([]);
    for (const queued of ANNOUNCEMENT_QUEUE.filter((item) => item.ready)) expect(checkGif(queued, ANNOUNCEMENT_ASSET_DIR)).toEqual([]);
  });

  it('ships with the example entry as a draft only', () => {
    expect(ANNOUNCEMENT_QUEUE.find((item) => item.id === '0000-example')?.ready).toBe(false);
  });
});
