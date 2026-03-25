import Database from "better-sqlite3";
import { FreezeStore } from "../../db/freeze-store.js";

/**
 * Get theory gaps for a file — functions where the original decision
 * rationale may be partially or fully unrecoverable.
 *
 * Per Naur [2]: "The death of a program happens when the team
 * possessing its theory is dissolved."
 */
export function getTheoryGaps(
  db: Database.Database,
  filePath: string,
  repoPath?: string
): string {
  const freezeStore = new FreezeStore(db);
  const scores = freezeStore.getScoresForFile(filePath, repoPath);

  const gaps = scores.filter((s) => s.theoryGap);

  if (gaps.length === 0) {
    return `No theory gaps detected in ${filePath}. All functions have recoverable intent history.`;
  }

  const lines: string[] = [
    `Theory Gaps: ${filePath}`,
    `${"━".repeat(50)}`,
    "",
    `${gaps.length} function(s) with potentially unrecoverable rationale:`,
    "",
  ];

  for (const gap of gaps) {
    lines.push(
      `  ⚠ ${gap.functionName}()  [score: ${gap.score.toFixed(2)}] [${gap.recoveryLevel}]`
    );
    lines.push(
      `    Primary author may be inactive. Some decisions may be unrecoverable.`
    );
    lines.push(
      `    Treat all logic here as intentional pending manual review.`
    );
    lines.push("");
  }

  lines.push(`${"━".repeat(50)}`);
  lines.push(
    "Recovery guidance: check git blame for original authors, review PR comments, check issue tracker."
  );

  return lines.join("\n");
}
