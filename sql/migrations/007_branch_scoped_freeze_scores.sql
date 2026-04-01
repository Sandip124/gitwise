-- Recreate freeze_scores with branch-scoped unique constraint.
-- SQLite cannot ALTER column constraints, so we rebuild the table.
-- The original UNIQUE on function_id alone is replaced by (function_id, branch).

CREATE TABLE freeze_scores_new (
    id                      TEXT PRIMARY KEY,
    repo_path               TEXT NOT NULL,
    function_id             TEXT NOT NULL,
    file_path               TEXT NOT NULL,
    function_name           TEXT NOT NULL,
    score                   REAL NOT NULL,
    recovery_level          TEXT NOT NULL,
    signal_breakdown        TEXT DEFAULT '{}',
    pagerank                REAL DEFAULT 0,
    theory_gap              INTEGER DEFAULT 0,
    branch                  TEXT DEFAULT 'HEAD',
    obsolescence_penalty    REAL DEFAULT 0,
    obsolescence_breakdown  TEXT DEFAULT '{}',
    last_recomputed         TEXT DEFAULT (datetime('now')),
    invalidated             INTEGER DEFAULT 0,
    UNIQUE(function_id, branch)
);

-- Copy existing data
INSERT INTO freeze_scores_new
  SELECT id, repo_path, function_id, file_path, function_name, score,
         recovery_level, signal_breakdown, pagerank, theory_gap,
         COALESCE(branch, 'HEAD'), COALESCE(obsolescence_penalty, 0),
         COALESCE(obsolescence_breakdown, '{}'), last_recomputed, invalidated
  FROM freeze_scores;

-- Swap tables
DROP TABLE freeze_scores;
ALTER TABLE freeze_scores_new RENAME TO freeze_scores;

-- Recreate indexes
CREATE INDEX idx_freeze_repo ON freeze_scores(repo_path);
CREATE INDEX idx_freeze_function ON freeze_scores(function_id);
CREATE INDEX idx_freeze_score ON freeze_scores(score DESC);
CREATE INDEX idx_freeze_branch ON freeze_scores(branch);
