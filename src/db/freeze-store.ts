import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { FreezeScore, RecoveryLevel, SignalBreakdown, ObsolescenceBreakdown } from "../core/types.js";

export class FreezeStore {
  constructor(private db: Database.Database) {}

  upsertScore(repoPath: string, score: FreezeScore, branch?: string): void {
    const branchName = branch ?? score.branch ?? "HEAD";
    this.db
      .prepare(
        `INSERT INTO freeze_scores
          (id, repo_path, function_id, file_path, function_name, score,
           recovery_level, signal_breakdown, pagerank, theory_gap,
           computed_branch, obsolescence_penalty, obsolescence_breakdown,
           last_recomputed, invalidated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
         ON CONFLICT (function_id) DO UPDATE SET
           score = excluded.score,
           recovery_level = excluded.recovery_level,
           signal_breakdown = excluded.signal_breakdown,
           pagerank = excluded.pagerank,
           theory_gap = excluded.theory_gap,
           computed_branch = excluded.computed_branch,
           obsolescence_penalty = excluded.obsolescence_penalty,
           obsolescence_breakdown = excluded.obsolescence_breakdown,
           last_recomputed = datetime('now'),
           invalidated = 0`
      )
      .run(
        randomUUID(),
        repoPath,
        score.functionId,
        score.filePath,
        score.functionName,
        score.score,
        score.recoveryLevel,
        JSON.stringify(score.signalBreakdown),
        score.pagerank,
        score.theoryGap ? 1 : 0,
        branchName,
        score.obsolescence?.penalty ?? 0,
        JSON.stringify(score.obsolescence ?? {})
      );
  }

  getScore(functionId: string): FreezeScore | null {
    const row = this.db
      .prepare(`SELECT * FROM freeze_scores WHERE function_id = ?`)
      .get(functionId) as Record<string, unknown> | undefined;
    return row ? rowToScore(row) : null;
  }

  getScoresForFile(
    filePath: string,
    repoPath?: string
  ): FreezeScore[] {
    if (repoPath) {
      return (
        this.db
          .prepare(
            `SELECT * FROM freeze_scores
             WHERE file_path = ? AND repo_path = ?
             ORDER BY score DESC`
          )
          .all(filePath, repoPath) as Record<string, unknown>[]
      ).map(rowToScore);
    }

    return (
      this.db
        .prepare(
          `SELECT * FROM freeze_scores
           WHERE file_path = ? ORDER BY score DESC`
        )
        .all(filePath) as Record<string, unknown>[]
    ).map(rowToScore);
  }
}

function rowToScore(row: Record<string, unknown>): FreezeScore {
  const obsolescenceRaw = row.obsolescence_breakdown as string | undefined;
  let obsolescence: ObsolescenceBreakdown | undefined;
  if (obsolescenceRaw) {
    try {
      const parsed = JSON.parse(obsolescenceRaw);
      if (parsed && typeof parsed.penalty === "number" && parsed.penalty > 0) {
        obsolescence = parsed as ObsolescenceBreakdown;
      }
    } catch { /* skip */ }
  }

  return {
    functionId: row.function_id as string,
    filePath: row.file_path as string,
    functionName: row.function_name as string,
    score: row.score as number,
    recoveryLevel: row.recovery_level as RecoveryLevel,
    signalBreakdown: JSON.parse(
      (row.signal_breakdown as string) ?? "{}"
    ) as SignalBreakdown,
    obsolescence,
    theoryGap: row.theory_gap === 1,
    pagerank: row.pagerank as number,
    branch: (row.computed_branch as string) ?? "HEAD",
  };
}
