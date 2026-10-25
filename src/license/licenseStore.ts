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
  /** This member's codes since the given time, oldest first: one per number. */
  listCodesSince(discordUserId: string, since: number): Promise<CodeRecord[]>;
  /** Every member with a subscription record, soonest expiry first. */
  listSubscriptions(): Promise<SubscriptionRecord[]>;
  /** The most recently issued codes, newest first. */
  listRecentCodes(limit: number): Promise<CodeRecord[]>;
  /** This member's subscription record, if they have one. */
  getSubscription(discordUserId: string): Promise<SubscriptionRecord | null>;
  /** This member's most recent code, if any. */
  latestCodeFor(discordUserId: string): Promise<CodeRecord | null>;
  /** When the owner last reset this member's code usage (0: never). Codes before it no longer count toward the
   *  daily limit or the code-sharing alert; they stay in the records (Recent codes) and keep working. */
  codeUsageResetAt(discordUserId: string): Promise<number>;
  resetCodeUsage(discordUserId: string, at: number): Promise<void>;
  /** True when this reminder was already sent for this subscription end date. */
  hasReminder(discordUserId: string, kind: string, expiresAt: number): Promise<boolean>;
  recordReminder(discordUserId: string, kind: string, expiresAt: number): Promise<void>;
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
    // One row per reminder sent, keyed to the end date it was about, so adding days starts a fresh set.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS license_reminders (
        discord_user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        sent_at BIGINT NOT NULL,
        PRIMARY KEY (discord_user_id, kind, expires_at)
      );
    `);
    // One row per member whose code usage the owner reset: the time of the last reset.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS license_code_resets (
        discord_user_id TEXT PRIMARY KEY,
        reset_at BIGINT NOT NULL
      );
    `);
  }

  async codeUsageResetAt(discordUserId: string): Promise<number> {
    const result = await this.pool.query('SELECT reset_at FROM license_code_resets WHERE discord_user_id = $1', [discordUserId]);
    return result.rows.length > 0 ? Number(result.rows[0].reset_at) : 0;
  }

  async resetCodeUsage(discordUserId: string, at: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO license_code_resets (discord_user_id, reset_at) VALUES ($1, $2)
       ON CONFLICT (discord_user_id) DO UPDATE SET reset_at = excluded.reset_at`,
      [discordUserId, at],
    );
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

  async listCodesSince(discordUserId: string, since: number): Promise<CodeRecord[]> {
    const result = await this.pool.query(
      'SELECT discord_user_id, challenge, tier, created_at FROM license_codes WHERE discord_user_id = $1 AND created_at >= $2 ORDER BY created_at ASC',
      [discordUserId, since],
    );
    return result.rows.map((row) => ({
      discordUserId: row.discord_user_id,
      challenge: Number(row.challenge),
      tier: Number(row.tier),
      createdAt: Number(row.created_at),
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

  async getSubscription(discordUserId: string): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query(
      'SELECT discord_user_id, expires_at, trial_granted_at FROM license_subscriptions WHERE discord_user_id = $1',
      [discordUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      discordUserId: row.discord_user_id,
      expiresAt: Number(row.expires_at),
      trialGrantedAt: row.trial_granted_at === null ? null : Number(row.trial_granted_at),
    };
  }

  async latestCodeFor(discordUserId: string): Promise<CodeRecord | null> {
    const result = await this.pool.query(
      'SELECT discord_user_id, challenge, tier, created_at FROM license_codes WHERE discord_user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [discordUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { discordUserId: row.discord_user_id, challenge: Number(row.challenge), tier: Number(row.tier), createdAt: Number(row.created_at) };
  }

  async hasReminder(discordUserId: string, kind: string, expiresAt: number): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM license_reminders WHERE discord_user_id = $1 AND kind = $2 AND expires_at = $3 LIMIT 1',
      [discordUserId, kind, expiresAt],
    );
    return result.rows.length > 0;
  }

  async recordReminder(discordUserId: string, kind: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO license_reminders (discord_user_id, kind, expires_at, sent_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [discordUserId, kind, expiresAt, Date.now()],
    );
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS licenseReminders (
        discordUserId TEXT NOT NULL,
        kind TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        sentAt INTEGER NOT NULL,
        PRIMARY KEY (discordUserId, kind, expiresAt)
      );
      CREATE TABLE IF NOT EXISTS licenseCodeResets (
        discordUserId TEXT PRIMARY KEY,
        resetAt INTEGER NOT NULL
      );
    `);
  }

  async codeUsageResetAt(discordUserId: string): Promise<number> {
    const row = this.db.prepare('SELECT resetAt FROM licenseCodeResets WHERE discordUserId = ?').get(discordUserId) as { resetAt: number } | undefined;
    return row ? row.resetAt : 0;
  }

  async resetCodeUsage(discordUserId: string, at: number): Promise<void> {
    this.db
      .prepare('INSERT INTO licenseCodeResets (discordUserId, resetAt) VALUES (?, ?) ON CONFLICT(discordUserId) DO UPDATE SET resetAt = excluded.resetAt')
      .run(discordUserId, at);
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

  async listCodesSince(discordUserId: string, since: number): Promise<CodeRecord[]> {
    return this.db
      .prepare('SELECT discordUserId, challenge, tier, createdAt FROM licenseCodes WHERE discordUserId = ? AND createdAt >= ? ORDER BY createdAt ASC')
      .all(discordUserId, since) as CodeRecord[];
  }

  async listRecentCodes(limit: number): Promise<CodeRecord[]> {
    return this.db
      .prepare('SELECT discordUserId, challenge, tier, createdAt FROM licenseCodes ORDER BY createdAt DESC LIMIT ?')
      .all(limit) as CodeRecord[];
  }

  async getSubscription(discordUserId: string): Promise<SubscriptionRecord | null> {
    const row = this.db
      .prepare('SELECT discordUserId, expiresAt, trialGrantedAt FROM licenseSubscriptions WHERE discordUserId = ?')
      .get(discordUserId) as SubscriptionRecord | undefined;
    return row ?? null;
  }

  async latestCodeFor(discordUserId: string): Promise<CodeRecord | null> {
    const row = this.db
      .prepare('SELECT discordUserId, challenge, tier, createdAt FROM licenseCodes WHERE discordUserId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(discordUserId) as CodeRecord | undefined;
    return row ?? null;
  }

  async hasReminder(discordUserId: string, kind: string, expiresAt: number): Promise<boolean> {
    return (
      this.db.prepare('SELECT 1 FROM licenseReminders WHERE discordUserId = ? AND kind = ? AND expiresAt = ?').get(discordUserId, kind, expiresAt) !==
      undefined
    );
  }

  async recordReminder(discordUserId: string, kind: string, expiresAt: number): Promise<void> {
    this.db
      .prepare('INSERT OR IGNORE INTO licenseReminders (discordUserId, kind, expiresAt, sentAt) VALUES (?, ?, ?, ?)')
      .run(discordUserId, kind, expiresAt, Date.now());
  }
}

export function createLicenseStore(): LicenseStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresLicenseStore(env.DATABASE_URL);
  return new SqliteLicenseStore();
}
