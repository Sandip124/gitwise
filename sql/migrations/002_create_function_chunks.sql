CREATE TABLE IF NOT EXISTS function_chunks (
    id              TEXT PRIMARY KEY,
    repo_path       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    function_name   TEXT NOT NULL,
    function_id     TEXT NOT NULL UNIQUE,
    language        TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    content_hash    TEXT,
    last_commit_sha TEXT,
    last_modified   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON function_chunks(repo_path, file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_function_id ON function_chunks(function_id);
