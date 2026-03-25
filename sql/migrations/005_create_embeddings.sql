CREATE TABLE IF NOT EXISTS decision_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID REFERENCES decision_events(id),
    function_id     TEXT NOT NULL,
    embedding       vector(768),
    content_text    TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_function ON decision_embeddings(function_id);
