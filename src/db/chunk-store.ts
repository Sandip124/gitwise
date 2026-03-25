import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { FunctionChunk } from "../core/types.js";

export class ChunkStore {
  constructor(private db: Database.Database) {}

  upsertChunks(
    repoPath: string,
    chunks: FunctionChunk[],
    commitSha: string
  ): void {
    if (chunks.length === 0) return;

    const upsert = this.db.prepare(
      `INSERT INTO function_chunks
        (id, repo_path, file_path, function_name, function_id, language,
         start_line, end_line, content_hash, last_commit_sha,
         last_modified, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT (function_id) DO UPDATE SET
         start_line = excluded.start_line,
         end_line = excluded.end_line,
         content_hash = excluded.content_hash,
         last_commit_sha = excluded.last_commit_sha,
         last_modified = datetime('now'),
         updated_at = datetime('now')`
    );

    const upsertMany = this.db.transaction((items: FunctionChunk[]) => {
      for (const chunk of items) {
        upsert.run(
          randomUUID(),
          repoPath,
          chunk.filePath,
          chunk.functionName,
          chunk.functionId,
          chunk.language,
          chunk.startLine,
          chunk.endLine,
          chunk.contentHash ?? null,
          commitSha
        );
      }
    });

    upsertMany(chunks);
  }

  getChunksForFile(
    filePath: string,
    repoPath?: string
  ): FunctionChunk[] {
    if (repoPath) {
      return (
        this.db
          .prepare(
            `SELECT * FROM function_chunks
             WHERE file_path = ? AND repo_path = ?
             ORDER BY start_line ASC`
          )
          .all(filePath, repoPath) as Record<string, unknown>[]
      ).map(rowToChunk);
    }

    return (
      this.db
        .prepare(
          `SELECT * FROM function_chunks
           WHERE file_path = ? ORDER BY start_line ASC`
        )
        .all(filePath) as Record<string, unknown>[]
    ).map(rowToChunk);
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
