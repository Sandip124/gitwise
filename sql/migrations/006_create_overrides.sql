CREATE TABLE IF NOT EXISTS overrides (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_path       TEXT NOT NULL,
    function_id     TEXT NOT NULL,
    reason          TEXT NOT NULL,
    author          TEXT NOT NULL,
    expires_at      TIMESTAMPTZ,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_function ON overrides(function_id, active);
