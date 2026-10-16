import pg from 'pg';
import { env } from '../config/env.js';
import type { SubscriptionRecord } from './paymentRules.js';

/**
 * Who pays: each member's Stripe customer and subscription, and the Stripe events already handled (Stripe
 * resends events, and each payment must add days only once). Postgres when DATABASE_URL points at one,
 * otherwise the local SQLite file.
 */
export interface PaymentStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  getByUser(discordUserId: string): Promise<SubscriptionRecord | null>;
  getByCustomer(customerId: string): Promise<SubscriptionRecord | null>;
  save(record: SubscriptionRecord): Promise<void>;
  /** Marks a Stripe event as being handled. False when it already was: skip it. */
  claimEvent(eventId: string, now: number): Promise<boolean>;
  /** Handling failed: let Stripe's retry try again. */
  releaseEvent(eventId: string): Promise<void>;
}

interface Row {
  discord_user_id: string;
  customer_id: string;
  subscription_id: string | null;
  status: string;
  cancel_at_period_end: boolean | number;
  current_period_end: number | string | null;
  updated_at: number | string;
}

const COLUMNS = 'discord_user_id, customer_id, subscription_id, status, cancel_at_period_end, current_period_end, updated_at';

function toRecord(row: Row | undefined): SubscriptionRecord | null {
  if (!row) return null;
  return {
    discordUserId: row.discord_user_id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    status: row.status,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    currentPeriodEnd: row.current_period_end === null ? null : Number(row.current_period_end),
    updatedAt: Number(row.updated_at),
  };
}

class PostgresPaymentStore implements PaymentStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        discord_user_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        subscription_id TEXT,
        status TEXT NOT NULL,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        current_period_end BIGINT,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stripe_subscriptions_customer ON stripe_subscriptions (customer_id);
      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id TEXT PRIMARY KEY,
        received_at BIGINT NOT NULL
      );
    `);
  }

  async getByUser(discordUserId: string): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM stripe_subscriptions WHERE discord_user_id = $1`, [discordUserId]);
    return toRecord(result.rows[0]);
  }

  async getByCustomer(customerId: string): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM stripe_subscriptions WHERE customer_id = $1 ORDER BY updated_at DESC LIMIT 1`, [customerId]);
    return toRecord(result.rows[0]);
  }

  async save(record: SubscriptionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO stripe_subscriptions (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (discord_user_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, subscription_id = EXCLUDED.subscription_id,
         status = EXCLUDED.status, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         current_period_end = EXCLUDED.current_period_end, updated_at = EXCLUDED.updated_at`,
      [record.discordUserId, record.customerId, record.subscriptionId, record.status, record.cancelAtPeriodEnd, record.currentPeriodEnd, record.updatedAt],
    );
  }

  async claimEvent(eventId: string, now: number): Promise<boolean> {
    const result = await this.pool.query('INSERT INTO stripe_events (event_id, received_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, now]);
    return result.rowCount === 1;
  }

  async releaseEvent(eventId: string): Promise<void> {
    await this.pool.query('DELETE FROM stripe_events WHERE event_id = $1', [eventId]);
  }
}

class SqlitePaymentStore implements PaymentStore {
  readonly kind = 'sqlite' as const;
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        discord_user_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        subscription_id TEXT,
        status TEXT NOT NULL,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        current_period_end INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      );
    `);
  }

  async getByUser(discordUserId: string): Promise<SubscriptionRecord | null> {
    return toRecord(this.db.prepare(`SELECT ${COLUMNS} FROM stripe_subscriptions WHERE discord_user_id = ?`).get(discordUserId) as Row | undefined);
  }

  async getByCustomer(customerId: string): Promise<SubscriptionRecord | null> {
    return toRecord(
      this.db.prepare(`SELECT ${COLUMNS} FROM stripe_subscriptions WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1`).get(customerId) as Row | undefined,
    );
  }

  async save(record: SubscriptionRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO stripe_subscriptions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (discord_user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id,
           status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
           current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`,
      )
      .run(
        record.discordUserId,
        record.customerId,
        record.subscriptionId,
        record.status,
        record.cancelAtPeriodEnd ? 1 : 0,
        record.currentPeriodEnd,
        record.updatedAt,
      );
  }

  async claimEvent(eventId: string, now: number): Promise<boolean> {
    return this.db.prepare('INSERT OR IGNORE INTO stripe_events (event_id, received_at) VALUES (?, ?)').run(eventId, now).changes === 1;
  }

  async releaseEvent(eventId: string): Promise<void> {
    this.db.prepare('DELETE FROM stripe_events WHERE event_id = ?').run(eventId);
  }
}

export function createPaymentStore(): PaymentStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresPaymentStore(env.DATABASE_URL);
  return new SqlitePaymentStore();
}
