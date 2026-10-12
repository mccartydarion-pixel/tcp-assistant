import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Where subscriptions and issued codes are kept. Postgres when DATABASE_URL points at one, so the
 * records outlive a redeploy; otherwise the local SQLite file, which is fine for development.
 */
export interface LicenseStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  getExpiry(discordUserId: string): Promise<number | null>;
  setExpiry(discordUserId: string, expiresAt: number): Promise<void>;
  /** True when this member has already been given their one free trial. */
  hasHadTrial(discordUserId: string): Promise<boolean>;
  /** Set the subscription end and mark the free trial as used, in one step. */
  grantTrial(discordUserId: string, expiresAt: number): Promise<void>;
  /** True when this member has already been given a code for this number. */
  hasCode(discordUserId: string, challenge: number): Promise<boolean>;
  /** How many different numbers this member has been given a code for since the given time. */
  countCodesSince(discordUserId: string, since: number): Promise<number>;
  recordCode(discordUserId: string, challenge: number, tier: number): Promise<void>;
  /** Every member with a subscription record, soonest expiry first. */
  listSubscriptions(): Promise<SubscriptionRecord[]>;
  /** The most recently issued codes, newest first. */
  listRecentCodes(limit: number): Promise<CodeRecord[]>;
}

export interface SubscriptionRecord {
  discordUserId: string;
  expiresAt: number;
  trialGrantedAt: number | null;
}

export interface CodeRecord {
  discordUserId: string;
  challenge: number;
  tier: number;
  createdAt: number;
}

class PostgresLicenseStore implements LicenseStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 3 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS license_subscriptions (
        discord_user_id TEXT PRIMARY KEY,
        expires_at BIGINT NOT NULL,
        trial_granted_at BIGINT
      );
      CREATE TABLE IF NOT EXISTS license_codes (
        id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        challenge INTEGER NOT NULL,
        tier INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);
    // Add the trial column to a table created by an earlier version.
    await this.pool.query('ALTER TABLE license_subscriptions ADD COLUMN IF NOT EXISTS trial_granted_at BIGINT');
  }

  async getExpiry(discordUserId: string): Promise<number | null> {
    const result = await this.pool.query('SELECT expires_at FROM license_subscriptions WHERE discord_user_id = $1', [discordUserId]);
    return result.rows.length > 0 ? Number(result.rows[0].expires_at) : null;
  }

  async setExpiry(discordUserId: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO license_subscriptions (discord_user_id, expires_at) VALUES ($1, $2)
       ON CONFLICT (discord_user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [discordUserId, expiresAt],
    );
  }

  async hasHadTrial(discordUserId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT trial_granted_at FROM license_subscriptions WHERE discord_user_id = $1', [discordUserId]);
    return result.rows.length > 0 && result.rows[0].trial_granted_at !== null;
  }

  async grantTrial(discordUserId: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO license_subscriptions (discord_user_id, expires_at, trial_granted_at) VALUES ($1, $2, $3)
       ON CONFLICT (discord_user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at,
         trial_granted_at = COALESCE(license_subscriptions.trial_granted_at, EXCLUDED.trial_granted_at)`,
      [discordUserId, expiresAt, Date.now()],
    );
  }

  async hasCode(discordUserId: string, challenge: number): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM license_codes WHERE discord_user_id = $1 AND challenge = $2 LIMIT 1', [
      discordUserId,
      challenge,
    ]);
    return result.rows.length > 0;
  }

  async countCodesSince(discordUserId: string, since: number): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) AS total FROM license_codes WHERE discord_user_id = $1 AND created_at >= $2', [
      discordUserId,
      since,
    ]);
    return Number(result.rows[0].total);
  }

  async recordCode(discordUserId: string, challenge: number, tier: number): Promise<void> {
    await this.pool.query('INSERT INTO license_codes (id, discord_user_id, challenge, tier, created_at) VALUES ($1, $2, $3, $4, $5)', [
      randomUUID(),
      discordUserId,
      challenge,
      tier,
      Date.now(),
    ]);
  }

  async listSubscriptions(): Promise<SubscriptionRecord[]> {
    const result = await this.pool.query(
      'SELECT discord_user_id, expires_at, trial_granted_at FROM license_subscriptions ORDER BY expires_at ASC',
    );
    return result.rows.map((row) => ({
      discordUserId: row.discord_user_id,
      expiresAt: Number(row.expires_at),
      trialGrantedAt: row.trial_granted_at === null ? null : Number(row.trial_granted_at),
    }));
  }

  async listRecentCodes(limit: number): Promise<CodeRecord[]> {
    const result = await this.pool.query(
      'SELECT discord_user_id, challenge, tier, created_at FROM license_codes ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map((row) => ({
      discordUserId: row.discord_user_id,
      challenge: Number(row.challenge),
      tier: Number(row.tier),
      createdAt: Number(row.created_at),
    }));
  }
}

class SqliteLicenseStore implements LicenseStore {
  readonly kind = 'sqlite' as const;
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS licenseSubscriptions (
        discordUserId TEXT PRIMARY KEY,
        expiresAt INTEGER NOT NULL,
        trialGrantedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS licenseCodes (
        id TEXT PRIMARY KEY,
        discordUserId TEXT NOT NULL,
        challenge INTEGER NOT NULL,
        tier INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);
    // Add the trial column to a table created by an earlier version (throws if it is already there).
    try {
      this.db.exec('ALTER TABLE licenseSubscriptions ADD COLUMN trialGrantedAt INTEGER');
    } catch {
      // column already present
    }
  }

  async getExpiry(discordUserId: string): Promise<number | null> {
    const row = this.db.prepare('SELECT expiresAt FROM licenseSubscriptions WHERE discordUserId = ?').get(discordUserId) as
      | { expiresAt: number }
      | undefined;
    return row ? row.expiresAt : null;
  }

  async setExpiry(discordUserId: string, expiresAt: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO licenseSubscriptions (discordUserId, expiresAt) VALUES (?, ?)
         ON CONFLICT (discordUserId) DO UPDATE SET expiresAt = excluded.expiresAt`,
      )
      .run(discordUserId, expiresAt);
  }

  async hasHadTrial(discordUserId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT trialGrantedAt FROM licenseSubscriptions WHERE discordUserId = ?').get(discordUserId) as
      | { trialGrantedAt: number | null }
      | undefined;
    return row !== undefined && row.trialGrantedAt !== null;
  }

  async grantTrial(discordUserId: string, expiresAt: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO licenseSubscriptions (discordUserId, expiresAt, trialGrantedAt) VALUES (?, ?, ?)
         ON CONFLICT (discordUserId) DO UPDATE SET expiresAt = excluded.expiresAt,
           trialGrantedAt = COALESCE(licenseSubscriptions.trialGrantedAt, excluded.trialGrantedAt)`,
      )
      .run(discordUserId, expiresAt, Date.now());
  }

  async hasCode(discordUserId: string, challenge: number): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM licenseCodes WHERE discordUserId = ? AND challenge = ?').get(discordUserId, challenge) !== undefined;
  }

  async countCodesSince(discordUserId: string, since: number): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM licenseCodes WHERE discordUserId = ? AND createdAt >= ?').get(discordUserId, since) as {
      total: number;
    };
    return row.total;
  }

  async recordCode(discordUserId: string, challenge: number, tier: number): Promise<void> {
    this.db
      .prepare('INSERT INTO licenseCodes (id, discordUserId, challenge, tier, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), discordUserId, challenge, tier, Date.now());
  }

  async listSubscriptions(): Promise<SubscriptionRecord[]> {
    return this.db
      .prepare('SELECT discordUserId, expiresAt, trialGrantedAt FROM licenseSubscriptions ORDER BY expiresAt ASC')
      .all() as SubscriptionRecord[];
  }

  async listRecentCodes(limit: number): Promise<CodeRecord[]> {
    return this.db
      .prepare('SELECT discordUserId, challenge, tier, createdAt FROM licenseCodes ORDER BY createdAt DESC LIMIT ?')
      .all(limit) as CodeRecord[];
  }
}

export function createLicenseStore(): LicenseStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresLicenseStore(env.DATABASE_URL);
  return new SqliteLicenseStore();
}
