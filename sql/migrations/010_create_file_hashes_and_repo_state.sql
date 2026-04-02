-- File-level content hashing for incremental change detection.
-- Inspired by Cursor's Merkle tree approach: hash files to find
-- exactly what changed, skip re-parsing unchanged code.

CREATE TABLE IF NOT EXISTS file_hashes (
    repo_path       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    last_commit_sha TEXT,
    updated_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (repo_path, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_hashes_repo ON file_hashes(repo_path);

-- Track last indexed commit for incremental init.
CREATE TABLE IF NOT EXISTS repo_state (
    repo_path           TEXT PRIMARY KEY,
    last_indexed_sha    TEXT,
    last_indexed_at     TEXT DEFAULT (datetime('now')),
    root_hash           TEXT,
    total_files         INTEGER DEFAULT 0
);
