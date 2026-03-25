import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Override {
  id: string;
  repoPath: string;
  functionId: string;
  reason: string;
  author: string;
  expiresAt: Date | null;
  active: boolean;
  createdAt: Date;
}

export class OverrideStore {
  constructor(private db: Database.Database) {}

  createOverride(
    repoPath: string,
    functionId: string,
    reason: string,
    author: string,
    expiresAt?: Date
  ): Override {
    const id = randomUUID();
    const now = new Date();

    this.db
      .prepare(
        `INSERT INTO overrides (id, repo_path, function_id, reason, author, expires_at, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        id,
        repoPath,
        functionId,
        reason,
        author,
        expiresAt?.toISOString() ?? null
      );

    return {
      id,
      repoPath,
      functionId,
      reason,
      author,
      expiresAt: expiresAt ?? null,
      active: true,
      createdAt: now,
    };
  }

  getActiveOverride(functionId: string): Override | null {
    const row = this.db
      .prepare(
        `SELECT * FROM overrides WHERE function_id = ? AND active = 1
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(functionId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return rowToOverride(row);
  }

  getOverridesForRepo(repoPath: string): Override[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM overrides WHERE repo_path = ? AND active = 1
           ORDER BY created_at DESC`
        )
        .all(repoPath) as Record<string, unknown>[]
    ).map(rowToOverride);
  }

  deactivateOverride(id: string): void {
    this.db
      .prepare(`UPDATE overrides SET active = 0 WHERE id = ?`)
      .run(id);
  }

  /**
   * Expire all overrides that have passed their expires_at date.
   * Returns the count of expired overrides.
   */
  expireOverrides(): number {
    const result = this.db
      .prepare(
        `UPDATE overrides SET active = 0
         WHERE active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')`
      )
      .run();

    return result.changes;
  }
}

function rowToOverride(row: Record<string, unknown>): Override {
  return {
    id: row.id as string,
    repoPath: row.repo_path as string,
    functionId: row.function_id as string,
    reason: row.reason as string,
    author: row.author as string,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    active: row.active === 1,
    createdAt: new Date(row.created_at as string),
  };
}
