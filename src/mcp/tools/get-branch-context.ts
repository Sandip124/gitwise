import Database from "better-sqlite3";
import { getBranchSnapshots } from "../../pipeline/branch-context.js";

/**
 * Get branch context — what branches were merged and what they changed.
 *
 * Per Ying et al. [5]: cross-language/cross-platform dependencies are
 * most "surprising" and hardest to find by static analysis.
 * Branch context preserves migration decisions before branches are deleted.
 */
export function getBranchContext(
  db: Database.Database,
  repoPath?: string,
  filePath?: string
): string {
  const snapshots = getBranchSnapshots(repoPath ?? "", db);

  if (snapshots.length === 0) {
    return "No branch context captured yet. Run: wisegit hook install (captures on merge) or wisegit branch-capture.";
  }

  // If filePath specified, filter to branches that touched that file
  const relevant = filePath
    ? snapshots.filter((s) => s.filesChanged.includes(filePath))
    : snapshots;

  if (relevant.length === 0 && filePath) {
    return `No branches found that modified ${filePath}.`;
  }

  const lines: string[] = [
    filePath
      ? `Branch Context for ${filePath}:`
      : `Branch Context (${relevant.length} branches):`,
    `${"━".repeat(50)}`,
    "",
  ];

  for (const s of relevant.slice(0, 10)) {
    lines.push(`  ${s.branch} → ${s.mergedInto}  [${s.mergedAt.slice(0, 10)}]`);
    lines.push(`    ${s.commitCount} commits, ${s.filesChanged.length} files changed`);
    if (s.purpose) lines.push(`    Purpose: ${s.purpose}`);
    lines.push("");
  }

  if (relevant.length > 10) {
    lines.push(`  ... and ${relevant.length - 10} more branches`);
  }

  lines.push(`${"━".repeat(50)}`);
  return lines.join("\n");
}
