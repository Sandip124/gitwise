import Database from "better-sqlite3";
import { logger } from "../shared/logger.js";
import { loadIgnorePaths, shouldIgnorePath } from "../shared/path-filter.js";

export interface TheoryHolder {
  author: string;
  commitCount: number;
  lastActive: string;
  isActive: boolean; // Active = committed in last 6 months
}

export interface FunctionTheory {
  functionId: string;
  functionName: string;
  filePath: string;
  holders: TheoryHolder[];
  activeCount: number;
  totalCount: number;
  riskLevel: "healthy" | "fragile" | "critical"; // 2+, 1, 0 active holders
}

/**
 * Compute theory holders for a function — who on the team
 * understands why this code exists.
 *
 * Per Naur [2]: "The death of a program happens when the team
 * possessing its theory is dissolved."
 *
 * More active holders = safer to modify (theory is distributed).
 * Zero holders = full Naur death (highest risk).
 */
export function getTheoryHolders(
  db: Database.Database,
  repoPath: string,
  functionId: string
): FunctionTheory {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const rows = db
    .prepare(
      `SELECT author, COUNT(*) as commit_count, MAX(authored_at) as last_active
       FROM decision_events
       WHERE function_id = ? AND repo_path = ? AND author IS NOT NULL
       GROUP BY author
       ORDER BY commit_count DESC`
    )
    .all(functionId, repoPath) as {
    author: string;
    commit_count: number;
    last_active: string;
  }[];

  const holders: TheoryHolder[] = rows.map((r) => ({
    author: r.author,
    commitCount: r.commit_count,
    lastActive: r.last_active,
    isActive: new Date(r.last_active) > sixMonthsAgo,
  }));

  const activeCount = holders.filter((h) => h.isActive).length;
  const parsed = functionId.split("::");
  const filePath = parsed[0]?.replace("file:", "") ?? "";
  const functionName = parsed[1]?.replace("function:", "") ?? functionId;

  return {
    functionId,
    functionName,
    filePath,
    holders,
    activeCount,
    totalCount: holders.length,
    riskLevel:
      activeCount >= 2 ? "healthy" : activeCount === 1 ? "fragile" : "critical",
  };
}

/**
 * Get theory distribution index for all functions in a file.
 */
export function getFileTheoryDistribution(
  db: Database.Database,
  repoPath: string,
  filePath: string
): FunctionTheory[] {
  const functionIds = (
    db
      .prepare(
        `SELECT DISTINCT function_id FROM decision_events
         WHERE repo_path = ? AND file_path = ? AND function_id IS NOT NULL`
      )
      .all(repoPath, filePath) as { function_id: string }[]
  ).map((r) => r.function_id);

  return functionIds.map((fid) => getTheoryHolders(db, repoPath, fid));
}

/**
 * Get repo-wide theory health summary.
 */
export function getRepoTheoryHealth(
  db: Database.Database,
  repoPath: string
): {
  total: number;
  healthy: number;
  fragile: number;
  critical: number;
  topRisks: FunctionTheory[];
} {
  const ignorePaths = loadIgnorePaths(repoPath);

  const allFunctions = (
    db
      .prepare(
        `SELECT DISTINCT function_id, file_path FROM decision_events
         WHERE repo_path = ? AND function_id IS NOT NULL`
      )
      .all(repoPath) as { function_id: string; file_path: string }[]
  ).filter((r) => !shouldIgnorePath(r.file_path, ignorePaths)).map((r) => r.function_id);

  let healthy = 0;
  let fragile = 0;
  let critical = 0;
  const criticalFunctions: FunctionTheory[] = [];

  for (const fid of allFunctions) {
    const theory = getTheoryHolders(db, repoPath, fid);
    switch (theory.riskLevel) {
      case "healthy":
        healthy++;
        break;
      case "fragile":
        fragile++;
        break;
      case "critical":
        critical++;
        criticalFunctions.push(theory);
        break;
    }
  }

  // Sort critical by total commits (most impactful first)
  criticalFunctions.sort(
    (a, b) =>
      b.holders.reduce((s, h) => s + h.commitCount, 0) -
      a.holders.reduce((s, h) => s + h.commitCount, 0)
  );

  return {
    total: allFunctions.length,
    healthy,
    fragile,
    critical,
    topRisks: criticalFunctions.slice(0, 10),
  };
}
