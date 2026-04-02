import Database from "better-sqlite3";
import { createHash } from "node:crypto";

export class FileHashStore {
  constructor(private db: Database.Database) {}

  /** Compute SHA-256 of file content. ~1ms per 10K-line file. */
  static computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /** Get stored hash for a single file. */
  getHash(repoPath: string, filePath: string): string | null {
    const row = this.db
      .prepare(`SELECT content_hash FROM file_hashes WHERE repo_path = ? AND file_path = ?`)
      .get(repoPath, filePath) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  /** Bulk load all hashes for a repo. */
  getHashes(repoPath: string): Map<string, string> {
    const rows = this.db
      .prepare(`SELECT file_path, content_hash FROM file_hashes WHERE repo_path = ?`)
      .all(repoPath) as { file_path: string; content_hash: string }[];
    return new Map(rows.map(r => [r.file_path, r.content_hash]));
  }

  /** Update hash for a single file. */
  upsertHash(repoPath: string, filePath: string, hash: string, commitSha?: string): void {
    this.db
      .prepare(
        `INSERT INTO file_hashes (repo_path, file_path, content_hash, last_commit_sha, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT (repo_path, file_path) DO UPDATE SET
           content_hash = excluded.content_hash,
           last_commit_sha = excluded.last_commit_sha,
           updated_at = datetime('now')`
      )
      .run(repoPath, filePath, hash, commitSha ?? null);
  }

  /** Batch update hashes in a transaction. */
  upsertHashes(
    repoPath: string,
    entries: { filePath: string; hash: string; commitSha?: string }[]
  ): void {
    const stmt = this.db.prepare(
      `INSERT INTO file_hashes (repo_path, file_path, content_hash, last_commit_sha, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (repo_path, file_path) DO UPDATE SET
         content_hash = excluded.content_hash,
         last_commit_sha = excluded.last_commit_sha,
         updated_at = datetime('now')`
    );

    const run = this.db.transaction((entries: { filePath: string; hash: string; commitSha?: string }[]) => {
      for (const e of entries) {
        stmt.run(repoPath, e.filePath, e.hash, e.commitSha ?? null);
      }
    });
    run(entries);
  }

  /** Remove hashes for files no longer on disk. */
  removeStale(repoPath: string, currentFiles: Set<string>): number {
    const stored = this.getHashes(repoPath);
    const stale: string[] = [];
    for (const [filePath] of stored) {
      if (!currentFiles.has(filePath)) stale.push(filePath);
    }
    if (stale.length === 0) return 0;

    const stmt = this.db.prepare(
      `DELETE FROM file_hashes WHERE repo_path = ? AND file_path = ?`
    );
    const run = this.db.transaction((paths: string[]) => {
      for (const p of paths) stmt.run(repoPath, p);
    });
    run(stale);
    return stale.length;
  }

  // ── Repo State ──

  getLastIndexedSha(repoPath: string): string | null {
    const row = this.db
      .prepare(`SELECT last_indexed_sha FROM repo_state WHERE repo_path = ?`)
      .get(repoPath) as { last_indexed_sha: string } | undefined;
    return row?.last_indexed_sha ?? null;
  }

  updateRepoState(repoPath: string, sha: string, totalFiles: number, rootHash?: string): void {
    this.db
      .prepare(
        `INSERT INTO repo_state (repo_path, last_indexed_sha, last_indexed_at, root_hash, total_files)
         VALUES (?, ?, datetime('now'), ?, ?)
         ON CONFLICT (repo_path) DO UPDATE SET
           last_indexed_sha = excluded.last_indexed_sha,
           last_indexed_at = datetime('now'),
           root_hash = excluded.root_hash,
           total_files = excluded.total_files`
      )
      .run(repoPath, sha, rootHash ?? null, totalFiles);
  }
}
