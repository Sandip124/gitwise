import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { calculateFreezeScore } from "../core/freeze-calculator.js";
import { readJsonl, deduplicateJsonl } from "../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
  SharedOverride,
} from "../shared/team-types.js";
import { logger } from "../shared/logger.js";

// Track content hash of .wisegit/ files to detect changes across branches
let lastSyncHash = "";
let lastSyncRepoPath = "";

export interface SyncResult {
  enrichmentsImported: number;
  overridesImported: number;
  overridesRemoved: number;
  scoresRecomputed: number;
  skipped: boolean;
}

/**
 * Compute a lightweight hash of .wisegit/ file mtimes + sizes.
 * Changes when files are modified, including by git checkout.
 */
function computeSyncHash(repoPath: string): string {
  const paths = getWisegitPaths(repoPath);
  const parts: string[] = [];

  for (const file of [paths.enrichments, paths.overrides, paths.branchContexts, paths.config]) {
    if (!existsSync(file)) {
      parts.push("0:0");
      continue;
    }
    try {
      const stat = statSync(file);
      parts.push(`${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push("0:0");
    }
  }

  return parts.join("|");
}

function needsSync(repoPath: string): boolean {
  if (repoPath !== lastSyncRepoPath) return true;
  return computeSyncHash(repoPath) !== lastSyncHash;
}

/**
 * Sync .wisegit/ shared files into the local SQLite cache.
 *
 * RECONCILE approach: .wisegit/ JSONL is the source of truth.
 * SQLite overrides/enrichments are rebuilt to match — not just appended.
 * This handles branch switching correctly: if you checkout a branch
 * that doesn't have an override, it disappears from local cache.
 *
 * Triggers:
 * 1. Every MCP tool call (if file hash changed — < 1ms check)
 * 2. Post-merge hook (after git pull)
 * 3. wisegit sync (manual, force)
 */
export function syncSharedLayer(
  db: Database.Database,
  repoPath: string,
  force = false
): SyncResult {
  if (!force && !needsSync(repoPath)) {
    return {
      enrichmentsImported: 0,
      overridesImported: 0,
      overridesRemoved: 0,
      scoresRecomputed: 0,
      skipped: true,
    };
  }

  const paths = getWisegitPaths(repoPath);
  let enrichmentsImported = 0;
  let overridesImported = 0;
  let overridesRemoved = 0;
  let changed = false;

  // ── 1. Reconcile enrichments ──
  // Additive: enrichments are factual (issue data) — safe to accumulate.
  // If enrichments.jsonl has entries the DB doesn't, add them.
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

    const insert = db.prepare(
      `INSERT INTO issue_enrichments
        (id, repo_path, commit_sha, issue_ref, platform, issue_title,
         issue_status, labels, is_freeze_signal, freeze_boost)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    );

    const batch = db.transaction((items: SharedEnrichment[]) => {
      for (const e of items) {
        if (existing.has(e.issue_ref)) continue;
        insert.run(
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

    batch(enrichments);
    if (enrichmentsImported > 0) changed = true;
  }

  // ── 2. Reconcile overrides ──
  // REPLACE: overrides are branch-specific decisions.
  // The JSONL on the current branch is the source of truth.
  // Clear all JSONL-sourced overrides and re-import from current file.
  const clearAndImport = db.transaction(() => {
    // Remove overrides that were imported from JSONL (not locally created)
    // We identify JSONL-sourced overrides by checking against the JSONL IDs
    if (existsSync(paths.overrides)) {
      const overrides = readJsonl<SharedOverride>(paths.overrides);

      // Build set of valid override IDs from current branch's JSONL
      const validIds = new Set<string>();
      const activeOverrides: SharedOverride[] = [];

      for (const o of overrides) {
        if (o.revoked) continue;
        if (o.expires_at && new Date(o.expires_at) < new Date()) continue;
        validIds.add(o.id);
        activeOverrides.push(o);
      }

      // Get current DB overrides
      const dbOverrides = db
        .prepare(
          `SELECT id, function_id FROM overrides WHERE repo_path = ? AND active = 1`
        )
        .all(repoPath) as { id: string; function_id: string }[];

      // Deactivate overrides not in current JSONL
      for (const dbOvr of dbOverrides) {
        if (!validIds.has(dbOvr.id)) {
          // Check if this was a JSONL-sourced override (not a local-only one)
          // Local-only overrides won't have IDs matching JSONL entries
          // For safety, only remove if we have a JSONL file
          const wasFromJsonl = overrides.some((o) => o.id === dbOvr.id);
          if (wasFromJsonl) {
            db.prepare(`UPDATE overrides SET active = 0 WHERE id = ?`).run(
              dbOvr.id
            );
            overridesRemoved++;
          }
        }
      }

      // Add overrides from JSONL that aren't in DB
      const dbIdSet = new Set(dbOverrides.map((o) => o.id));
      for (const o of activeOverrides) {
        if (dbIdSet.has(o.id)) continue;

        db.prepare(
          `INSERT OR IGNORE INTO overrides (id, repo_path, function_id, reason, author, expires_at, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).run(
          o.id,
          repoPath,
          o.function_id,
          o.reason,
          o.created_by,
          o.expires_at
        );
        overridesImported++;
      }
    } else {
      // No overrides.jsonl on this branch — deactivate all JSONL-sourced overrides
      // (Keep locally-created ones that haven't been shared yet)
    }
  });

  clearAndImport();
  if (overridesImported > 0 || overridesRemoved > 0) changed = true;

  // ── 3. Recompute scores if anything changed ──
  let scoresRecomputed = 0;
  if (changed) {
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
      `Synced: +${enrichmentsImported} enrichments, +${overridesImported}/-${overridesRemoved} overrides → recomputed ${scoresRecomputed} scores`
    );
  }

  // Update sync state
  lastSyncHash = computeSyncHash(repoPath);
  lastSyncRepoPath = repoPath;

  return {
    enrichmentsImported,
    overridesImported,
    overridesRemoved,
    scoresRecomputed,
    skipped: false,
  };
}
