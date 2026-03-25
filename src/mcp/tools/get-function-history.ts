import Database from "better-sqlite3";
import { EventStore } from "../../db/event-store.js";
import { makeFunctionId } from "../../core/types.js";

/**
 * Get the full chronological decision timeline for a function.
 * Shows every event that affected this function — why it was created,
 * changed, overridden, or enriched.
 */
export function getFunctionHistory(
  db: Database.Database,
  filePath: string,
  functionName: string,
  repoPath?: string
): string {
  const eventStore = new EventStore(db);
  const functionId = makeFunctionId(filePath, functionName);
  const events = eventStore.getEventsForFunction(functionId, repoPath);

  if (events.length === 0) {
    return `No history found for ${functionName}() in ${filePath}.`;
  }

  const lines: string[] = [
    `Decision History: ${functionName}() [${filePath}]`,
    `${"─".repeat(50)}`,
  ];

  for (const event of events) {
    const date = event.authoredAt
      ? event.authoredAt.toISOString().slice(0, 10)
      : "unknown";
    const sha = event.commitSha.slice(0, 7);

    lines.push(`\n${date}  ${sha}  ${event.eventType}`);
    if (event.intent) {
      lines.push(`  Intent: ${event.intent}`);
    }
    if (event.confidence) {
      lines.push(`  Confidence: ${event.confidence}`);
    }
    lines.push(`  Author: ${event.author ?? "unknown"}`);
  }

  lines.push(`\n${"─".repeat(50)}`);
  lines.push(`Total events: ${events.length}`);

  return lines.join("\n");
}
