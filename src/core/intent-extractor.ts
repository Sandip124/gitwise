import {
  CommitClassification,
  IntentConfidence,
  IntentResult,
  IntentSource,
} from "./types.js";

// Map conventional commit types to intent verbs
const COMMIT_TYPE_INTENTS: Record<string, string> = {
  feat: "Added new capability",
  fix: "Fixed a defect",
  chore: "Performed maintenance task",
  docs: "Updated documentation",
  style: "Applied code style changes without behavior change",
  refactor: "Restructured code without behavior change",
  perf: "Improved performance",
  test: "Added or updated tests",
  build: "Changed build configuration",
  ci: "Updated CI/CD pipeline",
  revert: "Reverted a previous change",
};

const CONVENTIONAL_PREFIX =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\((.+?)\))?[!]?:\s*(.+)/i;

const ISSUE_REF = /(#\d+|[A-Z]{2,}-\d+)/g;

/**
 * Rule-based intent extraction for STRUCTURED and DESCRIPTIVE commits.
 *
 * For NOISE commits, returns null — those need LLM extraction from diffs.
 * Per Hericko et al. [4]: diff-level analysis is always primary;
 * this extracts what the commit message signals when it's legible.
 */
export function extractIntent(
  message: string,
  classification: CommitClassification
): IntentResult | null {
  if (classification === CommitClassification.NOISE) {
    return null;
  }

  const firstLine = message.trim().split("\n")[0].trim();

  if (classification === CommitClassification.STRUCTURED) {
    return extractStructuredIntent(firstLine, message);
  }

  return extractDescriptiveIntent(firstLine, message);
}

function extractStructuredIntent(
  firstLine: string,
  fullMessage: string
): IntentResult {
  const match = firstLine.match(CONVENTIONAL_PREFIX);

  if (match) {
    const [, type, scope, description] = match;
    const intentVerb =
      COMMIT_TYPE_INTENTS[type.toLowerCase()] || `Performed ${type}`;
    const scopeStr = scope ? ` in ${scope}` : "";
    const issueRefs = extractIssueRefs(fullMessage);
    const issueStr = issueRefs.length > 0 ? ` (${issueRefs.join(", ")})` : "";

    return {
      intent: `${intentVerb}${scopeStr}: ${description}.${issueStr}`,
      source: IntentSource.RULE,
      confidence: IntentConfidence.HIGH,
    };
  }

  // Bracketed or gitmoji prefix — extract what we can
  const cleaned = firstLine
    .replace(/^\[.+?\]\s*/, "")
    .replace(/^(:[a-z_]+:|\p{Emoji_Presentation})\s*/u, "");
  const issueRefs = extractIssueRefs(fullMessage);
  const issueStr = issueRefs.length > 0 ? ` (${issueRefs.join(", ")})` : "";

  return {
    intent: `${cleaned}.${issueStr}`,
    source: IntentSource.RULE,
    confidence: IntentConfidence.MEDIUM,
  };
}

function extractDescriptiveIntent(
  firstLine: string,
  fullMessage: string
): IntentResult {
  const issueRefs = extractIssueRefs(fullMessage);
  const issueStr = issueRefs.length > 0 ? ` (${issueRefs.join(", ")})` : "";

  // Clean trailing issue refs from the message itself to avoid duplication
  const cleaned = firstLine.replace(ISSUE_REF, "").trim().replace(/\s+/g, " ");

  // If the message body (beyond first line) has substantial content,
  // that's additional signal for higher confidence
  const bodyLines = fullMessage
    .trim()
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0);
  const hasBody = bodyLines.length > 0;
  const confidence = hasBody ? IntentConfidence.HIGH : IntentConfidence.MEDIUM;

  return {
    intent: `${cleaned}.${issueStr}`,
    source: IntentSource.RULE,
    confidence,
  };
}

function extractIssueRefs(message: string): string[] {
  const matches = message.match(ISSUE_REF);
  return matches ? [...new Set(matches)] : [];
}
