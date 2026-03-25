import pg from "pg";
import { FunctionChunk } from "../core/types.js";

export class ChunkStore {
  constructor(private pool: pg.Pool) {}

  async upsertChunks(
    repoPath: string,
    chunks: FunctionChunk[],
    commitSha: string
  ): Promise<void> {
    if (chunks.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO function_chunks
            (repo_path, file_path, function_name, function_id, language,
             start_line, end_line, content_hash, last_commit_sha, last_modified, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
           ON CONFLICT (function_id) DO UPDATE SET
             start_line = EXCLUDED.start_line,
             end_line = EXCLUDED.end_line,
             content_hash = EXCLUDED.content_hash,
             last_commit_sha = EXCLUDED.last_commit_sha,
             last_modified = NOW(),
             updated_at = NOW()`,
          [
            repoPath,
            chunk.filePath,
            chunk.functionName,
            chunk.functionId,
            chunk.language,
            chunk.startLine,
            chunk.endLine,
            chunk.contentHash ?? null,
            commitSha,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getChunksForFile(
    filePath: string,
    repoPath?: string
  ): Promise<FunctionChunk[]> {
    const params: unknown[] = [filePath];
    let where = "WHERE file_path = $1";
    if (repoPath) {
      where += " AND repo_path = $2";
      params.push(repoPath);
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM function_chunks ${where} ORDER BY start_line ASC`,
      params
    );
    return rows.map(rowToChunk);
  }

  async getChunk(functionId: string): Promise<FunctionChunk | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM function_chunks WHERE function_id = $1`,
      [functionId]
    );
    return rows.length > 0 ? rowToChunk(rows[0]) : null;
  }
}

function rowToChunk(row: Record<string, unknown>): FunctionChunk {
  return {
    filePath: row.file_path as string,
    functionName: row.function_name as string,
    functionId: row.function_id as string,
    language: row.language as string,
    startLine: row.start_line as number,
    endLine: row.end_line as number,
    contentHash: row.content_hash as string | undefined,
  };
}
