import pg from "pg";
import { EventStore } from "../../db/event-store.js";

export interface SearchResult {
  functionId: string;
  filePath: string;
  functionName: string;
  intent: string;
  confidence: string;
  commitSha: string;
  author: string;
}

/**
 * Escape ILIKE metacharacters to prevent wildcard injection.
 */
function escapeIlike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Search decisions by keyword (BM25-style text search).
 * Vector search will be added in Phase 2 with embeddings.
 */
export async function searchDecisions(
  pool: pg.Pool,
  query: string,
  repoPath?: string,
  limit: number = 10
): Promise<SearchResult[]> {
  const safeQuery = escapeIlike(query);
  const params: unknown[] = [`%${safeQuery}%`];
  let where = "WHERE (intent ILIKE $1 OR commit_message ILIKE $1)";
  where += " AND intent IS NOT NULL";

  if (repoPath) {
    where += ` AND repo_path = $2`;
    params.push(repoPath);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (function_id)
       function_id, file_path, function_name, intent, confidence,
       commit_sha, author
     FROM decision_events
     ${where}
     ORDER BY function_id, created_at DESC
     LIMIT ${limitParam}`,
    params
  );

  return rows.map((row: Record<string, unknown>) => ({
    functionId: row.function_id as string,
    filePath: row.file_path as string,
    functionName: row.function_name as string,
    intent: row.intent as string,
    confidence: (row.confidence as string) ?? "UNKNOWN",
    commitSha: (row.commit_sha as string).slice(0, 7),
    author: (row.author as string) ?? "unknown",
  }));
}
