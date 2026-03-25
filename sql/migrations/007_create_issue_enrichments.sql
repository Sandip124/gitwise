CREATE TABLE IF NOT EXISTS issue_enrichments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_path       TEXT NOT NULL,
    commit_sha      VARCHAR(40) NOT NULL,
    issue_ref       TEXT NOT NULL,
    platform        VARCHAR(20) NOT NULL,
    issue_title     TEXT,
    issue_body      TEXT,
    issue_status    TEXT,
    labels          JSONB DEFAULT '[]',
    is_freeze_signal BOOLEAN DEFAULT FALSE,
    freeze_boost    REAL DEFAULT 0,
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichments_commit ON issue_enrichments(commit_sha);
CREATE INDEX IF NOT EXISTS idx_enrichments_issue ON issue_enrichments(issue_ref);
