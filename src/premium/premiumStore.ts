import pg from 'pg';
import { env } from '../config/env.js';

/**
 * The premium script file subscribers receive. It is uploaded by the owner with /tcp release and kept in the
 * database, never in the bot's repository (which is public). Postgres when DATABASE_URL points at one,
 * otherwise the local SQLite file.
 */
export interface PremiumFile {
  fileName: string;
  content: Buffer;
  sha256: string;
  uploadedAt: number;
  uploadedBy: string;
}

export interface PremiumStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  get(): Promise<PremiumFile | null>;
  save(file: PremiumFile): Promise<void>;
}

const KEY = 'release';

class PostgresPremiumStore implements PremiumStore {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS premium_files (
        key TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        content BYTEA NOT NULL,
        sha256 TEXT NOT NULL,
        uploaded_at BIGINT NOT NULL,
        uploaded_by TEXT NOT NULL
      );
    `);
  }

  async get(): Promise<PremiumFile | null> {
    const result = await this.pool.query('SELECT file_name, content, sha256, uploaded_at, uploaded_by FROM premium_files WHERE key = $1', [KEY]);
    const row = result.rows[0];
    if (!row) return null;
    return { fileName: row.file_name, content: row.content, sha256: row.sha256, uploadedAt: Number(row.uploaded_at), uploadedBy: row.uploaded_by };
  }

  async save(file: PremiumFile): Promise<void> {
    await this.pool.query(
      `INSERT INTO premium_files (key, file_name, content, sha256, uploaded_at, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET file_name = EXCLUDED.file_name, content = EXCLUDED.content, sha256 = EXCLUDED.sha256,
         uploaded_at = EXCLUDED.uploaded_at, uploaded_by = EXCLUDED.uploaded_by`,
      [KEY, file.fileName, file.content, file.sha256, file.uploadedAt, file.uploadedBy],
    );
  }
}

class SqlitePremiumStore implements PremiumStore {
  readonly kind = 'sqlite' as const;
  private db!: import('better-sqlite3').Database;

  async init(): Promise<void> {
    // Imported here so a Postgres deployment never opens the SQLite file.
    this.db = (await import('../database/client.js')).db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS premium_files (
        key TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        content BLOB NOT NULL,
        sha256 TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        uploaded_by TEXT NOT NULL
      );
    `);
  }

  async get(): Promise<PremiumFile | null> {
    const row = this.db.prepare('SELECT file_name, content, sha256, uploaded_at, uploaded_by FROM premium_files WHERE key = ?').get(KEY) as
      | { file_name: string; content: Buffer; sha256: string; uploaded_at: number; uploaded_by: string }
      | undefined;
    if (!row) return null;
    return { fileName: row.file_name, content: row.content, sha256: row.sha256, uploadedAt: row.uploaded_at, uploadedBy: row.uploaded_by };
  }

  async save(file: PremiumFile): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO premium_files (key, file_name, content, sha256, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET file_name = excluded.file_name, content = excluded.content, sha256 = excluded.sha256,
           uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by`,
      )
      .run(KEY, file.fileName, file.content, file.sha256, file.uploadedAt, file.uploadedBy);
  }
}

export function createPremiumStore(): PremiumStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresPremiumStore(env.DATABASE_URL);
  return new SqlitePremiumStore();
}
