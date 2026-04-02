import Database from "better-sqlite3";
import { logger } from "../shared/logger.js";
import { loadIgnorePaths, shouldIgnorePath } from "../shared/path-filter.js";

export interface TheoryHolder {
  author: string;
  commitCount: number;
  lastActive: string;
  isActive: boolean;  // Active = committed in last 6 months
  expertise: number;  // 0-1: DOE (Degree of Expertise) score
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

  // DOE (Degree of Expertise) model — Cury et al. (2024)
  // 4 variables: lines contributed (approx via commit count), file authorship,
  // recency (days since last contribution), contribution density.
  // More accurate than binary active/inactive for expertise estimation.
  const rows = db
    .prepare(
      `SELECT author,
        COUNT(*) as commit_count,
        MAX(authored_at) as last_active,
        MIN(authored_at) as first_active,
        COUNT(DISTINCT commit_sha) as distinct_commits
       FROM decision_events
       WHERE function_id = ? AND repo_path = ? AND author IS NOT NULL
       GROUP BY author
       ORDER BY commit_count DESC`
    )
    .all(functionId, repoPath) as {
    author: string;
    commit_count: number;
    last_active: string;
    first_active: string;
    distinct_commits: number;
  }[];

  // Total commits across all authors (for relative contribution)
  const totalCommits = rows.reduce((s, r) => s + r.commit_count, 0);

  const holders: TheoryHolder[] = rows.map((r) => {
    const lastActiveDate = new Date(r.last_active);
    const isActive = lastActiveDate > sixMonthsAgo;

    // DOE score: weighted combination of 4 factors
    // 1. Contribution share (how much of this function's history is theirs)
    const contributionShare = totalCommits > 0 ? r.commit_count / totalCommits : 0;

    // 2. Recency (exponential decay: recent contributions count more)
    const daysSinceActive = Math.max(0, (Date.now() - lastActiveDate.getTime()) / (24 * 60 * 60 * 1000));
    const recency = Math.exp(-daysSinceActive / 365); // Half-life ~1 year

    // 3. Duration (longer engagement = deeper knowledge)
    const firstDate = new Date(r.first_active);
    const engagementDays = Math.max(1, (lastActiveDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
    const duration = Math.min(engagementDays / 365, 1.0); // Cap at 1 year

    // 4. Frequency (commits per month of engagement)
    const monthsEngaged = Math.max(1, engagementDays / 30);
    const frequency = Math.min(r.distinct_commits / monthsEngaged / 5, 1.0); // Normalized: 5/month = max

    // Weighted DOE: contribution 0.3, recency 0.35, duration 0.2, frequency 0.15
    const expertise = Math.min(
      contributionShare * 0.30 + recency * 0.35 + duration * 0.20 + frequency * 0.15,
      1.0
    );

    return {
      author: r.author,
      commitCount: r.commit_count,
      lastActive: r.last_active,
      isActive,
      expertise,
    };
  });

  const activeCount = holders.filter((h) => h.isActive).length;
  const parsed = functionId.split("::");
  const filePath = parsed[0]?.replace("file:", "") ?? "";
  const functionName = parsed[1]?.replace("function:", "") ?? functionId;

  // Risk level uses DOE expertise: sum of expertise scores of active holders
  const totalExpertise = holders.filter(h => h.isActive).reduce((s, h) => s + h.expertise, 0);
  const riskLevel: "healthy" | "fragile" | "critical" =
    totalExpertise >= 0.5 ? "healthy" :   // Strong combined expertise
    totalExpertise > 0.1 ? "fragile" :     // Some expertise remains
    activeCount > 0 ? "fragile" :          // Active but low expertise
    "critical";                            // No active holders at all

  return {
    functionId,
    functionName,
    filePath,
    holders,
    activeCount,
    totalCount: holders.length,
    riskLevel,
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
