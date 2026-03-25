import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { logger } from "../shared/logger.js";
import { MigrationError } from "../shared/errors.js";

const MIGRATIONS_DIR = resolve(
  fileURLToPath(import.meta.url),
  "../../../sql/migrations"
);

/**
 * Run all pending SQL migrations in order.
 * Tracks applied migrations in a _migrations table.
 */
export function runMigrations(db: Database.Database): string[] {
  // Ensure _migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get already-applied migrations
  const applied = db
    .prepare("SELECT name FROM _migrations ORDER BY name")
    .all() as { name: string }[];
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read migration files
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    logger.info(`Running migration: ${file}`);

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });

    try {
      runMigration();
      executed.push(file);
    } catch (err) {
      throw new MigrationError(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (executed.length > 0) {
    logger.info(`Applied ${executed.length} migration(s)`);
  } else {
    logger.info("All migrations already applied");
  }

  return executed;
}
