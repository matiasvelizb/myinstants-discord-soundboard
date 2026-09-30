import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/config.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sounds (
    id INTEGER PRIMARY KEY,
    guild_id TEXT NOT NULL,
    sound_url TEXT NOT NULL,
    title TEXT NOT NULL,
    original_url TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, sound_url)
  );
  CREATE INDEX IF NOT EXISTS idx_sounds_recent ON sounds (guild_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sounds_popular ON sounds (guild_id, play_count DESC);
  CREATE TABLE IF NOT EXISTS user_voices (
    user_id TEXT PRIMARY KEY,
    voice TEXT NOT NULL
  );
`;

/**
 * Opens the SQLite database, creating the file and schema on first run
 * @param {string} [file] - Database file, defaults to DATA_DIR/soundboard.db
 * @returns {DatabaseSync}
 */
export function openDatabase(file = path.join(config.dataDir, 'soundboard.db')) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
