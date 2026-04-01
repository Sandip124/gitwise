-- Store per-repo calibrated obsolescence weights.
-- Entropy-based weights are computed during recompute.
-- Bayesian adjustments accumulate from override feedback.

CREATE TABLE IF NOT EXISTS repo_calibration (
    repo_path               TEXT PRIMARY KEY,
    calibrated_weights      TEXT NOT NULL DEFAULT '{}',
    entropy_scores          TEXT NOT NULL DEFAULT '{}',
    correlation_matrix      TEXT NOT NULL DEFAULT '{}',
    bayesian_adjustments    TEXT NOT NULL DEFAULT '{}',
    feedback_events         INTEGER DEFAULT 0,
    last_calibrated         TEXT DEFAULT (datetime('now')),
    confidence              REAL DEFAULT 0.0
);

-- Track feedback events for Bayesian updating
CREATE TABLE IF NOT EXISTS calibration_feedback (
    id                  TEXT PRIMARY KEY,
    repo_path           TEXT NOT NULL,
    function_id         TEXT NOT NULL,
    feedback_type       TEXT NOT NULL,   -- 'FALSE_POSITIVE' | 'TRUE_POSITIVE' | 'TRUE_NEGATIVE'
    signal_values       TEXT NOT NULL,   -- JSON: which signals were active when feedback given
    created_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calib_feedback_repo ON calibration_feedback(repo_path);
