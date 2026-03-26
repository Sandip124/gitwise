import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb, closeDb } from "../../db/database.js";
import { runMigrations } from "../../db/migrator.js";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { OverrideStore } from "../../db/override-store.js";
import { calculateFreezeScore } from "../../core/freeze-calculator.js";
import { readJsonl, deduplicateJsonl } from "../../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
  SharedOverride,
} from "../../shared/team-types.js";
import {
  DecisionEvent,
  EventType,
  IntentConfidence,
  IntentSource,
} from "../../core/types.js";
import { logger } from "../../shared/logger.js";

/**
 * Rebuild local SQLite cache from git history + .wisegit/ shared files.
 *
 * This is the "git pull" equivalent for wisegit — after pulling new
 * .wisegit/ changes from teammates, run sync to incorporate them.
 */
export async function syncCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();
  const paths = getWisegitPaths(repoPath);

  try {
    runMigrations(db);

    let imported = 0;

    // 1. Import shared enrichments
    if (existsSync(paths.enrichments)) {
      const enrichments = deduplicateJsonl(
        readJsonl<SharedEnrichment>(paths.enrichments),
        (e) => `${e.issue_ref}:${e.platform}:${e.repo}`
      );

      const existing = new Set(
        (
          db
            .prepare(
              `SELECT DISTINCT issue_ref FROM issue_enrichments WHERE repo_path = ?`
            )
            .all(repoPath) as { issue_ref: string }[]
        ).map((r) => r.issue_ref)
      );

      let newEnrichments = 0;
      for (const e of enrichments) {
        if (existing.has(e.issue_ref)) continue;

        db.prepare(
          `INSERT INTO issue_enrichments
            (id, repo_path, commit_sha, issue_ref, platform, issue_title,
             issue_status, labels, is_freeze_signal, freeze_boost)
           VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          repoPath,
          e.issue_ref,
          e.platform,
          e.title,
          e.resolution,
          JSON.stringify(e.labels),
          e.resolution === "not_planned" ? 1 : 0,
          e.signal_boosts?.wontfix ?? e.signal_boosts?.freeze_boost ?? 0
        );
        newEnrichments++;
      }

      if (newEnrichments > 0) {
        console.log(`  Imported ${newEnrichments} enrichments from team`);
        imported += newEnrichments;
      }
    }

    // 2. Import shared overrides
    if (existsSync(paths.overrides)) {
      const overrides = readJsonl<SharedOverride>(paths.overrides);
      const overrideStore = new OverrideStore(db);

      let newOverrides = 0;
      for (const o of overrides) {
        if (o.revoked) continue; // Skip revoked overrides

        const existing = overrideStore.getActiveOverride(o.function_id);
        if (existing) continue; // Already have an active override

        // Check expiry
        if (o.expires_at && new Date(o.expires_at) < new Date()) continue;

        overrideStore.createOverride(
          repoPath,
          o.function_id,
          o.reason,
          o.created_by,
          o.expires_at ? new Date(o.expires_at) : undefined
        );
        newOverrides++;
      }

      if (newOverrides > 0) {
        console.log(`  Imported ${newOverrides} overrides from team`);
        imported += newOverrides;
      }
    }

    // 3. Recompute freeze scores if anything was imported
    if (imported > 0) {
      console.log("  Recomputing freeze scores...");
      const eventStore = new EventStore(db);
      const freezeStore = new FreezeStore(db);
      const functionIds = eventStore.getDistinctFunctionIds(repoPath);

      for (const functionId of functionIds) {
        const events = eventStore.getEventsForFunction(functionId, repoPath);
        const score = calculateFreezeScore(events);
        freezeStore.upsertScore(repoPath, score);
      }

      console.log(`  Recomputed ${functionIds.length} freeze scores`);
    }

    console.log(
      imported > 0
        ? `\nSync complete: ${imported} items imported from .wisegit/`
        : "\nSync complete: local cache is up to date."
    );
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
