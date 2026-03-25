CREATE TABLE IF NOT EXISTS freeze_scores (
    id              TEXT PRIMARY KEY,
    repo_path       TEXT NOT NULL,
    function_id     TEXT NOT NULL UNIQUE,
    file_path       TEXT NOT NULL,
    function_name   TEXT NOT NULL,
    score           REAL NOT NULL,
    recovery_level  TEXT NOT NULL,
    signal_breakdown TEXT DEFAULT '{}',
    pagerank        REAL DEFAULT 0,
    theory_gap      INTEGER DEFAULT 0,
    last_recomputed TEXT DEFAULT (datetime('now')),
    invalidated     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_freeze_repo ON freeze_scores(repo_path);
CREATE INDEX IF NOT EXISTS idx_freeze_function ON freeze_scores(function_id);
CREATE INDEX IF NOT EXISTS idx_freeze_score ON freeze_scores(score DESC);
