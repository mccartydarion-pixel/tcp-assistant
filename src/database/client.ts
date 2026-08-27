import Database from 'better-sqlite3';

export const db = new Database('data/tcp.db');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discordUserId TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      discordChannelId TEXT NOT NULL,
      discordUserId TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence TEXT NOT NULL,
      summary TEXT NOT NULL,
      settingsJson TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bugReports (
      id TEXT PRIMARY KEY,
      reporterId TEXT NOT NULL,
      version TEXT,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      expectedBehavior TEXT,
      actualBehavior TEXT,
      reproductionSteps TEXT NOT NULL,
      frequency TEXT,
      settingsJson TEXT,
      attachmentsJson TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
}
