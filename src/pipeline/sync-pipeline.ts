import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventStore } from "../db/event-store.js";
import { FreezeStore } from "../db/freeze-store.js";
import { calculateFreezeScore } from "../core/freeze-calculator.js";
import { readJsonl } from "../shared/jsonl.js";
import {
  getWisegitPaths,
  SharedEnrichment,
  SharedOverride,
} from "../shared/team-types.js";
import { logger } from "../shared/logger.js";

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
 * Compute a lightweight fingerprint of .wisegit/ files.
 * Any git operation that touches these files changes the fingerprint.
 */
function computeSyncHash(repoPath: string): string {
  const paths = getWisegitPaths(repoPath);
  const parts: string[] = [];

  for (const file of [
    paths.enrichments,
    paths.overrides,
    paths.branchContexts,
    paths.config,
  ]) {
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
 * Deduplicate JSONL entries. When two developers write conflicting entries
 * (e.g., both override the same function), resolution rules apply:
 *
 * Enrichments: keyed by issue_ref — first entry wins (factual, immutable)
 * Overrides: keyed by function_id — latest created_at wins (most recent decision)
 */

function deduplicateEnrichments(
  entries: SharedEnrichment[]
): SharedEnrichment[] {
  const seen = new Map<string, SharedEnrichment>();
  for (const e of entries) {
    const key = `${e.issue_ref}:${e.platform}`;
    if (!seen.has(key)) {
      seen.set(key, e);
    }
    // First entry wins for enrichments (factual data doesn't change)
  }
  return [...seen.values()];
}

function deduplicateOverrides(entries: SharedOverride[]): SharedOverride[] {
  // Group by function_id. For each function, keep only the latest
  // non-revoked, non-expired entry.
  const byFunction = new Map<string, SharedOverride>();

  for (const o of entries) {
    // Skip revoked
    if (o.revoked) {
      // A revocation cancels the previous override for this function
      byFunction.delete(o.function_id);
      continue;
    }

    // Skip expired
    if (o.expires_at && new Date(o.expires_at) < new Date()) continue;

    const existing = byFunction.get(o.function_id);
    if (!existing) {
      byFunction.set(o.function_id, o);
    } else {
      // Latest created_at wins — most recent team decision takes precedence
      if (o.created_at > existing.created_at) {
        byFunction.set(o.function_id, o);
      }
    }
  }

  return [...byFunction.values()];
}

/**
 * Sync .wisegit/ shared files into the local SQLite cache.
 *
 * RECONCILE strategy:
 * - .wisegit/ JSONL = source of truth for this branch
 * - Enrichments: additive (factual data, keyed by issue_ref)
 * - Overrides: reconciled (keyed by function_id, latest wins, per-branch)
 *
 * Handles duplicates from git merges where two developers wrote
 * conflicting entries to the same JSONL file.
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

  // ── 1. Reconcile enrichments (additive, deduplicated by issue_ref) ──
  if (existsSync(paths.enrichments)) {
    const enrichments = deduplicateEnrichments(
      readJsonl<SharedEnrichment>(paths.enrichments)
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

  // ── 2. Reconcile overrides (per-function, latest wins) ──
  const reconcileOverrides = db.transaction(() => {
    if (!existsSync(paths.overrides)) return;

    // Deduplicate: per function_id, latest created_at wins, revocations cancel
    const validOverrides = deduplicateOverrides(
      readJsonl<SharedOverride>(paths.overrides)
    );

    const validByFunction = new Map(
      validOverrides.map((o) => [o.function_id, o])
    );
    const validIds = new Set(validOverrides.map((o) => o.id));

    // Get current DB overrides
    const dbOverrides = db
      .prepare(
        `SELECT id, function_id FROM overrides WHERE repo_path = ? AND active = 1`
      )
      .all(repoPath) as { id: string; function_id: string }[];

    // Deactivate DB overrides that conflict with JSONL source of truth
    for (const dbOvr of dbOverrides) {
      const jsonlOverride = validByFunction.get(dbOvr.function_id);

      if (!jsonlOverride) {
        // This function has no override in JSONL — check if it was JSONL-sourced
        // Only deactivate if this ID was originally from JSONL
        const allJsonlEntries = readJsonl<SharedOverride>(paths.overrides);
        const wasFromJsonl = allJsonlEntries.some((o) => o.id === dbOvr.id);
        if (wasFromJsonl) {
          db.prepare(`UPDATE overrides SET active = 0 WHERE id = ?`).run(
            dbOvr.id
          );
          overridesRemoved++;
        }
      } else if (jsonlOverride.id !== dbOvr.id) {
        // Different override won for this function — deactivate the old one
        db.prepare(`UPDATE overrides SET active = 0 WHERE id = ?`).run(
          dbOvr.id
        );
        overridesRemoved++;
      }
    }

    // Import valid overrides that aren't in DB
    const dbIdSet = new Set(dbOverrides.map((o) => o.id));
    for (const o of validOverrides) {
      if (dbIdSet.has(o.id)) continue;

      db.prepare(
        `INSERT OR IGNORE INTO overrides
          (id, repo_path, function_id, reason, author, expires_at, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).run(o.id, repoPath, o.function_id, o.reason, o.created_by, o.expires_at);
      overridesImported++;
    }
  });

  reconcileOverrides();
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
