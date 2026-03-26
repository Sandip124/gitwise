import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { syncSharedLayer } from "../../pipeline/sync-pipeline.js";
import { logger } from "../../shared/logger.js";

/**
 * Rebuild local SQLite cache from .wisegit/ shared files.
 * Run after `git pull` to import team knowledge.
 */
export async function syncCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    runMigrations(db);

    const result = syncSharedLayer(db, repoPath, true /* force */);

    if (result.skipped) {
      console.log("Sync complete: local cache is up to date.");
    } else {
      const total =
        result.enrichmentsImported + result.overridesImported;

      if (total > 0) {
        console.log(`Sync complete:`);
        if (result.enrichmentsImported > 0) {
          console.log(
            `  Enrichments imported: ${result.enrichmentsImported}`
          );
        }
        if (result.overridesImported > 0) {
          console.log(
            `  Overrides imported:   ${result.overridesImported}`
          );
        }
        console.log(
          `  Scores recomputed:    ${result.scoresRecomputed}`
        );
      } else {
        console.log("Sync complete: no new team knowledge to import.");
      }
    }
  } catch (err) {
    logger.error("Sync failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
