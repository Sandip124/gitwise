import Database from "better-sqlite3";

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
 * Escape LIKE metacharacters to prevent wildcard injection.
 */
function escapeLike(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/**
 * Search decisions by keyword.
 * Uses SQLite LIKE with ESCAPE clause for safe pattern matching.
 */
export function searchDecisions(
  db: Database.Database,
  query: string,
  repoPath?: string,
  limit: number = 10
): SearchResult[] {
  const safeQuery = `%${escapeLike(query)}%`;

  let sql = `
    SELECT function_id, file_path, function_name, intent, confidence,
           commit_sha, author
    FROM decision_events
    WHERE (intent LIKE ? ESCAPE '\\' OR commit_message LIKE ? ESCAPE '\\')
      AND intent IS NOT NULL`;

  const params: unknown[] = [safeQuery, safeQuery];

  if (repoPath) {
    sql += ` AND repo_path = ?`;
    params.push(repoPath);
  }

  sql += `
    GROUP BY function_id
    ORDER BY MAX(created_at) DESC
    LIMIT ?`;
  params.push(limit);

  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
    (row) => ({
      functionId: row.function_id as string,
      filePath: row.file_path as string,
      functionName: row.function_name as string,
      intent: row.intent as string,
      confidence: (row.confidence as string) ?? "UNKNOWN",
      commitSha: (row.commit_sha as string).slice(0, 7),
      author: (row.author as string) ?? "unknown",
    })
  );
}
