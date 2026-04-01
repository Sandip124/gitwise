-- Simplify: branch is metadata (which branch scores were computed for),
-- not a partitioning key. One set of scores per function, recomputed
-- on branch switch. The branch state is the context — files on disk
-- and git log already reflect the current branch.

CREATE TABLE freeze_scores_v3 (
    id                      TEXT PRIMARY KEY,
    repo_path               TEXT NOT NULL,
    function_id             TEXT NOT NULL UNIQUE,
    file_path               TEXT NOT NULL,
    function_name           TEXT NOT NULL,
    score                   REAL NOT NULL,
    recovery_level          TEXT NOT NULL,
    signal_breakdown        TEXT DEFAULT '{}',
    pagerank                REAL DEFAULT 0,
    theory_gap              INTEGER DEFAULT 0,
    computed_branch         TEXT DEFAULT 'HEAD',
    obsolescence_penalty    REAL DEFAULT 0,
    obsolescence_breakdown  TEXT DEFAULT '{}',
    last_recomputed         TEXT DEFAULT (datetime('now')),
    invalidated             INTEGER DEFAULT 0
);

-- Keep only the latest score per function (deduplicate branch rows)
INSERT OR REPLACE INTO freeze_scores_v3
  SELECT id, repo_path, function_id, file_path, function_name, score,
         recovery_level, signal_breakdown, pagerank, theory_gap,
         branch, obsolescence_penalty, obsolescence_breakdown,
         last_recomputed, invalidated
  FROM freeze_scores
  GROUP BY function_id
  HAVING MAX(last_recomputed);

DROP TABLE freeze_scores;
ALTER TABLE freeze_scores_v3 RENAME TO freeze_scores;

CREATE INDEX idx_freeze_repo ON freeze_scores(repo_path);
CREATE INDEX idx_freeze_function ON freeze_scores(function_id);
CREATE INDEX idx_freeze_score ON freeze_scores(score DESC);
