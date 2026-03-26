import { join } from "node:path";

/**
 * Types for the .wisegit/ shared team knowledge layer.
 *
 * These JSONL entries are tracked by git and shared across the team.
 * The local SQLite database is derived from these + git history.
 */

export interface SharedEnrichment {
  issue_ref: string;
  platform: string;
  repo: string;
  fetched_at: string;
  fetched_by: string;
  title: string;
  resolution: string | null;
  labels: string[];
  has_repro_steps: boolean;
  body_excerpt: string | null;
  linked_pr: { number: number; has_review_comments: boolean } | null;
  signal_boosts: Record<string, number>;
}

export interface SharedIntent {
  commit_sha: string;
  function_id: string;
  intent: string;
  confidence: string;
  extracted_by: string; // "claude-via-mcp" | "ollama" | "rule-based"
  extracted_at: string;
  model: string | null;
}

export interface SharedOverride {
  id: string;
  function_id: string;
  created_by: string;
  created_at: string;
  reason: string;
  expires_at: string | null;
  scope: "function" | "file" | "branch";
  previous_score: number | null;
  approved_by: string | null;
  revoked?: boolean;
  revoked_by?: string;
  revoked_at?: string;
  revoke_reason?: string;
}

export interface SharedBranchContext {
  branch: string;
  merged_at: string;
  merge_commit: string;
  merged_by: string;
  purpose: string;
  files_changed: string[];
  commit_count: number;
  replaced?: string[];
  new_standard?: string[];
  do_not_reintroduce?: string[];
}

export interface TeamConfig {
  version: number;
  team_name?: string;
  enrichment_staleness_days: number;
  override_requires_approval: boolean;
  override_default_expiry_days: number;
  ignore_paths: string[];
  ai_commit_authors: string[];
  freeze_thresholds: {
    frozen: number;
    stable: number;
  };
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  version: 1,
  enrichment_staleness_days: 30,
  override_requires_approval: false,
  override_default_expiry_days: 7,
  ignore_paths: ["vendor/", "node_modules/", "dist/", "bin/", "obj/"],
  ai_commit_authors: [
    "dependabot[bot]",
    "github-actions[bot]",
    "renovate[bot]",
  ],
  freeze_thresholds: {
    frozen: 0.8,
    stable: 0.5,
  },
};

/**
 * Paths for .wisegit/ directory files, relative to repo root.
 */
export function getWisegitPaths(repoPath: string) {
  const dir = join(repoPath, ".wisegit");
  return {
    dir,
    enrichments: join(dir, "enrichments.jsonl"),
    intents: join(dir, "intents.jsonl"),
    overrides: join(dir, "overrides.jsonl"),
    branchContexts: join(dir, "branch-contexts.jsonl"),
    config: join(dir, "config.json"),
  };
}
