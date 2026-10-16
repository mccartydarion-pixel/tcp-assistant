import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Where support tickets are kept, so ticket numbers keep counting and open tickets are known across
 * redeploys. Postgres when DATABASE_URL points at one, otherwise the local SQLite file. The table is
 * support_tickets: the SQLite file already has an older, unused "tickets" table.
 */
export interface TicketStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  /** Records a new open ticket and returns its number. */
  create(discordUserId: string, kind: string, now: number): Promise<number>;
  setChannel(number: number, channelId: string): Promise<void>;
  /** This member's open ticket, if they have one. */
  openFor(discordUserId: string): Promise<TicketRecord | null>;
  byChannel(channelId: string): Promise<TicketRecord | null>;
  claim(number: number, by: string): Promise<void>;
  close(number: number, by: string, now: number): Promise<void>;
}

export interface TicketRecord {
  number: number;
  discordUserId: string;
  channelId: string | null;
  kind: string;
  status: 'open' | 'closed';
  claimedBy: string | null;
  createdAt: number;
  closedAt: number | null;
  closedBy: string | null;
}

interface Row {
  number: number | string;
  discord_user_id: string;
  channel_id: string | null;
  kind: string;
  status: string;
  claimed_by: string | null;
  created_at: number | string;
  closed_at: number | string | null;
  closed_by: string | null;
}

const COLUMNS = 'number, discord_user_id, channel_id, kind, status, claimed_by, created_at, closed_at, closed_by';

function toRecord(row: Row | undefined): TicketRecord | null {
  if (!row) return null;
  return {
    number: Number(row.number),
    discordUserId: row.discord_user_id,
    channelId: row.channel_id,
    kind: row.kind,
    status: row.status === 'closed' ? 'closed' : 'open',
    claimedBy: row.claimed_by,
    createdAt: Number(row.created_at),
    closedAt: row.closed_at === null ? null : Number(row.closed_at),
    closedBy: row.closed_by,
  };
}

class PostgresTicketStore implements TicketStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        number SERIAL PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        channel_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        claimed_by TEXT,
        created_at BIGINT NOT NULL,
        closed_at BIGINT,
        closed_by TEXT
      );
      CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets (discord_user_id, status);
      CREATE INDEX IF NOT EXISTS support_tickets_channel ON support_tickets (channel_id);
    `);
  }

  async create(discordUserId: string, kind: string, now: number): Promise<number> {
    const result = await this.pool.query(
      'INSERT INTO support_tickets (discord_user_id, kind, status, created_at) VALUES ($1, $2, $3, $4) RETURNING number',
      [discordUserId, kind, 'open', now],
    );
    return Number(result.rows[0].number);
  }

  async setChannel(number: number, channelId: string): Promise<void> {
    await this.pool.query('UPDATE support_tickets SET channel_id = $1 WHERE number = $2', [channelId, number]);
  }

  async openFor(discordUserId: string): Promise<TicketRecord | null> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM support_tickets WHERE discord_user_id = $1 AND status = 'open' ORDER BY number DESC LIMIT 1`,
      [discordUserId],
    );
    return toRecord(result.rows[0]);
  }

  async byChannel(channelId: string): Promise<TicketRecord | null> {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM support_tickets WHERE channel_id = $1 ORDER BY number DESC LIMIT 1`, [channelId]);
    return toRecord(result.rows[0]);
  }

  async claim(number: number, by: string): Promise<void> {
    await this.pool.query('UPDATE support_tickets SET claimed_by = $1 WHERE number = $2', [by, number]);
  }

  async close(number: number, by: string, now: number): Promise<void> {
    await this.pool.query("UPDATE support_tickets SET status = 'closed', closed_at = $1, closed_by = $2 WHERE number = $3", [now, by, number]);
  }
}

class SqliteTicketStore implements TicketStore {
  readonly kind = 'sqlite' as const;
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        number INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        channel_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        claimed_by TEXT,
        created_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_by TEXT
      );
    `);
  }

  async create(discordUserId: string, kind: string, now: number): Promise<number> {
    const result = this.db
      .prepare('INSERT INTO support_tickets (discord_user_id, kind, status, created_at) VALUES (?, ?, ?, ?)')
      .run(discordUserId, kind, 'open', now);
    return Number(result.lastInsertRowid);
  }

  async setChannel(number: number, channelId: string): Promise<void> {
    this.db.prepare('UPDATE support_tickets SET channel_id = ? WHERE number = ?').run(channelId, number);
  }

  async openFor(discordUserId: string): Promise<TicketRecord | null> {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM support_tickets WHERE discord_user_id = ? AND status = 'open' ORDER BY number DESC LIMIT 1`)
      .get(discordUserId) as Row | undefined;
    return toRecord(row);
  }

  async byChannel(channelId: string): Promise<TicketRecord | null> {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM support_tickets WHERE channel_id = ? ORDER BY number DESC LIMIT 1`).get(channelId) as
      | Row
      | undefined;
    return toRecord(row);
  }

  async claim(number: number, by: string): Promise<void> {
    this.db.prepare('UPDATE support_tickets SET claimed_by = ? WHERE number = ?').run(by, number);
  }

  async close(number: number, by: string, now: number): Promise<void> {
    this.db.prepare("UPDATE support_tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE number = ?").run(now, by, number);
  }
}

export function createTicketStore(): TicketStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresTicketStore(env.DATABASE_URL);
  return new SqliteTicketStore();
}
