import Database from "better-sqlite3";
import { getRepoTheoryHealth } from "../graph/theory-holders.js";
import { detectCommitOrigin, CommitOrigin } from "../core/commit-origin.js";

export interface ReportData {
  repoPath: string;
  generatedAt: string;

  // Overview
  totalCommits: number;
  totalEvents: number;
  totalFunctions: number;
  totalFiles: number;
  languages: { language: string; count: number }[];

  // Freeze score distribution
  freezeDistribution: {
    frozen: number;   // >= 0.80
    stable: number;   // 0.50–0.79
    open: number;     // < 0.50
  };
  topFrozen: { functionId: string; name: string; file: string; score: number }[];

  // Theory health
  theoryHealth: {
    healthy: number;
    fragile: number;
    critical: number;
  };
  topRisks: { functionId: string; name: string; file: string; holders: number; activeHolders: number }[];

  // Timeline (events per month)
  timeline: { month: string; events: number }[];

  // AI vs Human
  originBreakdown: { origin: CommitOrigin; count: number }[];

  // Top files by event count
  topFiles: { file: string; events: number; functions: number }[];

  // PageRank top functions
  topPageRank: { name: string; file: string; score: number }[];

  // Contributors
  contributors: { author: string; commits: number; lastActive: string; isActive: boolean }[];
}

export function collectReportData(
  db: Database.Database,
  repoPath: string
): ReportData {
  const now = new Date().toISOString();

  // Overview counts
  const totalCommits = (
    db.prepare(`SELECT COUNT(DISTINCT commit_sha) as cnt FROM decision_events WHERE repo_path = ?`).get(repoPath) as { cnt: number }
  ).cnt;

  const totalEvents = (
    db.prepare(`SELECT COUNT(*) as cnt FROM decision_events WHERE repo_path = ?`).get(repoPath) as { cnt: number }
  ).cnt;

  const totalFunctions = (
    db.prepare(`SELECT COUNT(DISTINCT function_id) as cnt FROM decision_events WHERE repo_path = ? AND function_id IS NOT NULL`).get(repoPath) as { cnt: number }
  ).cnt;

  const totalFiles = (
    db.prepare(`SELECT COUNT(DISTINCT file_path) as cnt FROM decision_events WHERE repo_path = ?`).get(repoPath) as { cnt: number }
  ).cnt;

  // Languages
  const languages = (
    db.prepare(`SELECT language, COUNT(*) as count FROM function_chunks WHERE repo_path = ? GROUP BY language ORDER BY count DESC`).all(repoPath) as { language: string; count: number }[]
  );

  // Freeze score distribution
  const scores = db.prepare(`SELECT score FROM freeze_scores WHERE repo_path = ?`).all(repoPath) as { score: number }[];
  const freezeDistribution = { frozen: 0, stable: 0, open: 0 };
  for (const { score } of scores) {
    if (score >= 0.80) freezeDistribution.frozen++;
    else if (score >= 0.50) freezeDistribution.stable++;
    else freezeDistribution.open++;
  }

  // Top frozen functions
  const topFrozen = (
    db.prepare(`SELECT function_id, function_name, file_path, score FROM freeze_scores WHERE repo_path = ? ORDER BY score DESC LIMIT 15`).all(repoPath) as { function_id: string; function_name: string; file_path: string; score: number }[]
  ).map(r => ({ functionId: r.function_id, name: r.function_name, file: r.file_path, score: r.score }));

  // Theory health
  const health = getRepoTheoryHealth(db, repoPath);

  const topRisks = health.topRisks.slice(0, 10).map(r => ({
    functionId: r.functionId,
    name: r.functionName,
    file: r.filePath,
    holders: r.totalCount,
    activeHolders: r.activeCount,
  }));

  // Timeline (events per month)
  const timeline = (
    db.prepare(`
      SELECT strftime('%Y-%m', authored_at) as month, COUNT(*) as events
      FROM decision_events
      WHERE repo_path = ? AND authored_at IS NOT NULL
      GROUP BY month ORDER BY month
    `).all(repoPath) as { month: string; events: number }[]
  );

  // AI vs Human origin breakdown
  const allAuthors = db.prepare(
    `SELECT author, commit_message FROM decision_events WHERE repo_path = ? AND author IS NOT NULL`
  ).all(repoPath) as { author: string; commit_message: string }[];

  const originCounts = new Map<CommitOrigin, number>();
  for (const row of allAuthors) {
    const origin = detectCommitOrigin(row.author, repoPath, row.commit_message);
    originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);
  }
  const originBreakdown = [...originCounts.entries()].map(([origin, count]) => ({ origin, count }));

  // Top files by event count
  const topFiles = (
    db.prepare(`
      SELECT file_path, COUNT(*) as events, COUNT(DISTINCT function_id) as functions
      FROM decision_events
      WHERE repo_path = ? GROUP BY file_path ORDER BY events DESC LIMIT 15
    `).all(repoPath) as { file_path: string; events: number; functions: number }[]
  ).map(r => ({ file: r.file_path, events: r.events, functions: r.functions }));

  // PageRank top functions
  const topPageRank = (
    db.prepare(`SELECT function_name, file_path, pagerank FROM freeze_scores WHERE repo_path = ? AND pagerank > 0 ORDER BY pagerank DESC LIMIT 10`).all(repoPath) as { function_name: string; file_path: string; pagerank: number }[]
  ).map(r => ({ name: r.function_name, file: r.file_path, score: r.pagerank }));

  // Contributors
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const contributors = (
    db.prepare(`
      SELECT author, COUNT(DISTINCT commit_sha) as commits, MAX(authored_at) as last_active
      FROM decision_events WHERE repo_path = ? AND author IS NOT NULL
      GROUP BY author ORDER BY commits DESC
    `).all(repoPath) as { author: string; commits: number; last_active: string }[]
  ).map(r => ({
    author: r.author,
    commits: r.commits,
    lastActive: r.last_active,
    isActive: new Date(r.last_active) > sixMonthsAgo,
  }));

  return {
    repoPath,
    generatedAt: now,
    totalCommits,
    totalEvents,
    totalFunctions,
    totalFiles,
    languages,
    freezeDistribution,
    topFrozen,
    theoryHealth: { healthy: health.healthy, fragile: health.fragile, critical: health.critical },
    topRisks,
    timeline,
    originBreakdown,
    topFiles,
    topPageRank,
    contributors,
  };
}
