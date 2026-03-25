import { resolve } from "node:path";
import { getPool, closePool } from "../../db/pool.js";
import { EventStore } from "../../db/event-store.js";
import { makeFunctionId } from "../../core/types.js";
import { logger } from "../../shared/logger.js";

export async function historyCommand(
  target: string,
  options: { path?: string; file?: string }
): Promise<void> {
  const repoPath = options.path ? resolve(options.path) : undefined;
  const pool = getPool();

  try {
    const eventStore = new EventStore(pool);

    // If --file is provided, construct the function ID
    const filePath = options.file;
    let events;

    if (filePath) {
      const functionId = makeFunctionId(filePath, target);
      events = await eventStore.getEventsForFunction(functionId, repoPath);
    } else {
      // Try to find events matching the target as a file path
      events = await eventStore.getEventsForFile(target, repoPath);
    }

    if (events.length === 0) {
      console.log(`No history found for "${target}".`);
      return;
    }

    console.log(`Decision History: ${target}`);
    console.log("─".repeat(50));

    for (const event of events) {
      const date = event.authoredAt
        ? event.authoredAt.toISOString().slice(0, 10)
        : "unknown";
      const sha = event.commitSha.slice(0, 7);
      const fn = event.functionName ?? "(file-level)";

      console.log(`\n${date}  ${sha}  ${event.eventType}`);
      console.log(`  Function: ${fn}`);
      if (event.intent) {
        console.log(`  Intent:   ${event.intent}`);
      }
      if (event.confidence) {
        console.log(`  Confidence: ${event.confidence}`);
      }
      console.log(`  Author:   ${event.author ?? "unknown"}`);
    }

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Total events: ${events.length}`);
  } catch (err) {
    logger.error("History failed", err);
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await closePool();
  }
}
