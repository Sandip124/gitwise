import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
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
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  // Ensure _migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await pool.query(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

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

    try {
      await pool.query("BEGIN");
      await pool.query(sql);
      await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      executed.push(file);
    } catch (err) {
      await pool.query("ROLLBACK");
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

// Allow running directly: tsx src/db/migrator.ts
if (
  process.argv[1] &&
  (process.argv[1].endsWith("migrator.ts") ||
    process.argv[1].endsWith("migrator.js"))
) {
  const { getPool, closePool } = await import("./pool.js");
  try {
    await runMigrations(getPool());
  } finally {
    await closePool();
  }
}
