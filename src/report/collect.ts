import Database from "better-sqlite3";
import { getRepoTheoryHealth } from "../graph/theory-holders.js";
import { detectCommitOrigin, CommitOrigin } from "../core/commit-origin.js";
import { loadIgnorePaths, shouldIgnorePath } from "../shared/path-filter.js";

export interface ReportData {
  repoPath: string;
  generatedAt: string;
  branch: string;

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

  // Dependency graph edges (for force-directed graph)
  dependencyEdges: { source: string; target: string }[];

  // File-level aggregates (for treemap)
  fileScores: { file: string; avgScore: number; functions: number; events: number; theoryRisk: string }[];

  // Freeze score histogram buckets (for distribution chart)
  scoreHistogram: { bucket: string; count: number }[];

  // Commit classification breakdown (for timeline enhancement)
  classificationBreakdown: { classification: string; count: number }[];

  // Contributor-file matrix (who knows what)
  contributorFiles: { author: string; file: string; commits: number }[];

  // Individual commits with classification (for commit explorer)
  commits: {
    sha: string;
    message: string;
    author: string;
    date: string;
    classification: string;
    functionsAffected: number;
  }[];

  // All functions with scores (for expandable theory health)
  allFunctions: {
    name: string;
    file: string;
    score: number;
    events: number;
    theoryRisk: string;
    holders: number;
    activeHolders: number;
  }[];

  // Folder structure (for tree view)
  folderTree: { path: string; files: number; functions: number; avgScore: number; children?: string[]; fileList?: string[] }[];

  // Per-file decision events (ALL events, paginated in UI)
  fileEvents: { file: string; events: { sha: string; message: string; author: string; date: string; classification: string }[] }[];
}

import { execFileSync } from "node:child_process";

export function collectReportData(
  db: Database.Database,
  repoPath: string
): ReportData {
  const now = new Date().toISOString();
  const ignorePaths = loadIgnorePaths(repoPath);
  const isIgnored = (fp: string) => shouldIgnorePath(fp, ignorePaths);

  // Detect current branch
  let branch = "unknown";
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }).toString().trim();
  } catch { /* not a git repo or git not available */ }

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

  // Freeze score distribution (filtered by ignore_paths)
  const allScores = db.prepare(`SELECT score, file_path FROM freeze_scores WHERE repo_path = ?`).all(repoPath) as { score: number; file_path: string }[];
  const scores = allScores.filter(s => !isIgnored(s.file_path));
  const freezeDistribution = { frozen: 0, stable: 0, open: 0 };
  for (const { score } of scores) {
    if (score >= 0.80) freezeDistribution.frozen++;
    else if (score >= 0.50) freezeDistribution.stable++;
    else freezeDistribution.open++;
  }

  // Top frozen functions (filtered)
  const topFrozen = (
    db.prepare(`SELECT function_id, function_name, file_path, score FROM freeze_scores WHERE repo_path = ? ORDER BY score DESC LIMIT 50`).all(repoPath) as { function_id: string; function_name: string; file_path: string; score: number }[]
  ).filter(r => !isIgnored(r.file_path)).slice(0, 15).map(r => ({ functionId: r.function_id, name: r.function_name, file: r.file_path, score: r.score }));

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

  // Top files by event count (filtered)
  const topFiles = (
    db.prepare(`
      SELECT file_path, COUNT(*) as events, COUNT(DISTINCT function_id) as functions
      FROM decision_events
      WHERE repo_path = ? GROUP BY file_path ORDER BY events DESC LIMIT 50
    `).all(repoPath) as { file_path: string; events: number; functions: number }[]
  ).filter(r => !isIgnored(r.file_path)).slice(0, 15).map(r => ({ file: r.file_path, events: r.events, functions: r.functions }));

  // PageRank top functions (filtered)
  const topPageRank = (
    db.prepare(`SELECT function_name, file_path, pagerank FROM freeze_scores WHERE repo_path = ? AND pagerank > 0 ORDER BY pagerank DESC LIMIT 30`).all(repoPath) as { function_name: string; file_path: string; pagerank: number }[]
  ).filter(r => !isIgnored(r.file_path)).slice(0, 10).map(r => ({ name: r.function_name, file: r.file_path, score: r.pagerank }));

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

  // Dependency graph edges (top 100 for visualization)
  const dependencyEdges = (
    db.prepare(`
      SELECT DISTINCT de1.function_name as source, de2.function_name as target
      FROM decision_events de1
      JOIN decision_events de2 ON de1.commit_sha = de2.commit_sha
        AND de1.function_id != de2.function_id
        AND de1.repo_path = de2.repo_path
      WHERE de1.repo_path = ?
        AND de1.function_name IS NOT NULL
        AND de2.function_name IS NOT NULL
      LIMIT 150
    `).all(repoPath) as { source: string; target: string }[]
  );

  // File-level aggregates (single grouped query instead of N+1)
  const eventCountsByFile = new Map<string, number>(
    (db.prepare(`
      SELECT file_path, COUNT(*) as cnt
      FROM decision_events WHERE repo_path = ?
      GROUP BY file_path
    `).all(repoPath) as { file_path: string; cnt: number }[]).map(r => [r.file_path, r.cnt])
  );
  const fileScores = (
    db.prepare(`
      SELECT fs.file_path, AVG(fs.score) as avg_score,
        COUNT(*) as functions, fs.theory_gap
      FROM freeze_scores fs
      WHERE fs.repo_path = ?
      GROUP BY fs.file_path
      ORDER BY avg_score DESC
    `).all(repoPath) as { file_path: string; avg_score: number; functions: number; theory_gap: number }[]
  ).filter(r => !isIgnored(r.file_path)).map(r => ({
    file: r.file_path,
    avgScore: r.avg_score,
    functions: r.functions,
    events: eventCountsByFile.get(r.file_path) ?? 0,
    theoryRisk: r.theory_gap ? "critical" : r.avg_score >= 0.5 ? "stable" : "open",
  }));

  // Freeze score histogram (uses already-filtered `scores` array for consistency)
  const scoreHistogram: { bucket: string; count: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const count = scores.filter(s => s.score >= lo && (hi === 1.0 ? s.score <= hi : s.score < hi)).length;
    scoreHistogram.push({ bucket: `${lo.toFixed(1)}–${hi.toFixed(1)}`, count });
  }

  // Commit classification breakdown (filtered by ignore_paths)
  const rawClassification = db.prepare(`
    SELECT classification, file_path
    FROM decision_events
    WHERE repo_path = ? AND classification IS NOT NULL
  `).all(repoPath) as { classification: string; file_path: string }[];
  const clsCounts = new Map<string, number>();
  for (const r of rawClassification) {
    if (r.file_path && isIgnored(r.file_path)) continue;
    clsCounts.set(r.classification, (clsCounts.get(r.classification) ?? 0) + 1);
  }
  const classificationBreakdown = [...clsCounts.entries()]
    .map(([classification, count]) => ({ classification, count }))
    .sort((a, b) => b.count - a.count);

  // Contributor-file matrix (filtered)
  const contributorFiles = (
    db.prepare(`
      SELECT author, file_path, COUNT(DISTINCT commit_sha) as commits
      FROM decision_events
      WHERE repo_path = ? AND author IS NOT NULL
      GROUP BY author, file_path
      ORDER BY commits DESC LIMIT 100
    `).all(repoPath) as { author: string; file_path: string; commits: number }[]
  ).filter(r => !isIgnored(r.file_path)).slice(0, 50).map(r => ({ author: r.author, file: r.file_path, commits: r.commits }));

  // Individual commits with classification (filtered by ignore_paths)
  const rawCommits = db.prepare(`
    SELECT commit_sha, commit_message, author, authored_at, classification,
      file_path, COUNT(DISTINCT function_id) as functions_affected
    FROM decision_events
    WHERE repo_path = ? AND commit_message IS NOT NULL
    GROUP BY commit_sha
    ORDER BY authored_at DESC
    LIMIT 500
  `).all(repoPath) as { commit_sha: string; commit_message: string; author: string; authored_at: string; classification: string; file_path: string; functions_affected: number }[];
  const commits = rawCommits
    .filter(r => r.commit_message && (!r.file_path || !isIgnored(r.file_path)))
    .slice(0, 200)
    .map(r => ({
      sha: r.commit_sha.slice(0, 7),
      message: r.commit_message.split("\n")[0].slice(0, 120),
      author: r.author ?? "unknown",
      date: r.authored_at?.slice(0, 10) ?? "",
      classification: r.classification ?? "UNKNOWN",
      functionsAffected: r.functions_affected,
    }));

  // All functions with scores (for expandable health lists)
  const allFunctionsDetailed = (
    db.prepare(`
      SELECT function_name, file_path, score, theory_gap, pagerank
      FROM freeze_scores WHERE repo_path = ?
      ORDER BY score DESC
    `).all(repoPath) as { function_name: string; file_path: string; score: number; theory_gap: number; pagerank: number }[]
  ).filter(r => !isIgnored(r.file_path)).map(r => ({
    name: r.function_name,
    file: r.file_path,
    score: r.score,
    events: 0,
    theoryRisk: r.theory_gap ? "critical" : r.score >= 0.5 ? "stable" : "open",
    holders: 0,
    activeHolders: 0,
  }));

  // Folder structure for tree view
  const folderMap = new Map<string, { files: Set<string>; functions: number; totalScore: number }>();
  for (const fs of fileScores) {
    const parts = fs.file.split("/");
    for (let i = 1; i <= parts.length - 1; i++) {
      const folder = parts.slice(0, i).join("/");
      const existing = folderMap.get(folder) ?? { files: new Set(), functions: 0, totalScore: 0 };
      existing.files.add(fs.file);
      existing.functions += fs.functions;
      existing.totalScore += fs.avgScore * fs.functions;
      folderMap.set(folder, existing);
    }
  }
  // Build children lists for collapsible tree
  const allFolders = [...folderMap.keys()].sort();
  const childrenMap = new Map<string, string[]>();
  for (const folder of allFolders) {
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : null;
    if (parent && folderMap.has(parent)) {
      const existing = childrenMap.get(parent) ?? [];
      existing.push(folder);
      childrenMap.set(parent, existing);
    }
  }

  // Build file lists for leaf folders (direct files only)
  const folderFileList = new Map<string, string[]>();
  for (const fs of fileScores) {
    const parts = fs.file.split("/");
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join("/");
      const list = folderFileList.get(parent) ?? [];
      list.push(fs.file);
      folderFileList.set(parent, list);
    }
  }

  const folderTree = [...folderMap.entries()]
    .map(([path, data]) => ({
      path,
      files: data.files.size,
      functions: data.functions,
      avgScore: data.functions > 0 ? data.totalScore / data.functions : 0,
      children: childrenMap.get(path) ?? [],
      fileList: folderFileList.get(path) ?? [],
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Per-file decision events (ALL events, no limit — paginated in UI)
  const fileEvents = topFiles.slice(0, 15).map(f => {
    const evts = (
      db.prepare(`
        SELECT DISTINCT commit_sha, commit_message, author, authored_at, classification
        FROM decision_events
        WHERE file_path = ? AND repo_path = ? AND commit_message IS NOT NULL
        ORDER BY authored_at DESC
      `).all(f.file, repoPath) as { commit_sha: string; commit_message: string; author: string; authored_at: string; classification: string }[]
    ).map(e => ({
      sha: e.commit_sha.slice(0, 7),
      message: e.commit_message.split("\n")[0].slice(0, 100),
      author: e.author ?? "unknown",
      date: e.authored_at?.slice(0, 10) ?? "",
      classification: e.classification ?? "UNKNOWN",
    }));
    return { file: f.file, events: evts };
  });

  return {
    repoPath,
    generatedAt: now,
    branch,
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
    dependencyEdges,
    fileScores,
    scoreHistogram,
    classificationBreakdown,
    contributorFiles,
    commits,
    allFunctions: allFunctionsDetailed,
    folderTree,
    fileEvents,
  };
}
