CREATE TABLE IF NOT EXISTS function_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_path       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    function_name   TEXT NOT NULL,
    function_id     TEXT NOT NULL UNIQUE,
    language        VARCHAR(30) NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    content_hash    VARCHAR(64),
    last_commit_sha VARCHAR(40),
    last_modified   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON function_chunks(repo_path, file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_function_id ON function_chunks(function_id);
