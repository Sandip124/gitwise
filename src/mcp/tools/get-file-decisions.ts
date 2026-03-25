import pg from "pg";
import { EventStore } from "../../db/event-store.js";
import { FreezeStore } from "../../db/freeze-store.js";
import { getFreezeStatus } from "../../core/recovery-levels.js";
import {
  DecisionEvent,
  FreezeScore,
  RecoveryLevel,
} from "../../core/types.js";

export interface FileDecisionsResult {
  filePath: string;
  manifest: string;
  functions: FunctionSummary[];
}

interface FunctionSummary {
  functionName: string;
  functionId: string;
  freezeScore: number;
  recoveryLevel: RecoveryLevel;
  status: string;
  decisions: { intent: string; confidence: string; commitSha: string }[];
}

/**
 * Get decision manifest for a file.
 * This is the primary tool Claude Code calls before editing a file.
 */
export async function getFileDecisions(
  pool: pg.Pool,
  filePath: string,
  repoPath?: string
): Promise<FileDecisionsResult> {
  const eventStore = new EventStore(pool);
  const freezeStore = new FreezeStore(pool);

  // Get all events for this file
  const events = await eventStore.getEventsForFile(filePath, repoPath);

  // Get freeze scores for this file
  const scores = await freezeStore.getScoresForFile(filePath, repoPath);

  // Group events by function
  const eventsByFunction = new Map<string, DecisionEvent[]>();
  for (const event of events) {
    if (!event.functionId) continue;
    const existing = eventsByFunction.get(event.functionId) ?? [];
    existing.push(event);
    eventsByFunction.set(event.functionId, existing);
  }

  // Build function summaries
  const scoreMap = new Map<string, FreezeScore>(
    scores.map((s) => [s.functionId, s])
  );

  const functions: FunctionSummary[] = [];

  for (const [functionId, fnEvents] of eventsByFunction) {
    const score = scoreMap.get(functionId);
    const level = score?.recoveryLevel ?? RecoveryLevel.L3;
    const status = getFreezeStatus(level);

    // Get unique decisions (deduplicate by commit)
    const seenCommits = new Set<string>();
    const decisions: FunctionSummary["decisions"] = [];
    for (const event of fnEvents.reverse()) {
      if (!event.intent || seenCommits.has(event.commitSha)) continue;
      seenCommits.add(event.commitSha);
      decisions.push({
        intent: event.intent,
        confidence: event.confidence ?? "UNKNOWN",
        commitSha: event.commitSha.slice(0, 7),
      });
      if (decisions.length >= 5) break; // Limit to 5 most recent
    }

    functions.push({
      functionName: score?.functionName ?? functionId.split("::function:")[1] ?? functionId,
      functionId,
      freezeScore: score?.score ?? 0,
      recoveryLevel: level,
      status,
      decisions,
    });
  }

  // Sort: frozen first, then by score descending
  functions.sort((a, b) => b.freezeScore - a.freezeScore);

  // Format manifest
  const manifest = formatManifest(filePath, functions);

  return { filePath, manifest, functions };
}

function formatManifest(
  filePath: string,
  functions: FunctionSummary[]
): string {
  if (functions.length === 0) {
    return `[DECISION MANIFEST: ${filePath}]\nNo tracked functions found.`;
  }

  const lines: string[] = [
    `[DECISION MANIFEST: ${filePath}]`,
    "━".repeat(50),
  ];

  for (const fn of functions) {
    const scoreStr = fn.freezeScore.toFixed(2);
    lines.push(
      `${fn.status}:  ${fn.functionName}()  [score: ${scoreStr}] [Recovery: ${fn.recoveryLevel}]`
    );

    for (const decision of fn.decisions) {
      lines.push(
        `  - ${decision.intent}`
      );
      lines.push(
        `    ${decision.confidence} — commit ${decision.commitSha}`
      );
    }

    lines.push("");
  }

  lines.push("━".repeat(50));
  return lines.join("\n");
}
