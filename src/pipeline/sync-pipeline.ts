import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { OverrideStore } from "../db/override-store.js";
import { calculateFreezeScore } from "../core/freeze-calculator.js";
import { readJsonl, deduplicateJsonl } from "../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
  SharedOverride,
} from "../shared/team-types.js";
import { logger } from "../shared/logger.js";

// Track when we last synced to avoid redundant work
let lastSyncTime = 0;
let lastSyncRepoPath = "";

export interface SyncResult {
  enrichmentsImported: number;
  overridesImported: number;
  scoresRecomputed: number;
  skipped: boolean;
}

/**
 * Check if .wisegit/ files have changed since last sync.
 */
function needsSync(repoPath: string): boolean {
  const paths = getWisegitPaths(repoPath);

  // Different repo than last sync — always sync
  if (repoPath !== lastSyncRepoPath) return true;

  // Check if any JSONL file is newer than last sync
  for (const file of [paths.enrichments, paths.overrides, paths.branchContexts]) {
    if (!existsSync(file)) continue;
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime > lastSyncTime) return true;
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Sync .wisegit/ shared files into the local SQLite cache.
 *
 * Called automatically:
 * 1. On every MCP tool call (if files changed)
 * 2. On post-merge hook (after git pull)
 * 3. On wisegit init (if .wisegit/ exists)
 * 4. Manually via wisegit sync
 *
 * Designed to be fast when nothing changed (< 1ms check).
 */
export function syncSharedLayer(
  db: Database.Database,
  repoPath: string,
  force = false
): SyncResult {
  if (!force && !needsSync(repoPath)) {
    return { enrichmentsImported: 0, overridesImported: 0, scoresRecomputed: 0, skipped: true };
  }

  const paths = getWisegitPaths(repoPath);
  let totalImported = 0;
  let enrichmentsImported = 0;
  let overridesImported = 0;

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

    const insertEnrichment = db.prepare(
      `INSERT INTO issue_enrichments
        (id, repo_path, commit_sha, issue_ref, platform, issue_title,
         issue_status, labels, is_freeze_signal, freeze_boost)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertBatch = db.transaction((items: SharedEnrichment[]) => {
      for (const e of items) {
        if (existing.has(e.issue_ref)) continue;
        insertEnrichment.run(
          randomUUID(),
          repoPath,
          e.issue_ref,
          e.platform,
          e.title,
          e.resolution,
          JSON.stringify(e.labels),
          e.resolution === "not_planned" ? 1 : 0,
          e.signal_boosts?.wontfix ?? e.signal_boosts?.freeze_boost ?? 0
        );
        enrichmentsImported++;
      }
    });

    insertBatch(enrichments);
    totalImported += enrichmentsImported;
  }

  // 2. Import shared overrides
  if (existsSync(paths.overrides)) {
    const overrides = readJsonl<SharedOverride>(paths.overrides);
    const overrideStore = new OverrideStore(db);

    for (const o of overrides) {
      if (o.revoked) continue;
      const existing = overrideStore.getActiveOverride(o.function_id);
      if (existing) continue;
      if (o.expires_at && new Date(o.expires_at) < new Date()) continue;

      overrideStore.createOverride(
        repoPath,
        o.function_id,
        o.reason,
        o.created_by,
        o.expires_at ? new Date(o.expires_at) : undefined
      );
      overridesImported++;
    }
    totalImported += overridesImported;
  }

  // 3. Recompute if anything changed
  let scoresRecomputed = 0;
  if (totalImported > 0) {
    const eventStore = new EventStore(db);
    const freezeStore = new FreezeStore(db);
    const functionIds = eventStore.getDistinctFunctionIds(repoPath);

    for (const functionId of functionIds) {
      const events = eventStore.getEventsForFunction(functionId, repoPath);
      const score = calculateFreezeScore(events);
      freezeStore.upsertScore(repoPath, score);
    }
    scoresRecomputed = functionIds.length;

    logger.info(
      `Synced: ${enrichmentsImported} enrichments, ${overridesImported} overrides → recomputed ${scoresRecomputed} scores`
    );
  }

  // Update sync timestamp
  lastSyncTime = Date.now();
  lastSyncRepoPath = repoPath;

  return { enrichmentsImported, overridesImported, scoresRecomputed, skipped: false };
}
