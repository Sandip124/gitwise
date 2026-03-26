import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { getDb, closeDb } from "../../db/database.js";
import {
  captureBranchContext,
  recoverBranchContext,
  getBranchSnapshots,
} from "../../pipeline/branch-context.js";
import { logger } from "../../shared/logger.js";
import { appendJsonl } from "../../shared/jsonl.js";
import { getWisegitPaths, SharedBranchContext } from "../../shared/team-types.js";

export async function branchCaptureCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    const snapshot = await captureBranchContext(repoPath, db);
    if (snapshot) {
      // Write to .wisegit/branch-contexts.jsonl for team sharing
      const paths = getWisegitPaths(repoPath);
      let mergedBy: string;
      try {
        mergedBy = execFileSync("git", ["config", "user.email"], { encoding: "utf-8" }).trim();
      } catch {
        mergedBy = "unknown";
      }
      const shared: SharedBranchContext = {
        branch: snapshot.branch,
        merged_at: snapshot.mergedAt,
        merge_commit: "", // Could be extracted from git
        merged_by: mergedBy,
        purpose: snapshot.purpose,
        files_changed: snapshot.filesChanged,
        commit_count: snapshot.commitCount,
      };
      appendJsonl(paths.branchContexts, shared);

      console.log(`Branch context captured:`);
      console.log(`  Branch:   ${snapshot.branch}`);
      console.log(`  Merged:   ${snapshot.mergedInto}`);
      console.log(`  Files:    ${snapshot.filesChanged.length}`);
      console.log(`  Commits:  ${snapshot.commitCount}`);
      console.log(`  Purpose:  ${snapshot.purpose}`);
      console.log(`  Wrote to .wisegit/branch-contexts.jsonl`);
    } else {
      console.log("HEAD is not a merge commit. Nothing to capture.");
    }
  } catch (err) {
    logger.error("Branch capture failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}

export async function branchListCommand(options: {
  path?: string;
}): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    const snapshots = getBranchSnapshots(repoPath, db);
    if (snapshots.length === 0) {
      console.log("No branch snapshots captured yet.");
      console.log("Run: wisegit hook install (then branch snapshots are captured on merge)");
      return;
    }

    console.log(`Branch snapshots (${snapshots.length}):\n`);
    for (const s of snapshots) {
      console.log(`  ${s.branch} \u2192 ${s.mergedInto}  [${s.mergedAt.slice(0, 10)}]`);
      console.log(`    ${s.commitCount} commits, ${s.filesChanged.length} files`);
      if (s.purpose) console.log(`    Purpose: ${s.purpose}`);
      console.log();
    }
  } catch (err) {
    logger.error("Branch list failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}

export async function branchRecoverCommand(
  sha: string,
  options: { path?: string }
): Promise<void> {
  const repoPath = resolve(options.path ?? process.cwd());
  const db = getDb();

  try {
    const snapshot = await recoverBranchContext(repoPath, db, sha);
    if (snapshot) {
      console.log(`Branch context recovered from ${sha.slice(0, 7)}:`);
      console.log(`  Branch:   ${snapshot.branch}`);
      console.log(`  Merged:   ${snapshot.mergedInto}`);
      console.log(`  Files:    ${snapshot.filesChanged.length}`);
      console.log(`  Commits:  ${snapshot.commitCount}`);
    } else {
      console.log(`${sha.slice(0, 7)} is not a merge commit. Nothing to recover.`);
    }
  } catch (err) {
    logger.error("Branch recover failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    closeDb();
  }
}
