CREATE TABLE IF NOT EXISTS issue_enrichments (
    id              TEXT PRIMARY KEY,
    repo_path       TEXT NOT NULL,
    commit_sha      TEXT NOT NULL,
    issue_ref       TEXT NOT NULL,
    platform        TEXT NOT NULL,
    issue_title     TEXT,
    issue_body      TEXT,
    issue_status    TEXT,
    labels          TEXT DEFAULT '[]',
    is_freeze_signal INTEGER DEFAULT 0,
    freeze_boost    REAL DEFAULT 0,
    fetched_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrichments_commit ON issue_enrichments(commit_sha);
CREATE INDEX IF NOT EXISTS idx_enrichments_issue ON issue_enrichments(issue_ref);
