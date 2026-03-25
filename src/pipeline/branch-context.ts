import Database from "better-sqlite3";
import { simpleGit } from "simple-git";
import { randomUUID } from "node:crypto";
import { EventStore } from "../db/event-store.js";
import { EventType, DecisionEvent, IntentSource, IntentConfidence } from "../core/types.js";
import { logger } from "../shared/logger.js";

export interface BranchSnapshot {
  branch: string;
  mergedInto: string;
  mergedAt: string;
  purpose: string;
  filesChanged: string[];
  commitCount: number;
}

/**
 * Create a migration table for branch snapshots if it doesn't exist.
 */
function ensureBranchTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branch_snapshots (
      id           TEXT PRIMARY KEY,
      repo_path    TEXT NOT NULL,
      branch       TEXT NOT NULL,
      merged_into  TEXT NOT NULL,
      merged_at    TEXT DEFAULT (datetime('now')),
      purpose      TEXT,
      files_changed TEXT DEFAULT '[]',
      commit_count INTEGER DEFAULT 0,
      metadata     TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_branch_repo ON branch_snapshots(repo_path);
    CREATE INDEX IF NOT EXISTS idx_branch_name ON branch_snapshots(branch);
  `);
}

/**
 * Capture branch context at merge time.
 *
 * Per Ying et al. [5]: cross-language/cross-platform dependencies are most
 * "surprising" and hardest to find by static analysis. Branch manifests
 * capture these decisions before the branch is deleted.
 *
 * Per Aryani et al. [9]: domain-based coupling predicts 77% of database
 * dependencies in hybrid/legacy systems.
 */
export async function captureBranchContext(
  repoPath: string,
  db: Database.Database,
  mergeCommitSha?: string
): Promise<BranchSnapshot | null> {
  ensureBranchTable(db);

  const git = simpleGit(repoPath);

  try {
    // Get the merge commit (default: HEAD)
    const sha = mergeCommitSha ?? (await git.revparse(["HEAD"])).trim();

    // Check if it's actually a merge commit (2+ parents)
    const parents = (
      await git.raw(["rev-list", "--parents", "-1", sha])
    ).trim().split(/\s+/);

    if (parents.length < 3) {
      // Not a merge commit
      return null;
    }

    const mergedBranchSha = parents[2]; // Second parent = merged branch

    // Try to find the branch name from the commit message
    const log = await git.log(["-1", sha]);
    const mergeMsg = log.latest?.message ?? "";
    const branchMatch = mergeMsg.match(
      /Merge (?:branch|pull request[^']*) '?([^'"\s]+)/
    );
    const branchName = branchMatch?.[1] ?? `branch-${mergedBranchSha.slice(0, 7)}`;

    // Get the current branch (merge target)
    let currentBranch: string;
    try {
      currentBranch = (
        await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])
      ).trim();
    } catch {
      currentBranch = "unknown";
    }

    // Get files changed in the merge
    const diffOutput = await git.raw([
      "diff",
      "--name-only",
      `${parents[1]}...${mergedBranchSha}`,
    ]);
    const filesChanged = diffOutput
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    // Count commits in the merged branch
    let commitCount = 0;
    try {
      const countOutput = await git.raw([
        "rev-list",
        "--count",
        `${parents[1]}..${mergedBranchSha}`,
      ]);
      commitCount = parseInt(countOutput.trim(), 10) || 0;
    } catch {
      commitCount = 0;
    }

    // Determine purpose from merge commit message
    const purpose = mergeMsg.replace(/^Merge\s+/, "").trim();

    const snapshot: BranchSnapshot = {
      branch: branchName,
      mergedInto: currentBranch,
      mergedAt: new Date().toISOString(),
      purpose,
      filesChanged,
      commitCount,
    };

    // Store in branch_snapshots table
    db.prepare(
      `INSERT INTO branch_snapshots
        (id, repo_path, branch, merged_into, purpose, files_changed, commit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      repoPath,
      snapshot.branch,
      snapshot.mergedInto,
      snapshot.purpose,
      JSON.stringify(snapshot.filesChanged),
      snapshot.commitCount
    );

    // Emit BRANCH_SNAPSHOT events for affected files
    const eventStore = new EventStore(db);
    const events: DecisionEvent[] = filesChanged.slice(0, 100).map((filePath) => ({
      repoPath,
      commitSha: sha,
      eventType: EventType.BRANCH_SNAPSHOT,
      functionId: null,
      filePath,
      functionName: null,
      commitMessage: mergeMsg,
      author: log.latest?.author_name ?? null,
      authoredAt: new Date(),
      classification: null,
      intent: `Branch "${branchName}" merged: ${purpose}`,
      intentSource: IntentSource.RULE,
      confidence: IntentConfidence.HIGH,
      metadata: {
        branch: branchName,
        mergedInto: currentBranch,
        commitCount,
      },
    }));

    if (events.length > 0) {
      eventStore.appendEvents(events);
    }

    logger.info(
      `Branch context captured: "${branchName}" → ${currentBranch} (${filesChanged.length} files, ${commitCount} commits)`
    );

    return snapshot;
  } catch (err) {
    logger.warn(
      `Failed to capture branch context: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Recover branch context from an existing merge commit.
 */
export async function recoverBranchContext(
  repoPath: string,
  db: Database.Database,
  mergeCommitSha: string
): Promise<BranchSnapshot | null> {
  return captureBranchContext(repoPath, db, mergeCommitSha);
}

/**
 * Get all branch snapshots for a repo.
 */
export function getBranchSnapshots(
  repoPath: string,
  db: Database.Database
): BranchSnapshot[] {
  ensureBranchTable(db);

  return (
    db
      .prepare(
        `SELECT * FROM branch_snapshots WHERE repo_path = ? ORDER BY merged_at DESC`
      )
      .all(repoPath) as Record<string, unknown>[]
  ).map((row) => ({
    branch: row.branch as string,
    mergedInto: row.merged_into as string,
    mergedAt: row.merged_at as string,
    purpose: (row.purpose as string) ?? "",
    filesChanged: JSON.parse((row.files_changed as string) ?? "[]"),
    commitCount: (row.commit_count as number) ?? 0,
  }));
}
