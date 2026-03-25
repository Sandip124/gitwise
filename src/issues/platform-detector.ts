/**
 * Extract issue references from commit messages.
 *
 * Patterns detected:
 * - #123 (GitHub/GitLab shorthand)
 * - GH-123 (GitHub explicit)
 * - owner/repo#123 (cross-repo GitHub)
 * - PROJ-123 (Jira/Linear ticket)
 * - !123 (GitLab merge request)
 */

export interface IssueRef {
  raw: string;       // Original text: "#123", "PROJ-456"
  number: number;    // Numeric ID: 123, 456
  prefix: string;    // "", "PROJ", "GH", "owner/repo"
  type: "issue" | "pr" | "ticket";
}

const PATTERNS = [
  // Jira/Linear style: PROJ-123, AB-1
  { regex: /\b([A-Z][A-Z0-9]+-\d+)\b/g, type: "ticket" as const },
  // Cross-repo GitHub: owner/repo#123
  { regex: /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)#(\d+)\b/g, type: "issue" as const },
  // GitLab MR: !123
  { regex: /(?:^|\s)!(\d+)\b/g, type: "pr" as const },
  // GitHub/GitLab issue: #123 (must not be preceded by &, which indicates HTML entities)
  { regex: /(?:^|[^&])#(\d+)\b/g, type: "issue" as const },
];

/**
 * Extract all issue references from a commit message.
 */
export function extractIssueRefs(message: string): IssueRef[] {
  const refs: IssueRef[] = [];
  const seen = new Set<string>();

  for (const { regex, type } of PATTERNS) {
    // Reset regex state
    const re = new RegExp(regex.source, regex.flags);
    let match;

    while ((match = re.exec(message)) !== null) {
      if (type === "ticket") {
        // PROJ-123
        const raw = match[1];
        if (seen.has(raw)) continue;
        seen.add(raw);

        const parts = raw.split("-");
        refs.push({
          raw,
          number: parseInt(parts[parts.length - 1], 10),
          prefix: parts.slice(0, -1).join("-"),
          type,
        });
      } else if (type === "issue" && match[2]) {
        // owner/repo#123
        const raw = `${match[1]}#${match[2]}`;
        if (seen.has(raw)) continue;
        seen.add(raw);
        // Also mark the plain #N as seen to prevent duplicate
        seen.add(`#${match[2]}`);

        refs.push({
          raw,
          number: parseInt(match[2], 10),
          prefix: match[1],
          type,
        });
      } else if (type === "pr") {
        // !123
        const num = parseInt(match[1], 10);
        const raw = `!${num}`;
        if (seen.has(raw)) continue;
        seen.add(raw);

        refs.push({ raw, number: num, prefix: "", type: "pr" });
      } else {
        // #123
        const num = parseInt(match[1], 10);
        const raw = `#${num}`;
        if (seen.has(raw)) continue;
        seen.add(raw);

        refs.push({ raw, number: num, prefix: "", type });
      }
    }
  }

  return refs;
}
