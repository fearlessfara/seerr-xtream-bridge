import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDatabaseResult {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
}

export function openDatabase(databasePath: string): OpenDatabaseResult {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  migrate(sqlite);

  const db = drizzle(sqlite, { schema });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    // Prefer an orderly close so better-sqlite3 can unregister V8 cleanup hooks
    // before the isolate tears down (avoids RemoveEnvironmentCleanupHook crashes).
    if (sqlite.open) {
      sqlite.close();
    }
  };

  return { db, sqlite, close };
}

function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seerr_request_id INTEGER NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      tvdb_id INTEGER,
      is_4k INTEGER NOT NULL DEFAULT 0,
      requester TEXT,
      seasons_json TEXT,
      raw_webhook_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_scopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      scope_type TEXT NOT NULL,
      season_number INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS acquisition_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      state TEXT NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      match_kind TEXT,
      error_class TEXT,
      error_message TEXT,
      arr_server_id INTEGER,
      arr_profile_id INTEGER,
      arr_profile_name TEXT,
      arr_type TEXT,
      quality_resolution_snapshot TEXT,
      quality_decision TEXT,
      jellyfin_verified_at TEXT,
      availability_grace_until TEXT,
      completion_grace_until TEXT,
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xtream_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES acquisition_jobs(id),
      source_id TEXT NOT NULL,
      stream_id TEXT,
      series_id TEXT,
      season_number INTEGER,
      cart_item_ids_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES acquisition_jobs(id),
      from_state TEXT,
      to_state TEXT NOT NULL,
      reason TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_key TEXT NOT NULL UNIQUE,
      job_id INTEGER REFERENCES acquisition_jobs(id),
      status TEXT NOT NULL,
      request_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
