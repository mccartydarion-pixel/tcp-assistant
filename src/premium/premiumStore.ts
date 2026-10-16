import pg from 'pg';
import { env } from '../config/env.js';
import type { Mark } from './fingerprint.js';

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

/** The fingerprint one member's copy of one upload carries. */
export interface MarkRecord extends Mark {
  discordUserId: string;
  fileSha: string;
  createdAt: number;
}

export interface PremiumStore {
  readonly kind: 'postgres' | 'sqlite';
  init(): Promise<void>;
  get(): Promise<PremiumFile | null>;
  save(file: PremiumFile): Promise<void>;
  /** The mark this member's copy of this upload carries, if they have been sent one. */
  getMark(discordUserId: string, fileSha: string): Promise<Mark | null>;
  /**
   * Gives this member this mark for this upload, unless they already have one. Returns the mark they now
   * have, or null when another member already holds the same name and value (pick another and try again).
   */
  claimMark(discordUserId: string, fileSha: string, mark: Mark): Promise<Mark | null>;
  listMarks(): Promise<MarkRecord[]>;
}

// One mark per member per upload, and no two members with the same name and value.
const MARKS_TABLE = `
  CREATE TABLE IF NOT EXISTS premium_marks (
    discord_user_id TEXT NOT NULL,
    file_sha TEXT NOT NULL,
    mark_name TEXT NOT NULL,
    mark_value INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (discord_user_id, file_sha),
    UNIQUE (mark_name, mark_value)
  );
`;

type MarkRow = { discord_user_id: string; file_sha: string; mark_name: string; mark_value: number; created_at: number | string };

function toMarkRecord(row: MarkRow): MarkRecord {
  return { discordUserId: row.discord_user_id, fileSha: row.file_sha, name: row.mark_name, value: Number(row.mark_value), createdAt: Number(row.created_at) };
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
    await this.pool.query(MARKS_TABLE);
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

  async getMark(discordUserId: string, fileSha: string): Promise<Mark | null> {
    const result = await this.pool.query('SELECT mark_name, mark_value FROM premium_marks WHERE discord_user_id = $1 AND file_sha = $2', [
      discordUserId,
      fileSha,
    ]);
    const row = result.rows[0];
    return row ? { name: row.mark_name, value: Number(row.mark_value) } : null;
  }

  async claimMark(discordUserId: string, fileSha: string, mark: Mark): Promise<Mark | null> {
    await this.pool.query(
      'INSERT INTO premium_marks (discord_user_id, file_sha, mark_name, mark_value, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [discordUserId, fileSha, mark.name, mark.value, Date.now()],
    );
    return this.getMark(discordUserId, fileSha);
  }

  async listMarks(): Promise<MarkRecord[]> {
    const result = await this.pool.query('SELECT discord_user_id, file_sha, mark_name, mark_value, created_at FROM premium_marks');
    return result.rows.map(toMarkRecord);
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
    this.db.exec(MARKS_TABLE);
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

  async getMark(discordUserId: string, fileSha: string): Promise<Mark | null> {
    const row = this.db.prepare('SELECT mark_name, mark_value FROM premium_marks WHERE discord_user_id = ? AND file_sha = ?').get(discordUserId, fileSha) as
      | { mark_name: string; mark_value: number }
      | undefined;
    return row ? { name: row.mark_name, value: row.mark_value } : null;
  }

  async claimMark(discordUserId: string, fileSha: string, mark: Mark): Promise<Mark | null> {
    this.db
      .prepare('INSERT OR IGNORE INTO premium_marks (discord_user_id, file_sha, mark_name, mark_value, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(discordUserId, fileSha, mark.name, mark.value, Date.now());
    return this.getMark(discordUserId, fileSha);
  }

  async listMarks(): Promise<MarkRecord[]> {
    return (this.db.prepare('SELECT discord_user_id, file_sha, mark_name, mark_value, created_at FROM premium_marks').all() as MarkRow[]).map(toMarkRecord);
  }
}

export function createPremiumStore(): PremiumStore {
  if (/^postgres(ql)?:\/\//i.test(env.DATABASE_URL)) return new PostgresPremiumStore(env.DATABASE_URL);
  return new SqlitePremiumStore();
}
