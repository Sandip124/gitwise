CREATE TABLE IF NOT EXISTS decision_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_path       TEXT NOT NULL,
    commit_sha      VARCHAR(40) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    function_id     TEXT,
    file_path       TEXT NOT NULL,
    function_name   TEXT,
    commit_message  TEXT,
    author          TEXT,
    authored_at     TIMESTAMPTZ,
    classification  VARCHAR(20),
    intent          TEXT,
    intent_source   VARCHAR(20),
    confidence      VARCHAR(20),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_events_repo ON decision_events(repo_path);
CREATE INDEX IF NOT EXISTS idx_decision_events_function ON decision_events(function_id);
CREATE INDEX IF NOT EXISTS idx_decision_events_commit ON decision_events(commit_sha);
CREATE INDEX IF NOT EXISTS idx_decision_events_type ON decision_events(event_type);
CREATE INDEX IF NOT EXISTS idx_decision_events_file ON decision_events(file_path);
CREATE INDEX IF NOT EXISTS idx_decision_events_created ON decision_events(created_at);
