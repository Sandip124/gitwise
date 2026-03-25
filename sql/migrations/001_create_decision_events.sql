CREATE TABLE IF NOT EXISTS decision_events (
    id              TEXT PRIMARY KEY,
    repo_path       TEXT NOT NULL,
    commit_sha      TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    function_id     TEXT,
    file_path       TEXT NOT NULL,
    function_name   TEXT,
    commit_message  TEXT,
    author          TEXT,
    authored_at     TEXT,
    classification  TEXT,
    intent          TEXT,
    intent_source   TEXT,
    confidence      TEXT,
    metadata        TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_repo ON decision_events(repo_path);
CREATE INDEX IF NOT EXISTS idx_events_function ON decision_events(function_id);
CREATE INDEX IF NOT EXISTS idx_events_commit ON decision_events(commit_sha);
CREATE INDEX IF NOT EXISTS idx_events_type ON decision_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_file ON decision_events(file_path);
