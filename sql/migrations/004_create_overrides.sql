CREATE TABLE IF NOT EXISTS overrides (
    id              TEXT PRIMARY KEY,
    repo_path       TEXT NOT NULL,
    function_id     TEXT NOT NULL,
    reason          TEXT NOT NULL,
    author          TEXT NOT NULL,
    expires_at      TEXT,
    active          INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_overrides_function ON overrides(function_id, active);
