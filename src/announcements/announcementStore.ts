import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Which queued announcements the bot has posted. A row is written as 'sending' before the message goes
 * out and turned into 'posted' once Discord confirms it, so a crash in between leaves a 'sending' row that
 * is reported to the owner and never retried by itself: no announcement is posted twice, and none is lost
 * without a log line. Postgres when DATABASE_URL points at one, so the record outlives a redeploy;
 * otherwise the local SQLite file.
 */
export type AnnouncementStatus = 'sending' | 'posted';

export interface AnnouncementRow {
  id: string;
  status: AnnouncementStatus;
  messageId: string | null;
  updatedAt: number;
}

export interface AnnouncementStore {
  readonly kind: 'postgres' | 'sqlite' | 'memory';
  init(): Promise<void>;
  list(): Promise<AnnouncementRow[]>;
  /** Writes a 'sending' row. False when the id already has a row (posted, or claimed by another run). */
  claim(id: string, at: number): Promise<boolean>;
  markPosted(id: string, messageId: string, at: number): Promise<void>;
  /** Removes a 'sending' row (Discord refused the message, or the owner asked to retry). False if there was none. */
  release(id: string): Promise<boolean>;
}

class PostgresAnnouncementStore implements AnnouncementStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS queued_announcements (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        message_id TEXT,
        updated_at BIGINT NOT NULL
      );
    `);
  }

  async list(): Promise<AnnouncementRow[]> {
    const result = await this.pool.query('SELECT id, status, message_id, updated_at FROM queued_announcements');
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status === 'posted' ? 'posted' : 'sending',
      messageId: row.message_id,
      updatedAt: Number(row.updated_at),
    }));
  }

  async claim(id: string, at: number): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO queued_announcements (id, status, updated_at) VALUES ($1, 'sending', $2) ON CONFLICT (id) DO NOTHING`,
      [id, at],
    );
    return result.rowCount === 1;
  }

  async markPosted(id: string, messageId: string, at: number): Promise<void> {
    await this.pool.query(`UPDATE queued_announcements SET status = 'posted', message_id = $2, updated_at = $3 WHERE id = $1`, [id, messageId, at]);
  }

  async release(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM queued_announcements WHERE id = $1 AND status = 'sending'`, [id]);
    return result.rowCount === 1;
  }
}

type SqliteDatabase = import('better-sqlite3').Database;

export class SqliteAnnouncementStore implements AnnouncementStore {
  readonly kind = 'sqlite' as const;
  private db!: SqliteDatabase;

  /** `db` is for tests; the bot uses its own SQLite file. */
  constructor(private readonly given?: SqliteDatabase) {}

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = this.given ?? (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queuedAnnouncements (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        messageId TEXT,
        updatedAt INTEGER NOT NULL
      );
    `);
  }

  async list(): Promise<AnnouncementRow[]> {
    const rows = this.db.prepare('SELECT id, status, messageId, updatedAt FROM queuedAnnouncements').all() as AnnouncementRow[];
    return rows.map((row) => ({ ...row, status: row.status === 'posted' ? 'posted' : 'sending' }));
  }

  async claim(id: string, at: number): Promise<boolean> {
    const result = this.db
      .prepare(`INSERT INTO queuedAnnouncements (id, status, updatedAt) VALUES (?, 'sending', ?) ON CONFLICT (id) DO NOTHING`)
      .run(id, at);
    return result.changes === 1;
  }

  async markPosted(id: string, messageId: string, at: number): Promise<void> {
    this.db.prepare(`UPDATE queuedAnnouncements SET status = 'posted', messageId = ?, updatedAt = ? WHERE id = ?`).run(messageId, at, id);
  }

  async release(id: string): Promise<boolean> {
    return this.db.prepare(`DELETE FROM queuedAnnouncements WHERE id = ? AND status = 'sending'`).run(id).changes === 1;
  }
}

/** Keeps rows in memory only (tests). */
export class MemoryAnnouncementStore implements AnnouncementStore {
  readonly kind = 'memory' as const;
  readonly rows = new Map<string, AnnouncementRow>();

  async init(): Promise<void> {}

  async list(): Promise<AnnouncementRow[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async claim(id: string, at: number): Promise<boolean> {
    if (this.rows.has(id)) return false;
    this.rows.set(id, { id, status: 'sending', messageId: null, updatedAt: at });
    return true;
  }

  async markPosted(id: string, messageId: string, at: number): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, status: 'posted', messageId, updatedAt: at });
  }

  async release(id: string): Promise<boolean> {
    if (this.rows.get(id)?.status !== 'sending') return false;
    return this.rows.delete(id);
  }
}

export function createAnnouncementStore(): AnnouncementStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresAnnouncementStore(env.DATABASE_URL);
  return new SqliteAnnouncementStore();
}
