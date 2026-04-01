-- Add branch-scoped scoring and obsolescence penalty support.
-- Branch awareness: same function can have different scores on different branches.
-- Obsolescence: reduces freeze scores for dead, superseded, or migrated-away code.

ALTER TABLE freeze_scores ADD COLUMN branch TEXT DEFAULT 'HEAD';
ALTER TABLE freeze_scores ADD COLUMN obsolescence_penalty REAL DEFAULT 0;
ALTER TABLE freeze_scores ADD COLUMN obsolescence_breakdown TEXT DEFAULT '{}';

-- Drop the old unique constraint on function_id alone and add branch-scoped one.
-- SQLite doesn't support DROP CONSTRAINT, so we create a new unique index instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_freeze_function_branch
  ON freeze_scores(function_id, branch);
