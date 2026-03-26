import { existsSync, readFileSync } from "node:fs";
import { getWisegitPaths, TeamConfig, DEFAULT_TEAM_CONFIG } from "../shared/team-types.js";

export type CommitOrigin = "HUMAN" | "AI_REVIEWED" | "AI_UNREVIEWED";

/**
 * Determine the origin of a commit — was it written by a human,
 * an AI agent, or an AI agent whose output was reviewed?
 *
 * Per the AI-DLC framework (Addla 2026): the unit of protection
 * isn't "human code" — it's "verified intent." AI-generated code
 * that was reviewed by a human carries more theory weight than
 * unreviewed AI output.
 *
 * Detection approach:
 * 1. Check if author matches ai_commit_authors in config
 * 2. If AI author: check if the commit is part of a reviewed PR
 *    (via issue enrichment data)
 */
export function detectCommitOrigin(
  author: string,
  repoPath: string,
  commitMessage?: string
): CommitOrigin {
  const config = loadTeamConfig(repoPath);
  const aiAuthors = config.ai_commit_authors;

  // Check if the author is a known AI/bot author
  const isAiAuthor = aiAuthors.some(
    (ai) => author.toLowerCase() === ai.toLowerCase()
  );

  if (!isAiAuthor) {
    return "HUMAN";
  }

  // AI author detected — check for review signals
  // Co-authored-by a human suggests review
  if (commitMessage) {
    const hasHumanCoAuthor = /co-authored-by:/i.test(commitMessage);
    if (hasHumanCoAuthor) {
      return "AI_REVIEWED";
    }

    // "Approved-by" or "Reviewed-by" trailers
    if (/(?:approved|reviewed)-by:/i.test(commitMessage)) {
      return "AI_REVIEWED";
    }
  }

  return "AI_UNREVIEWED";
}

/**
 * Score modifier based on commit origin.
 *
 * HUMAN: 1.0 (full weight — human decision per Naur [2])
 * AI_REVIEWED: 0.8 (human validated but AI originated)
 * AI_UNREVIEWED: 0.3 (no human decision — minimal theory weight)
 */
export function originScoreModifier(origin: CommitOrigin): number {
  switch (origin) {
    case "HUMAN":
      return 1.0;
    case "AI_REVIEWED":
      return 0.8;
    case "AI_UNREVIEWED":
      return 0.3;
  }
}

function loadTeamConfig(repoPath: string): TeamConfig {
  try {
    const paths = getWisegitPaths(repoPath);
    if (existsSync(paths.config)) {
      const raw = JSON.parse(readFileSync(paths.config, "utf-8"));
      return { ...DEFAULT_TEAM_CONFIG, ...raw };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_TEAM_CONFIG };
}
