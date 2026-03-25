import { CommitClassification } from "./types.js";

// Conventional commit prefixes — weak signal per Hericko et al. [4],
// but indicates the author attempted structured communication.
const CONVENTIONAL_PREFIX =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+?\))?[!]?:\s/i;

// Gitmoji prefix (e.g., ":bug:", "🐛")
const GITMOJI_PREFIX = /^(:[a-z_]+:|\p{Emoji_Presentation})\s/u;

// Ticket/issue reference patterns
const ISSUE_REF = /(?:#\d+|[A-Z]{2,}-\d+)/;

// Noise patterns — messages that carry no semantic signal [4]
const NOISE_PATTERNS = [
  /^wip$/i,
  /^wip\b/i,
  /^fix$/i,
  /^update$/i,
  /^changes?$/i,
  /^stuff$/i,
  /^misc$/i,
  /^temp$/i,
  /^test$/i,
  /^\.+$/,
  /^-+$/,
  /^x+$/i,
  /^todo$/i,
  /^save$/i,
  /^commit$/i,
  /^initial commit$/i,
  /^first commit$/i,
  /^init$/i,
  /^final$/i,
  /^done$/i,
  /^asdf/i,
  /^aaa/i,
  /^[a-z]$/i, // single character
];

// Merge commit patterns — treat as NOISE (no human intent signal)
const MERGE_PATTERN = /^Merge (branch|pull request|remote-tracking)/i;

// Intent-carrying verbs that indicate a DESCRIPTIVE message
const INTENT_VERBS =
  /\b(add|added|remove|removed|fix|fixed|change|changed|update|updated|implement|implemented|refactor|refactored|prevent|prevented|ensure|ensured|handle|handled|move|moved|rename|renamed|replace|replaced|extract|extracted|improve|improved|optimize|optimized|migrate|migrated|introduce|introduced|resolve|resolved|revert|reverted|delete|deleted|create|created|support|supported|convert|converted|enable|enabled|disable|disabled|allow|allowed|clean|cleaned|simplify|simplified|separate|separated)\b/i;

/**
 * Classify a commit message into STRUCTURED, DESCRIPTIVE, or NOISE.
 *
 * From Hericko et al. [4]: commit messages alone are insufficient,
 * but classification determines whether rule-based extraction is viable
 * or an LLM is needed.
 */
export function classifyCommit(message: string): CommitClassification {
  const trimmed = message.trim();
  const firstLine = trimmed.split("\n")[0].trim();

  // Empty or very short messages = NOISE
  if (firstLine.length <= 2) {
    return CommitClassification.NOISE;
  }

  // Merge commits = NOISE (auto-generated, no human decision signal)
  if (MERGE_PATTERN.test(firstLine)) {
    return CommitClassification.NOISE;
  }

  // Check noise patterns
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(firstLine)) {
      return CommitClassification.NOISE;
    }
  }

  // Conventional commit format = STRUCTURED
  if (CONVENTIONAL_PREFIX.test(firstLine)) {
    return CommitClassification.STRUCTURED;
  }

  // Gitmoji format = STRUCTURED
  if (GITMOJI_PREFIX.test(firstLine)) {
    return CommitClassification.STRUCTURED;
  }

  // Bracketed prefix like [BUGFIX], [FEATURE] = STRUCTURED
  if (/^\[.+?\]\s/.test(firstLine)) {
    return CommitClassification.STRUCTURED;
  }

  // Messages with intent-carrying verbs and reasonable length = DESCRIPTIVE
  if (firstLine.length >= 10 && INTENT_VERBS.test(firstLine)) {
    return CommitClassification.DESCRIPTIVE;
  }

  // Messages with issue references and some length = DESCRIPTIVE
  if (firstLine.length >= 10 && ISSUE_REF.test(firstLine)) {
    return CommitClassification.DESCRIPTIVE;
  }

  // Messages longer than 20 chars with at least 3 words = DESCRIPTIVE
  const wordCount = firstLine.split(/\s+/).length;
  if (firstLine.length >= 20 && wordCount >= 3) {
    return CommitClassification.DESCRIPTIVE;
  }

  // Everything else = NOISE
  return CommitClassification.NOISE;
}
