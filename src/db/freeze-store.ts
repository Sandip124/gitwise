import pg from "pg";
import { FreezeScore, RecoveryLevel, SignalBreakdown } from "../core/types.js";

export class FreezeStore {
  constructor(private pool: pg.Pool) {}

  async upsertScore(repoPath: string, score: FreezeScore): Promise<void> {
    await this.pool.query(
      `INSERT INTO freeze_scores
        (repo_path, function_id, file_path, function_name, score,
         recovery_level, signal_breakdown, pagerank, theory_gap,
         last_recomputed, invalidated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), FALSE)
       ON CONFLICT (function_id) DO UPDATE SET
         score = EXCLUDED.score,
         recovery_level = EXCLUDED.recovery_level,
         signal_breakdown = EXCLUDED.signal_breakdown,
         pagerank = EXCLUDED.pagerank,
         theory_gap = EXCLUDED.theory_gap,
         last_recomputed = NOW(),
         invalidated = FALSE`,
      [
        repoPath,
        score.functionId,
        score.filePath,
        score.functionName,
        score.score,
        score.recoveryLevel,
        JSON.stringify(score.signalBreakdown),
        score.pagerank,
        score.theoryGap,
      ]
    );
  }

  async getScore(functionId: string): Promise<FreezeScore | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM freeze_scores WHERE function_id = $1`,
      [functionId]
    );
    return rows.length > 0 ? rowToScore(rows[0]) : null;
  }

  async getScoresForFile(
    filePath: string,
    repoPath?: string
  ): Promise<FreezeScore[]> {
    const params: unknown[] = [filePath];
    let where = "WHERE file_path = $1";
    if (repoPath) {
      where += " AND repo_path = $2";
      params.push(repoPath);
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM freeze_scores ${where} ORDER BY score DESC`,
      params
    );
    return rows.map(rowToScore);
  }

  async invalidateForFunction(functionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE freeze_scores SET invalidated = TRUE WHERE function_id = $1`,
      [functionId]
    );
  }

  async invalidateAll(repoPath: string): Promise<void> {
    await this.pool.query(
      `UPDATE freeze_scores SET invalidated = TRUE WHERE repo_path = $1`,
      [repoPath]
    );
  }
}

function rowToScore(row: Record<string, unknown>): FreezeScore {
  return {
    functionId: row.function_id as string,
    filePath: row.file_path as string,
    functionName: row.function_name as string,
    score: row.score as number,
    recoveryLevel: row.recovery_level as RecoveryLevel,
    signalBreakdown: row.signal_breakdown as SignalBreakdown,
    theoryGap: row.theory_gap as boolean,
    pagerank: row.pagerank as number,
  };
}
