import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Small pieces of bot state that must outlive a redeploy: the support hours, when a daily or weekly job last
// ran, the answers the team taught the assistant. One row per key, the value as JSON. Postgres when
// DATABASE_URL points at one, otherwise the local SQLite file (which a redeploy clears).

interface Backend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

class PostgresBackend implements Backend {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query('CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)');
  }

  async get(key: string): Promise<string | null> {
    const result = await this.pool.query('SELECT value FROM bot_state WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO bot_state (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
      [key, value, Date.now()],
    );
  }
}

class SqliteBackend implements Backend {
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('./client.js')).db;
    this.db.exec('CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db
      .prepare('INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, Date.now());
  }
}

class MemoryBackend implements Backend {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

let backend: Backend | null = null;
let opening: Promise<Backend | null> | null = null;

/** Opens the state table once; later calls wait for the first. Null when it could not be opened. */
export function initState(): Promise<Backend | null> {
  if (backend) return Promise.resolve(backend);
  opening ??= (async () => {
    try {
      const opened = /^postgres(ql)?:\/\//i.test(env.DATABASE_URL) ? new PostgresBackend(env.DATABASE_URL) : new SqliteBackend();
      await opened.init();
      backend = opened;
      return opened;
    } catch (error) {
      logger.error({ err: error }, '[TCP State ERROR] Could not open the bot_state table');
      opening = null;
      return null;
    }
  })();
  return opening;
}

/** The stored value, or the fallback when there is none (or the store cannot be read). */
export async function getState<T>(key: string, fallback: T): Promise<T> {
  const opened = await initState();
  if (!opened) return fallback;
  try {
    const raw = await opened.get(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch (error) {
    logger.warn({ err: error }, `[TCP State] Could not read ${key}`);
    return fallback;
  }
}

export async function setState(key: string, value: unknown): Promise<void> {
  const opened = await initState();
  if (!opened) throw new Error('The bot_state table is not open');
  await opened.set(key, JSON.stringify(value));
}

/** For tests: keep state in memory. */
export function useMemoryStateForTests(): void {
  backend = new MemoryBackend();
  opening = Promise.resolve(backend);
}
