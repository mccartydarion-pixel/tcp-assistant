import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Where member reviews are kept: one per member, a new review replaces the old one. Postgres when
 * DATABASE_URL points at one, so reviews outlive a redeploy; otherwise the local SQLite file.
 */
export interface ReviewStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  get(discordUserId: string): Promise<ReviewRecord | null>;
  /** Insert, or replace this member's review (keeping when they first reviewed). */
  save(review: ReviewRecord): Promise<void>;
  remove(discordUserId: string): Promise<void>;
  /** The star count of every review, for the average. */
  listStars(): Promise<number[]>;
}

export interface ReviewRecord {
  discordUserId: string;
  stars: number;
  headline: string;
  text: string;
  /** The posted card in the review channel, so a new review can take its place. */
  messageId: string | null;
  createdAt: number;
  updatedAt: number;
}

class PostgresReviewStore implements ReviewStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        discord_user_id TEXT PRIMARY KEY,
        stars INTEGER NOT NULL,
        headline TEXT NOT NULL,
        body TEXT NOT NULL,
        message_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
  }

  async get(discordUserId: string): Promise<ReviewRecord | null> {
    const result = await this.pool.query(
      'SELECT discord_user_id, stars, headline, body, message_id, created_at, updated_at FROM reviews WHERE discord_user_id = $1',
      [discordUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      discordUserId: row.discord_user_id,
      stars: Number(row.stars),
      headline: row.headline,
      text: row.body,
      messageId: row.message_id,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async save(review: ReviewRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO reviews (discord_user_id, stars, headline, body, message_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (discord_user_id) DO UPDATE SET stars = EXCLUDED.stars, headline = EXCLUDED.headline,
         body = EXCLUDED.body, message_id = EXCLUDED.message_id, updated_at = EXCLUDED.updated_at`,
      [review.discordUserId, review.stars, review.headline, review.text, review.messageId, review.createdAt, review.updatedAt],
    );
  }

  async remove(discordUserId: string): Promise<void> {
    await this.pool.query('DELETE FROM reviews WHERE discord_user_id = $1', [discordUserId]);
  }

  async listStars(): Promise<number[]> {
    const result = await this.pool.query('SELECT stars FROM reviews');
    return result.rows.map((row) => Number(row.stars));
  }
}

class SqliteReviewStore implements ReviewStore {
  readonly kind = 'sqlite' as const;
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        discordUserId TEXT PRIMARY KEY,
        stars INTEGER NOT NULL,
        headline TEXT NOT NULL,
        text TEXT NOT NULL,
        messageId TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
  }

  async get(discordUserId: string): Promise<ReviewRecord | null> {
    const row = this.db
      .prepare('SELECT discordUserId, stars, headline, text, messageId, createdAt, updatedAt FROM reviews WHERE discordUserId = ?')
      .get(discordUserId) as ReviewRecord | undefined;
    return row ?? null;
  }

  async save(review: ReviewRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO reviews (discordUserId, stars, headline, text, messageId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (discordUserId) DO UPDATE SET stars = excluded.stars, headline = excluded.headline,
           text = excluded.text, messageId = excluded.messageId, updatedAt = excluded.updatedAt`,
      )
      .run(review.discordUserId, review.stars, review.headline, review.text, review.messageId, review.createdAt, review.updatedAt);
  }

  async remove(discordUserId: string): Promise<void> {
    this.db.prepare('DELETE FROM reviews WHERE discordUserId = ?').run(discordUserId);
  }

  async listStars(): Promise<number[]> {
    return (this.db.prepare('SELECT stars FROM reviews').all() as { stars: number }[]).map((row) => row.stars);
  }
}

export function createReviewStore(): ReviewStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresReviewStore(env.DATABASE_URL);
  return new SqliteReviewStore();
}
