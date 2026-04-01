import Database from "better-sqlite3";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../shared/config.js";

let db: Database.Database | null = null;

/**
 * Get the SQLite database instance (singleton).
 * Creates the database file and parent directories if needed.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const config = loadConfig();
  const dbPath = config.dbPath;

  // Ensure parent directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const isNew = !existsSync(dbPath);
  db = new Database(dbPath);

  // Restrict permissions on new databases (owner-only read/write)
  if (isNew) {
    try { chmodSync(dbPath, 0o600); } catch { /* non-critical on Windows */ }
  }

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
