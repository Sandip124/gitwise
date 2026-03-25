import Database from "better-sqlite3";
import { DecisionEvent, EventType } from "../core/types.js";
import { logger } from "../shared/logger.js";

export interface TheoryGap {
  functionId: string;
  functionName: string;
  filePath: string;
  reasons: string[];
  recoveryLevel: "L1" | "L2" | "L3";
}

/**
 * Detect theory gaps — functions where the original decision rationale
 * may be partially or fully unrecoverable.
 *
 * Per Naur [2]: "The death of a program happens when the team possessing
 * its theory is dissolved."
 *
 * Per Aranda & Venolia [3]: 4-level recovery framework. Level 4 (direct
 * participant interviews) is structurally unrecoverable by automation.
 *
 * Signals:
 * 1. Primary author inactive (Naur death signal)
 * 2. Timeline discontinuities (events with no electronic trace)
 * 3. "Forgotten" pattern: burst of activity + 12mo silence without resolution
 */
export function detectTheoryGaps(
  repoPath: string,
  db: Database.Database
): TheoryGap[] {
  const gaps: TheoryGap[] = [];

  // Get all distinct functions with their events
  const functions = db
    .prepare(
      `SELECT DISTINCT function_id, file_path, function_name
       FROM decision_events
       WHERE repo_path = ? AND function_id IS NOT NULL`
    )
    .all(repoPath) as {
    function_id: string;
    file_path: string;
    function_name: string;
  }[];

  // Get the set of "active" authors — anyone who committed in the last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const activeAuthors = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT author FROM decision_events
           WHERE repo_path = ? AND authored_at > ?`
        )
        .all(repoPath, sixMonthsAgo.toISOString()) as { author: string }[]
    ).map((r) => r.author)
  );

  for (const fn of functions) {
    const events = db
      .prepare(
        `SELECT * FROM decision_events
         WHERE function_id = ? AND repo_path = ?
         ORDER BY authored_at ASC`
      )
      .all(fn.function_id, repoPath) as Record<string, unknown>[];

    if (events.length === 0) continue;

    const reasons: string[] = [];

    // 1. Naur death signal — primary author no longer active
    const authorCounts = new Map<string, number>();
    for (const e of events) {
      const author = e.author as string;
      if (author) {
        authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
      }
    }

    let primaryAuthor: string | null = null;
    let maxCount = 0;
    for (const [author, count] of authorCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryAuthor = author;
      }
    }

    if (primaryAuthor && !activeAuthors.has(primaryAuthor)) {
      // Find how long they've been inactive
      const lastActive = db
        .prepare(
          `SELECT MAX(authored_at) as last_date FROM decision_events
           WHERE author = ? AND repo_path = ?`
        )
        .get(primaryAuthor, repoPath) as { last_date: string } | undefined;

      const monthsInactive = lastActive?.last_date
        ? Math.floor(
            (Date.now() - new Date(lastActive.last_date).getTime()) /
              (30 * 24 * 60 * 60 * 1000)
          )
        : 0;

      if (monthsInactive >= 6) {
        reasons.push(
          `Primary author ${primaryAuthor} inactive ${monthsInactive} months [Naur death signal]`
        );
      }
    }

    // 2. Timeline discontinuities — large gaps with no events
    const dates = events
      .map((e) => e.authored_at as string)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .sort((a, b) => a - b);

    for (let i = 1; i < dates.length; i++) {
      const gapMonths =
        (dates[i] - dates[i - 1]) / (30 * 24 * 60 * 60 * 1000);
      if (gapMonths > 12) {
        reasons.push(
          `${Math.floor(gapMonths)} month gap in activity history [timeline discontinuity]`
        );
        break; // Report once
      }
    }

    // 3. "Forgotten" pattern — burst of activity then 12+ months silence
    if (dates.length >= 3) {
      const lastEvent = dates[dates.length - 1];
      const monthsSinceLastEvent =
        (Date.now() - lastEvent) / (30 * 24 * 60 * 60 * 1000);

      // Had activity (3+ events) but nothing for 12+ months
      if (monthsSinceLastEvent > 12) {
        reasons.push(
          `No activity for ${Math.floor(monthsSinceLastEvent)} months after ${events.length} events [forgotten pattern]`
        );
      }
    }

    if (reasons.length > 0) {
      gaps.push({
        functionId: fn.function_id,
        functionName: fn.function_name,
        filePath: fn.file_path,
        reasons,
        recoveryLevel: reasons.some((r) => r.includes("Naur death"))
          ? "L2"
          : "L3",
      });
    }
  }

  logger.info(`Theory gaps detected: ${gaps.length}`);
  return gaps;
}

/**
 * Detect co-change patterns — files that frequently change together.
 *
 * Per Ying et al. [5]: files changed together reveal dependencies
 * that static analysis cannot find.
 * Per Aryani et al. [9]: domain-level coupling predicts 65% of
 * source code dependencies.
 */
export function detectCoChangeSignals(
  repoPath: string,
  db: Database.Database
): Map<string, number> {
  // Find files that co-change with frozen/high-score functions
  const coChangeScores = new Map<string, number>();

  // Get all commits with their changed files
  const commitFiles = db
    .prepare(
      `SELECT commit_sha, file_path, function_id
       FROM decision_events
       WHERE repo_path = ? AND function_id IS NOT NULL
       GROUP BY commit_sha, function_id`
    )
    .all(repoPath) as {
    commit_sha: string;
    file_path: string;
    function_id: string;
  }[];

  // Group by commit
  const byCommit = new Map<string, Set<string>>();
  for (const row of commitFiles) {
    const existing = byCommit.get(row.commit_sha) ?? new Set();
    existing.add(row.function_id);
    byCommit.set(row.commit_sha, existing);
  }

  // Count co-occurrences between function pairs
  const coOccurrences = new Map<string, Map<string, number>>();

  for (const functions of byCommit.values()) {
    const fns = [...functions];
    for (let i = 0; i < fns.length; i++) {
      for (let j = i + 1; j < fns.length; j++) {
        const a = fns[i];
        const b = fns[j];

        if (!coOccurrences.has(a)) coOccurrences.set(a, new Map());
        if (!coOccurrences.has(b)) coOccurrences.set(b, new Map());

        const mapA = coOccurrences.get(a)!;
        const mapB = coOccurrences.get(b)!;

        mapA.set(b, (mapA.get(b) ?? 0) + 1);
        mapB.set(a, (mapB.get(a) ?? 0) + 1);
      }
    }
  }

  // For each function, compute a co-change score based on how many
  // high-frequency co-changes it has
  for (const [fnId, neighbors] of coOccurrences) {
    let maxCoChange = 0;
    for (const count of neighbors.values()) {
      if (count > maxCoChange) maxCoChange = count;
    }

    // Normalize: functions co-changed 10+ times get full signal
    if (maxCoChange >= 10) {
      coChangeScores.set(fnId, 1.0);
    } else if (maxCoChange >= 5) {
      coChangeScores.set(fnId, 0.5);
    } else if (maxCoChange >= 3) {
      coChangeScores.set(fnId, 0.25);
    }
  }

  return coChangeScores;
}
