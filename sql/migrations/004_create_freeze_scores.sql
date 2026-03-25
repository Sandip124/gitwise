CREATE TABLE IF NOT EXISTS freeze_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_path       TEXT NOT NULL,
    function_id     TEXT NOT NULL UNIQUE,
    file_path       TEXT NOT NULL,
    function_name   TEXT NOT NULL,
    score           REAL NOT NULL CHECK (score >= 0 AND score <= 1),
    recovery_level  VARCHAR(2) NOT NULL,
    signal_breakdown JSONB DEFAULT '{}',
    pagerank        REAL DEFAULT 0,
    theory_gap      BOOLEAN DEFAULT FALSE,
    last_recomputed TIMESTAMPTZ DEFAULT NOW(),
    invalidated     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_freeze_repo ON freeze_scores(repo_path);
CREATE INDEX IF NOT EXISTS idx_freeze_function ON freeze_scores(function_id);
CREATE INDEX IF NOT EXISTS idx_freeze_score ON freeze_scores(score DESC);
